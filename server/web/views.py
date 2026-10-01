import base64
import hashlib
import hmac
import json
import re
import secrets
import urllib.error
import urllib.request
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.core.cache import cache
from django.db import transaction
from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseRedirect, JsonResponse, StreamingHttpResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from . import voice
from .models import AppToken, InviteCode, LoginCode, Membership, ModelUsage, Subscription, digest

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


def guide_page(request):
    """The AI setup guide's page as the app sends it (labels already masked): goal, elements, and page."""
    body = json_body(request)
    goal = str(body["goal"])[:600]
    elements = {str(key)[:8]: str(label)[:120] for key, label in list(dict(body["elements"]).items())[:200]}
    page = {"url": str(body.get("url") or "")[:300], "title": str(body.get("title") or "")[:200]}
    return body, goal, elements, page


@csrf_exempt
@require_POST
def api_onboarding_step(request):
    """The AI setup guide's next step: which of the page's elements the user acts on next, and whether
    the page asks for consent or something only the user can do. Labels are judged, never stored."""
    if not bearer_token(request):
        return JsonResponse({"error": "signed_out"}, status=401)
    if not settings.TYPESAFE_API_KEY:
        return JsonResponse({"error": "unavailable"}, status=503)
    try:
        _, goal, elements, page = guide_page(request)
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


# "막혔어요": what can stop someone on a setup page. The app says each one plainly (src/guide.js HELP).
HELP_CAUSES = {
    "sign_in": "The user must sign in, or was signed out",
    "verification": "The page waits for a verification code sent to a phone or e-mail",
    "captcha": "The page shows a CAPTCHA or asks to prove the user is human",
    "terms": "Terms, a privacy notice or cookies still wait to be accepted",
    "account_type": "The account type is refused (e.g. a work or school account, or an age limit)",
    "region": "The service is not available in the user's country or for this account",
    "payment": "The page asks for payment, a paid plan, or billing details",
    "limit": "A limit is reached: too many keys, a quota, or rate limiting",
    "site_error": "The site itself shows an error or failed to load",
    "wrong_page": "The page is unrelated to the goal (the user wandered off)",
    "loading": "The page is still loading or changing",
    "other": "None of these",
}


@csrf_exempt
@require_POST
def api_onboarding_help(request):
    """Why the user is stuck on a setup page, as one of HELP_CAUSES. The page is judged, never stored."""
    if not bearer_token(request):
        return JsonResponse({"error": "signed_out"}, status=401)
    if not settings.TYPESAFE_API_KEY:
        return JsonResponse({"error": "unavailable"}, status=503)
    try:
        body, goal, elements, page = guide_page(request)
        step = str(body.get("step") or "")[:120]
        errors = [str(text)[:200] for text in list(body.get("errors") or [])[:5]]
    except (ValueError, KeyError, TypeError):
        return HttpResponseBadRequest()
    questions = {
        "cause": {
            "type": "choice",
            "instructions": "The user pressed 'I am stuck' while working toward `goal` on this page. What most likely stops them?",
            "criteria": HELP_CAUSES,
        },
    }
    try:
        answers = ask_jev({"goal": goal, "step": step, "page": page, "elements": list(elements.values()), "errors": errors}, questions)
        return JsonResponse({"cause": answers["cause"]["choice"], "confidence": answers["cause"]["confidence"]})
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


def member_context(user) -> dict:
    """The signed-in account's access for the site's pages; a suspended account gets no installer."""
    membership = Membership.of(user)
    return {"member": membership.summary(timezone.now()), "suspended": membership.suspended_at is not None}


@login_required
def start(request):
    """After Google sign-in: welcome, the installer (downloading by itself) and how to install."""
    return render(request, "start.html", member_context(request.user))


def download(request):
    """The installer, for anyone (as Thock's): signing in happens in the app. A suspended account gets none."""
    if request.user.is_authenticated and Membership.objects.filter(user=request.user, suspended_at__isnull=False).exists():
        return HttpResponse("이용이 멈춘 계정입니다.", status=403)
    return HttpResponseRedirect(settings.CREMA_DOWNLOAD_URL)


@login_required
def account(request):
    return render(request, "account.html", {"apps": request.user.app_tokens.count(), **member_context(request.user)})


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
    return redirect("/accounts/google/login/?next=/app/complete/")


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
    token = AppToken.objects.select_related("user").filter(token_hash=digest(header[7:].strip())).first()
    if token and Membership.objects.filter(user=token.user, suspended_at__isnull=False).exists():
        return None  # a suspended account signs the app out
    return token


def api_me(request):
    token = bearer_token(request)
    if not token:
        return JsonResponse({"error": "signed_out"}, status=401)
    token.last_used_at = timezone.now()
    token.save(update_fields=["last_used_at"])
    now = timezone.now()
    return JsonResponse({"email": token.user.email, "name": token.user.get_full_name(),
                         "member": Membership.of(token.user).summary(now),
                         "plan": Subscription.of(token.user).summary(now), **voice.voice_me(token.user)})


