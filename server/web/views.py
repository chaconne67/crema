import base64
import hashlib
import hmac
import json
import re
import secrets
import urllib.request
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseRedirect, JsonResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .models import AppToken, LoginCode, digest

PENDING = "crema_app_login"
STATE = re.compile(r"[A-Za-z0-9_-]{16,128}")
CHALLENGE = re.compile(r"[A-Za-z0-9_-]{43}")
CODE_LIFETIME = timedelta(minutes=5)


def site_context(request):
    return {"contact_email": settings.CREMA_CONTACT_EMAIL, "download_url": settings.CREMA_DOWNLOAD_URL}


def home(request):
    return render(request, "home.html")


def privacy(request):
    return render(request, "privacy.html")


def terms(request):
    return render(request, "terms.html")


def health(request):
    return HttpResponse("ok", content_type="text/plain")


FREE_CATALOG = settings.BASE_DIR / "web" / "free_catalog.json"


def free_catalog(request):
    """The free AI tiers the desktop app chains (it bundles the same file for when this cannot be read)."""
    response = HttpResponse(FREE_CATALOG.read_bytes(), content_type="application/json")
    # Read by the app's own web view, whose origin is not this site.
    response["Access-Control-Allow-Origin"] = "*"
    response["Cache-Control"] = "public, max-age=3600"
    return response


JEV_URL = "https://api.typesafe.ai/v1/systemone"
# Checked on Korean requests (2026-09-26): 10 of 12 difficulties matched, 0.2-0.6 s per call.
JEV_QUESTIONS = {
    "difficulty": {
        "type": "score",
        "instructions": "How capable must the AI model be to answer this user request well?",
        "criteria": [
            "Trivial: greeting, chit-chat, a one-line fact",
            "Easy: short explanation, simple translation, summary of short text, simple rewrite",
            "Hard: multi-step reasoning, careful writing of a long document, non-trivial code, analysis comparing several factors",
            "Very hard: complex system design, large or tricky code, deep math or proofs, long agentic multi-step work",
        ],
    },
    "needs_tools": {
        "type": "noul",
        "instructions": "Does answering require acting on the user's computer or fetching live web information, rather than only producing text?",
    },
    "sensitive": {
        "type": "noul",
        "instructions": "Does the request contain personal information, passwords, financial data, or confidential company material?",
    },
}


