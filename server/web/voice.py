"""Thock voice input inside Crema: bounded reservations, correction keys and provider usage reconciliation,
taken from Thock's server (chaconne67/aishift web/access.py and web/usage.py) with the Crema access in place of
Thock's (docs: Crema-이용권-권한-Thock방식-계획-2026-10-01.md). No audio, dictation or provider credentials are kept."""
import calendar
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from decimal import ROUND_DOWN, Decimal, InvalidOperation
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from .models import Membership, ProviderKey, ReportConsent, SpendPeriod, VoiceSession

log = logging.getLogger(__name__)
ZERO = Decimal("0")
REFERENCE = "crema:"  # Soniox client_reference_id prefix; Thock's own reconciler only reads "thock:"


class AccessError(Exception):
    def __init__(self, code, status=403):
        self.code, self.status = code, status
        super().__init__(code)


def period(access, now=None):
    now = now or timezone.now()
    if access.cycle == "once":
        return access.starts_at, access.expires_at
    anchor = timezone.localtime(access.starts_at)
    current = timezone.localtime(now)
    months = (current.year - anchor.year) * 12 + current.month - anchor.month

    def anniversary(offset):
        year, month = divmod(anchor.year * 12 + anchor.month - 1 + offset, 12)
        return anchor.replace(year=year, month=month + 1,
                              day=min(anchor.day, calendar.monthrange(year, month + 1)[1]))
    if anniversary(months) > now:
        months -= 1
    start, end = anniversary(months), anniversary(months + 1)
    return start, min(end, access.expires_at) if access.expires_at else end


def usage(access, start):
    totals = VoiceSession.objects.filter(access=access, period_start=start).aggregate(
        used=Sum("charged_ms"), held=Sum("reserved_ms"))
    return int(totals["used"] or 0), int(totals["held"] or 0)


def refusal(user, access, now, remaining):
    """Why this member may not dictate now ("" when they may)."""
    return ("account_disabled" if not user.is_active else
            "access_suspended" if access.suspended_at else
            "access_not_started" if now < access.starts_at else
            "access_expired" if access.expires_at and now >= access.expires_at else
            "voice_not_included" if access.kind in Membership.NO_VOICE else
            "time_exhausted" if remaining < 1000 else "")


def access_status(user):
    access = Membership.of(user)
    now = timezone.now()
    start, end = period(access, now)
    used, held = usage(access, start)
    remaining = max(0, access.voice_allowance_ms - used - held)
    reason = refusal(user, access, now, remaining)
    return {"allowed": not reason, "reason": reason, "kind": access.kind, "label": access.get_kind_display(),
            "allowance_seconds": access.voice_allowance_ms / 1000, "used_seconds": used / 1000,
            "pending_seconds": held / 1000, "remaining_seconds": remaining / 1000,
            "period_end": end.isoformat() if end else None}


def voice_me(user) -> dict:
    """The voice part of /api/me: time left this period and the error-report choice."""
    consent = ReportConsent.objects.filter(user=user).first()
    return {"voice": access_status(user), "error_reports": {
        "enabled": consent.enabled if consent else None, "notice": settings.CREMA_VOICE_REPORT_NOTICE}}


def current_budget():
    row, _ = SpendPeriod.objects.get_or_create(month=timezone.localtime().strftime("%Y-%m"))
    return row


