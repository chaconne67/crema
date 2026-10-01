"""The voice input API the Thock built into Crema calls, at Thock's own paths and with its answers (chaconne67/aishift
web/thock.py), signed in with the Crema app token. No audio or dictation text is stored here."""
import hashlib
import json
import re
import urllib.error
import urllib.request
from datetime import timezone as dt_timezone

from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from . import voice
from .models import ErrorReport, ReportConsent, VoiceSession
from .views import bearer_token


def _json(request):
    value = json.loads(request.body or b"{}")
    if not isinstance(value, dict):
        raise ValueError("JSON object required")
    return value


def _provider_post(url, key, payload, timeout):
    request = urllib.request.Request(
        url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


@csrf_exempt
@require_POST
def api_session(request):
    token = bearer_token(request)
    if not token:
        return JsonResponse({"error": "signed_out"}, status=401)
    if not settings.CREMA_VOICE_READY:
        return JsonResponse({"error": "voice_unavailable"}, status=503)
    try:
        session = voice.reserve_session(token.user, token, _json(request).get("request_id"))
    except (TypeError, ValueError):
        return JsonResponse({"error": "bad_request"}, status=400)
    except voice.AccessError as error:
        return JsonResponse({"error": error.code}, status=error.status)
    payload = {
        "usage_type": "transcribe_websocket", "expires_in_seconds": 60, "single_use": True,
        "max_session_duration_seconds": session.authorized_ms // 1000 + settings.CREMA_VOICE_FINALIZE_SECONDS,
        "client_reference_id": f"{voice.REFERENCE}{session.pk}",
    }
    try:
        response = _provider_post("https://api.soniox.com/v1/auth/temporary-api-key",
                                  settings.CREMA_SONIOX_API_KEY, payload, 8)
        key = response["api_key"]
        if not isinstance(key, str) or not key:
            raise ValueError("missing temporary key")
    except (urllib.error.URLError, ValueError, KeyError, TypeError, TimeoutError):
        voice.key_issue_failed(session)
        return JsonResponse({"error": "provider_unavailable"}, status=502)
    session.state = "issued"
    session.save(update_fields=["state"])
    return JsonResponse({"api_key": key, "session_id": str(session.pk),
                         "max_session_seconds": session.authorized_ms // 1000,
                         "finalize_seconds": settings.CREMA_VOICE_FINALIZE_SECONDS})


@csrf_exempt
@require_POST
def api_finish(request):
    token = bearer_token(request)
    if not token:
        return JsonResponse({"error": "signed_out"}, status=401)
    try:
        body = _json(request)
        session = voice.owned_session(token.user, body.get("session_id"))
        duration = body["recorded_ms"]
        outcome = body["outcome"]
        mode = body.get("input_mode", "")
        stt_ms, total_ms = body.get("stt_ms"), body.get("total_ms")
        if mode not in {"", "hold", "toggle", "auto"} or any(
            v is not None and (isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= 600000)
            for v in (stt_ms, total_ms)):
            raise ValueError("invalid metrics")
        if (isinstance(duration, bool) or not isinstance(duration, int) or not 0 <= duration <= 600000
                or outcome not in {"delivered", "recovered", "cancelled", "failed", "empty"}):
            raise ValueError("invalid report")
    except (TypeError, ValueError, KeyError):
        return JsonResponse({"error": "bad_request"}, status=400)
    except voice.AccessError as error:
        return JsonResponse({"error": error.code}, status=error.status)
    # Reports are telemetry only. Never release reservations based on a client claim.
    VoiceSession.objects.filter(pk=session.pk, reported_ms__isnull=True).update(
        reported_ms=duration, outcome=outcome, input_mode=mode, stt_ms=stt_ms, total_ms=total_ms)
    VoiceSession.objects.filter(pk=session.pk, state="issued").update(state="reported")
    return JsonResponse({"accepted": True})


@csrf_exempt
@require_POST
def api_key(request):
    """A device's own limited OpenRouter key; the app then corrects text with OpenRouter directly."""
    token = bearer_token(request)
    if not token:
        return JsonResponse({"error": "signed_out"}, status=401)
    if not settings.CREMA_VOICE_READY:
        return JsonResponse({"error": "voice_unavailable"}, status=503)
    try:
        access, limit, expires = voice.key_terms(token.user, token)
    except voice.AccessError as error:
        return JsonResponse({"error": error.code}, status=error.status)
    try:
        response = voice.openrouter("POST", "/keys", {
            "name": f"crema:{token.user.pk}:{token.pk}", "limit": float(limit),
            "expires_at": expires.astimezone(dt_timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
        key, key_hash = response["key"], response["data"]["hash"]
        if not (isinstance(key, str) and key and isinstance(key_hash, str) and key_hash):
            raise ValueError("missing key")
    except (urllib.error.URLError, ValueError, KeyError, TypeError, TimeoutError):
        return JsonResponse({"error": "provider_unavailable"}, status=502)
    voice.disable_keys(voice.record_key(token, access, key_hash, limit, expires))
    return JsonResponse({"api_key": key, "model": settings.CREMA_VOICE_POLISH_MODEL,
                         "expires_at": expires.isoformat(), "limit_usd": str(limit)})


@csrf_exempt
@require_POST
def api_consent(request):
    token = bearer_token(request)
    if not token:
        return JsonResponse({"error": "signed_out"}, status=401)
    try:
        enabled = _json(request)["enabled"]
        if not isinstance(enabled, bool):
            raise ValueError("enabled must be true or false")
    except (KeyError, TypeError, ValueError):
        return JsonResponse({"error": "bad_request"}, status=400)
    ReportConsent.objects.update_or_create(user=token.user, defaults={
        "enabled": enabled, "notice": settings.CREMA_VOICE_REPORT_NOTICE})
    return JsonResponse({"enabled": enabled, "notice": settings.CREMA_VOICE_REPORT_NOTICE})


# Error reports carry codes and places in the app only. ASCII-only values keep dictated words out.
SAFE = re.compile(r"^[A-Za-z0-9_.:/<> -]*$")
REPORT_FIELDS = {"stage": 32, "code": 48, "app_version": 24, "os": 48, "target_app": 64, "field_class": 64}
DETAIL_NUMBERS = {"elapsed_ms", "late_ms", "overflow_count", "sound_started_ms", "attempt",
                  "idle_s", "first_audio_ms", "silent_start_ms", "first_text_ms"}


def _report(body):
    values = {}
    for name, size in REPORT_FIELDS.items():
        value = body.get(name, "")
        if not isinstance(value, str) or len(value) > size or not SAFE.fullmatch(value):
            raise ValueError(name)
        values[name] = value
    if not (values["stage"] and values["code"] and values["app_version"]):
        raise ValueError("stage, code and app_version are required")
    details = body.get("details", {})
    if not isinstance(details, dict) or len(details) > 8:
        raise ValueError("details")
    for name, value in details.items():
        if name in DETAIL_NUMBERS:
            ok = isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 10 ** 9
        elif name == "exception":
            ok = isinstance(value, str) and len(value) <= 64 and bool(SAFE.fullmatch(value))
        elif name == "trace":
            ok = (isinstance(value, list) and len(value) <= 12 and all(
                isinstance(line, str) and len(line) <= 120 and SAFE.fullmatch(line) for line in value))
        else:
            ok = False
        if not ok:
            raise ValueError(name)
    values["details"] = details
    values["fingerprint"] = hashlib.sha256(
        f"{values['stage']}|{values['code']}|{values['target_app']}".encode()).hexdigest()[:16]
    return values


@csrf_exempt
@require_POST
def api_errors(request):
    token = bearer_token(request)
    if not token:
        return JsonResponse({"error": "signed_out"}, status=401)
    if not ReportConsent.objects.filter(user=token.user, enabled=True).exists():
        return JsonResponse({"error": "consent_required"}, status=403)
    try:
        body = _json(request)
        values = _report(body)
    except (TypeError, ValueError):
        return JsonResponse({"error": "bad_request"}, status=400)
    if ErrorReport.objects.filter(user=token.user,
                                  created_at__gt=timezone.now() - timezone.timedelta(hours=1)).count() >= 60:
        return JsonResponse({"error": "too_many_reports"}, status=429)
    session = None
    if body.get("session_id"):
        try:
            session = voice.owned_session(token.user, body["session_id"])
        except voice.AccessError:
            session = None
    ErrorReport.objects.create(user=token.user, session=session, **values)
    return JsonResponse({"accepted": True})