def ask_jev(state, questions):
    """Jev's answers to typed questions about `state` (raises OSError/ValueError/KeyError on failure)."""
    call = urllib.request.Request(
        JEV_URL,
        data=json.dumps({"state": state, "model": "jev-latest", "questions": questions}).encode(),
        headers={"Authorization": f"Bearer {settings.TYPESAFE_API_KEY}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(call, timeout=3) as response:
        return json.load(response)["answers"]


def json_body(request):
    body = json.loads(request.body or b"{}")
    if not isinstance(body, dict):
        raise ValueError
    return body


@csrf_exempt
@require_POST
def api_onboarding_step(request):
    """The sign-up guide's next step: which of the page's elements the user acts on next, and whether
    the page asks for consent or something only the user can do. Labels are judged, never stored."""
    if not bearer_token(request):
        return JsonResponse({"error": "signed_out"}, status=401)
    if not settings.TYPESAFE_API_KEY:
        return JsonResponse({"error": "unavailable"}, status=503)
    try:
        body = json_body(request)
        goal = str(body["goal"])[:600]
        elements = {str(key)[:8]: str(label)[:120] for key, label in list(dict(body["elements"]).items())[:200]}
        page = {"url": str(body.get("url") or "")[:300], "title": str(body.get("title") or "")[:200]}
    except (ValueError, KeyError, TypeError):
        return HttpResponseBadRequest()
    questions = {
        "next": {
            "type": "choice",
            "instructions": "Which one element should the user act on next to move toward `goal` on this page? "
            "Choose none when the page is still loading or no element on it moves toward the goal.",
            "criteria": {**elements, "none": "No element fits: wait, or the goal is already reached"},
        },
        "consent": {"type": "noul", "instructions": "Is the page asking the user to accept terms, a privacy notice, or cookies?"},
        "blocked": {
            "type": "noul",
            "instructions": "Does the page show an error message, a CAPTCHA, or a request for a verification code sent to a phone or e-mail?",
        },
    }
    try:
        answers = ask_jev({"goal": goal, "page": page}, questions)
        target = answers["next"]["choice"]
        return JsonResponse({
            "target": None if target == "none" else target,
            "confidence": answers["next"]["confidence"],
            "consent": answers["consent"]["noul"],
            "blocked": answers["blocked"]["noul"],
        })
    except (OSError, ValueError, KeyError, TypeError):
        return JsonResponse({"error": "judge_failed"}, status=502)


@csrf_exempt
@require_POST
def api_route(request):
    """How hard a signed-in app's automatic free-AI request is. The text is judged, never stored."""
    if not bearer_token(request):
        return JsonResponse({"error": "signed_out"}, status=401)
    if not settings.TYPESAFE_API_KEY:
        return JsonResponse({"error": "unavailable"}, status=503)
    try:
        text = str(json_body(request).get("text") or "")[:2000]
    except ValueError:
        return HttpResponseBadRequest()
    if not text.strip():
        return HttpResponseBadRequest()
    try:
        answers = ask_jev(text, JEV_QUESTIONS)
        return JsonResponse({
            "difficulty": answers["difficulty"]["score"],
            "confidence": answers["difficulty"]["confidence"],
            "needs_tools": answers["needs_tools"]["noul"],
            "sensitive": answers["sensitive"]["noul"],
        })
    except (OSError, ValueError, KeyError, TypeError):
        return JsonResponse({"error": "judge_failed"}, status=502)


@login_required
def account(request):
    return render(request, "account.html", {"apps": request.user.app_tokens.count()})


@login_required
@require_POST
def delete_account(request):
    user = request.user
    logout(request)
    user.delete()
    return redirect("home")


def app_login(request):
    """Started by the desktop app: remembers where to hand the result back, then signs in with Google."""
    port, state, challenge = (request.GET.get(key, "") for key in ("port", "state", "challenge"))
    if not (port.isdigit() and 1024 <= int(port) <= 65535 and STATE.fullmatch(state) and CHALLENGE.fullmatch(challenge)):
        return HttpResponseBadRequest("Crema 앱에서 로그인을 다시 시작해 주세요.")
    request.session[PENDING] = {"port": int(port), "state": state, "challenge": challenge}
    if request.user.is_authenticated:
        return redirect("app_complete")
    return redirect(f"{settings.LOGIN_URL}?next=/app/complete/")


@login_required
def app_complete(request):
    """Signed in: sends a one-time code back to the app's loopback address on this PC."""
    pending = request.session.pop(PENDING, None)
    if not pending:
        return render(request, "app_restart.html", status=400)
    code = secrets.token_urlsafe(32)
    LoginCode.objects.create(
        user=request.user,
        code_hash=digest(code),
        challenge=pending["challenge"],
        expires_at=timezone.now() + CODE_LIFETIME,
    )
    return HttpResponseRedirect(f"http://127.0.0.1:{pending['port']}/callback?code={code}&state={pending['state']}")


def s256(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


@csrf_exempt
@require_POST
def api_token(request):
    """The app trades its one-time code and PKCE verifier for a long-lived app token."""
    try:
        body = json.loads(request.body or b"{}")
        code, verifier = str(body["code"]), str(body["verifier"])
    except (ValueError, KeyError, TypeError):
        return JsonResponse({"error": "bad_request"}, status=400)
    login = LoginCode.objects.filter(code_hash=digest(code), used_at__isnull=True, expires_at__gt=timezone.now()).first()
    if not login or not hmac.compare_digest(s256(verifier), login.challenge):
        return JsonResponse({"error": "invalid_code"}, status=400)
    login.used_at = timezone.now()
    login.save(update_fields=["used_at"])
    user = login.user
    return JsonResponse({"token": AppToken.issue(user), "email": user.email, "name": user.get_full_name()})


def bearer_token(request):
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    return AppToken.objects.select_related("user").filter(token_hash=digest(header[7:].strip())).first()


def api_me(request):
    token = bearer_token(request)
    if not token:
        return JsonResponse({"error": "signed_out"}, status=401)
    token.last_used_at = timezone.now()
    token.save(update_fields=["last_used_at"])
    return JsonResponse({"email": token.user.email, "name": token.user.get_full_name()})


@csrf_exempt
@require_POST
def api_logout(request):
    token = bearer_token(request)
    if token:
        token.delete()
    return HttpResponse(status=204)