def reserve_session(user, token, request_id):
    try:
        request_id = UUID(str(request_id))
    except (ValueError, TypeError, AttributeError):
        raise AccessError("bad_request", 400)
    access = Membership.of(user)
    budget = current_budget()
    with transaction.atomic():
        budget = SpendPeriod.objects.select_for_update().get(pk=budget.pk)
        access = Membership.objects.select_for_update().get(pk=access.pk)
        # This includes a response lost in transit: never issue a second key.
        if VoiceSession.objects.filter(access=access, request_id=request_id).exists():
            raise AccessError("session_already_requested", 409)
        now = timezone.now()
        start, end = period(access, now)
        used, held = usage(access, start)
        available = access.voice_allowance_ms - used - held
        reason = refusal(user, access, now, available)
        if reason:
            raise AccessError(reason, 429 if reason == "time_exhausted" else 403)
        # Bounded overlap preserves a following dictation while the prior one is polishing.
        live = VoiceSession.objects.filter(access=access, state__in=["issuing", "issued"],
                                           created_at__gt=now - timezone.timedelta(seconds=190)).count()
        if live >= 3:
            raise AccessError("session_busy", 429)
        reserve = settings.CREMA_VOICE_SESSION_RESERVE_KRW
        if budget.spent_krw + budget.reserved_krw + reserve > settings.CREMA_VOICE_MONTH_BUDGET_KRW:
            raise AccessError("budget_exhausted", 429)
        duration = min(available // 1000, settings.CREMA_VOICE_SESSION_SECONDS)
        session = VoiceSession.objects.create(
            access=access, token=token, request_id=request_id, budget=budget, period_start=start, period_end=end,
            authorized_ms=duration * 1000, reserved_ms=duration * 1000, reserve_krw=reserve,
            exchange_rate=settings.CREMA_VOICE_USD_KRW)
        budget.reserved_krw += reserve
        budget.save(update_fields=["reserved_krw"])
        return session


def key_issue_failed(session):
    # No key was returned to a client, so it cannot have streamed with this attempt.
    with transaction.atomic():
        budget = SpendPeriod.objects.select_for_update().get(pk=session.budget_id)
        row = VoiceSession.objects.select_for_update().get(pk=session.pk)
        if row.state != "issuing":
            return
        budget.reserved_krw -= row.reserve_krw
        budget.save(update_fields=["reserved_krw"])
        row.state, row.reserved_ms, row.reserve_krw = "failed", 0, ZERO
        row.save(update_fields=["state", "reserved_ms", "reserve_krw"])


def owned_session(user, value):
    try:
        uid = UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise AccessError("bad_request", 400)
    row = VoiceSession.objects.filter(pk=uid, access__user=user).first()
    if not row:
        raise AccessError("session_not_found", 404)
    if row.state not in {"issued", "reported", "settled"}:
        raise AccessError("session_unavailable", 409)
    return row


def month_bounds(now=None):
    start = timezone.localtime(now or timezone.now()).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start, (start + timezone.timedelta(days=32)).replace(day=1)


def key_terms(user, token):
    """Limit and expiry for a device's new correction key. The monthly cost cap spans all devices."""
    access = Membership.of(user)
    state = access_status(user)
    if not state["allowed"]:
        raise AccessError(state["reason"])
    budget = current_budget()
    if budget.spent_krw + budget.reserved_krw >= settings.CREMA_VOICE_MONTH_BUDGET_KRW:
        raise AccessError("budget_exhausted", 429)
    now = timezone.now()
    if ProviderKey.objects.filter(token=token, created_at__gt=now - timezone.timedelta(days=1)).count() >= 10:
        raise AccessError("key_busy", 429)
    start, end = month_bounds(now)
    committed = ZERO
    for key in ProviderKey.objects.filter(access=access, created_at__gte=start):
        # Another device's live key may still spend up to its limit; a replaced key only what it used.
        live = not key.revoked and key.disabled_at is None and key.expires_at > now and key.token_id != token.pk
        committed += key.limit_usd if live else key.usage_usd
    limit = (access.key_limit_usd - committed).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    if limit < Decimal("0.05"):
        raise AccessError("correction_limit_reached", 429)
    ends = [now + timezone.timedelta(days=settings.CREMA_VOICE_KEY_DAYS), end] + (
        [access.expires_at] if access.expires_at else [])
    return access, limit, min(ends)


def record_key(token, access, key_hash, limit, expires):
    """Keep the new key and revoke this device's earlier keys; returns the hashes to switch off."""
    with transaction.atomic():
        old = list(ProviderKey.objects.select_for_update().filter(token=token, revoked=False)
                   .values_list("key_hash", flat=True))
        ProviderKey.objects.filter(key_hash__in=old).update(revoked=True)
        ProviderKey.objects.create(token=token, access=access, key_hash=key_hash, limit_usd=limit,
                                   exchange_rate=settings.CREMA_VOICE_USD_KRW, expires_at=expires)
    return old


def revoke_keys(keys):
    """Mark keys to be switched off; returns the hashes still enabled at OpenRouter."""
    hashes = list(keys.filter(disabled_at__isnull=True).values_list("key_hash", flat=True))
    keys.update(revoked=True)
    return hashes


def record_key_usage(key, usage_usd):
    """Add a key's new OpenRouter spend, card fee included, to this month's company budget."""
    budget_id = current_budget().pk
    with transaction.atomic():
        budget = SpendPeriod.objects.select_for_update().get(pk=budget_id)
        row = ProviderKey.objects.select_for_update().get(pk=key.pk)
        delta = usage_usd - row.usage_usd
        if delta > 0:
            budget.spent_krw += delta * row.exchange_rate * Decimal("1.055")
            budget.save(update_fields=["spent_krw"])
            row.usage_usd = usage_usd
        row.synced_at = timezone.now()
        row.save(update_fields=["usage_usd", "synced_at"])


def money(value):
    if isinstance(value, bool):
        raise ValueError("invalid provider cost")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError("invalid provider cost") from None
    if not result.is_finite() or result < 0:
        raise ValueError("invalid provider cost")
    return result


def settle_voice(entry):
    reference = entry.get("client_reference_id", "")
    if not isinstance(reference, str) or not reference.startswith(REFERENCE):
        return False
    try:
        uid = UUID(reference[len(REFERENCE):])
    except ValueError:
        return False
    original = VoiceSession.objects.filter(pk=uid).first()
    if not original:
        return False
    cost = money(entry["cost_usd"])
    duration = entry["input_audio_duration_ms"]
    if isinstance(duration, bool) or not isinstance(duration, int) or duration < 0:
        raise ValueError("invalid provider audio duration")
    with transaction.atomic():
        budget = SpendPeriod.objects.select_for_update().get(pk=original.budget_id)
        row = VoiceSession.objects.select_for_update().get(pk=uid)
        if row.state == "settled":
            return False
        # A public provider duration is the authority, not the desktop report.
        # Thock's speech.py sends exactly 200ms of finalization silence, which is not member time.
        row.charged_ms = max(0, duration - 200)
        row.audio_ms = duration
        row.cost_usd = cost
        row.provider_id = str(entry["uuid"])[:160]
        row.input_tokens = int(entry.get("input_text_tokens", 0)) + int(entry.get("input_audio_tokens", 0))
        row.output_tokens = int(entry.get("output_text_tokens", 0))
        budget.spent_krw += cost * row.exchange_rate
        budget.reserved_krw -= row.reserve_krw
        row.reserve_krw, row.reserved_ms, row.state = ZERO, 0, "settled"
        row.settled_at = timezone.now()
        row.save()
        budget.save(update_fields=["spent_krw", "reserved_krw"])
        return True


# ── Provider usage: the official reconciliation path; absent provider logs remain pending ─────────────


def provider_get(url, key):
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def openrouter(method, path, payload=None):
    """OpenRouter key management with the management key, which never leaves this server."""
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1" + path, method=method,
        data=None if payload is None else json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {settings.CREMA_OPENROUTER_MANAGEMENT_KEY}",
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def disable_keys(hashes):
    """Best effort now; a key that stays enabled is retried by the usage worker."""
    for key_hash in hashes:
        try:
            openrouter("PATCH", f"/keys/{urllib.parse.quote(key_hash)}", {"disabled": True})
        except (urllib.error.URLError, ValueError, TimeoutError) as error:
            log.warning("Crema correction key stays pending disable: %s", type(error).__name__)
            continue
        ProviderKey.objects.filter(key_hash=key_hash).update(revoked=True, disabled_at=timezone.now())


def sync_keys():
    """Record each key's spend and switch off keys whose device, member or period has ended."""
    now = timezone.now()
    synced = 0
    keys = ProviderKey.objects.filter(Q(disabled_at__isnull=True) | Q(disabled_at__gt=now - timezone.timedelta(days=2)))
    for key in keys.select_related("access__user"):
        user = key.access.user if key.access else None
        ended = key.disabled_at is None and (key.revoked or key.token_id is None or key.expires_at <= now
                                             or not (user and access_status(user)["allowed"]))
        # Spend is refreshed every few minutes; a key that must be switched off is handled every pass.
        if ended or not key.synced_at or key.synced_at < now - timezone.timedelta(minutes=5):
            try:
                data = openrouter("GET", f"/keys/{urllib.parse.quote(key.key_hash)}")["data"]
                record_key_usage(key, money(data["usage"]))
                synced += 1
            except (urllib.error.URLError, ValueError, KeyError, TypeError, TimeoutError) as error:
                log.warning("Crema correction key usage unavailable: %s", type(error).__name__)
        if ended:
            disable_keys([key.key_hash])
    return synced


def reconcile(days=2):
    if not 1 <= days <= 31:
        raise ValueError("days must be between 1 and 31")
    if not settings.CREMA_SONIOX_API_KEY or not settings.CREMA_OPENROUTER_MANAGEMENT_KEY:
        raise RuntimeError("Crema voice provider credentials are not configured")
    now = timezone.now()
    start = now - timezone.timedelta(days=days)
    settled = 0
    if VoiceSession.objects.filter(state__in=["issued", "reported"], created_at__gte=start).exists():
        query = {"start_time": start.isoformat(), "end_time": now.isoformat(), "limit": 1000, "sort": "end_time_asc"}
        seen = set()
        while True:
            result = provider_get("https://api.soniox.com/v1/usage-logs?" + urllib.parse.urlencode(query),
                                  settings.CREMA_SONIOX_API_KEY)
            for entry in result["usage_logs"]:
                settled += int(settle_voice(entry))
            cursor = result.get("next_page_cursor")
            if not cursor:
                break
            if cursor in seen:
                raise ValueError("repeated provider pagination cursor")
            seen.add(cursor)
            query["cursor"] = cursor
    pending = VoiceSession.objects.filter(state__in=["issuing", "issued", "reported"]).count()
    return {"settled": settled, "keys": sync_keys(), "pending_sessions": pending}