@csrf_exempt
@require_POST
def api_invite(request):
    """An invite code entered in the app (as Thock's): gives this member its kind of access, or says why not.
    Ten failed tries an hour per member, so codes cannot be guessed."""
    token = bearer_token(request)
    if not token:
        return JsonResponse({"error": "signed_out"}, status=401)
    try:
        code = json.loads(request.body or b"{}")["code"]
        if not isinstance(code, str) or len(code) > 32:
            raise ValueError("code")
    except (KeyError, TypeError, ValueError):
        return JsonResponse({"error": "bad_request"}, status=400)
    now = timezone.now()
    tries = f"invite-fail:{token.user.pk}:{now:%Y%m%d%H}"
    if cache.get(tries, 0) >= 10:
        return JsonResponse({"error": "too_many_attempts"}, status=429)
    with transaction.atomic():
        found = InviteCode.objects.select_for_update().filter(code=code.strip().upper()).first()
        failure = found.redeem(token.user, now) if found else "invalid_code"
    if failure:
        cache.set(tries, cache.get(tries, 0) + 1, 3600)
        return JsonResponse({"error": failure}, status=404 if failure == "invalid_code" else 409)
    return JsonResponse({"member": Membership.of(token.user).summary(now)})


@csrf_exempt
@require_POST
def api_logout(request):
    token = bearer_token(request)
    if token:
        hashes = voice.revoke_keys(token.provider_keys.all())
        token.delete()
        voice.disable_keys(hashes)
    return HttpResponse(status=204)


# ── Crema's AI window (/ai/v1): OpenAI-compatible, for grades with models provided ─────────────────
OPENROUTER = "https://openrouter.ai/api/v1"


def ai_error(message: str, kind: str, status: int) -> JsonResponse:
    return JsonResponse({"error": {"message": message, "type": kind}}, status=status)


def ai_member(request, budget: bool = True):
    """The member behind an app token who may use Crema's models (and, with ``budget``, has some of
    this month's budget left); otherwise the error to answer with."""
    token = bearer_token(request)
    if not token:
        return None, ai_error("Crema에 로그인해 주세요.", "signed_out", 401)
    now = timezone.now()
    member = Membership.of(token.user).summary(now)
    if not member["models"]:
        return None, ai_error("이 계정에는 Crema가 제공하는 AI가 없습니다.", "not_provided", 403)
    if budget and ModelUsage.spent_this_month(token.user, now) >= member["budget"]:
        return None, ai_error("이번 달 Crema가 제공하는 AI 사용량을 다 썼어요. 다음 달 1일에 다시 채워집니다.", "budget", 429)
    return token.user, None


def record_usage(user, model: str, usage) -> None:
    usage = usage or {}
    cost = float(usage.get("cost") or 0)
    ModelUsage.objects.create(user=user, model=model[:80], prompt_tokens=int(usage.get("prompt_tokens") or 0),
                              completion_tokens=int(usage.get("completion_tokens") or 0), cost_usd=cost,
                              cost_krw=round(cost * settings.CREMA_USD_KRW))


def ai_models(request):
    user, error = ai_member(request, budget=False)
    if error:
        return error
    return JsonResponse({"object": "list", "data": [{"id": model, "object": "model", "owned_by": "crema"}
                                                     for model in settings.CREMA_AI_MODELS]})


@csrf_exempt
@require_POST
def ai_chat(request):
    """A chat completion through Crema's OpenRouter account: only the offered models, the cost counted
    against the member's monthly budget; streamed replies are passed through as they come."""
    user, error = ai_member(request)
    if error:
        return error
    try:
        body = json.loads(request.body or b"{}")
    except ValueError:
        return ai_error("요청을 읽지 못했습니다.", "bad_request", 400)
    model = str(body.get("model") or "")
    if model not in settings.CREMA_AI_MODELS:
        return ai_error(f"Crema가 제공하지 않는 모델입니다: {model}", "model_not_offered", 400)
    if not settings.CREMA_OPENROUTER_API_KEY:
        return ai_error("Crema AI가 잠시 준비 중입니다.", "unavailable", 503)
    # Only the model asked for: OpenRouter would otherwise fall back to any model listed in "models".
    for key in ("models", "route"):
        body.pop(key, None)
    body["usage"] = {"include": True}
    upstream_request = urllib.request.Request(
        f"{OPENROUTER}/chat/completions", data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": f"Bearer {settings.CREMA_OPENROUTER_API_KEY}", "Content-Type": "application/json",
                 "HTTP-Referer": "https://crema-agent.site", "X-Title": "Crema"})
    try:
        upstream = urllib.request.urlopen(upstream_request, timeout=300)
    except urllib.error.HTTPError as failed:
        return HttpResponse(failed.read(), status=failed.code, content_type="application/json")
    except OSError:
        return ai_error("AI 서버에 닿지 못했습니다. 잠시 뒤 다시 시도해 주세요.", "upstream_unreachable", 502)
    if not body.get("stream"):
        with upstream:
            data = json.loads(upstream.read())
        record_usage(user, model, data.get("usage"))
        return JsonResponse(data)

    def relay():
        usage = None
        try:
            with upstream:
                for line in upstream:
                    if line.startswith(b"data: {") and b'"usage"' in line:
                        try:
                            usage = json.loads(line[6:]).get("usage") or usage
                        except ValueError:
                            pass
                    yield line
        finally:
            record_usage(user, model, usage)  # also when the app stops reading mid-reply

    response = StreamingHttpResponse(relay(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response

