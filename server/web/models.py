import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import models


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class LoginCode(models.Model):
    """One-time code handed to the desktop app after Google sign-in; exchanged for an AppToken
    with the PKCE verifier only the app holds."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    code_hash = models.CharField(max_length=64, unique=True)
    challenge = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)


class AppToken(models.Model):
    """A signed-in Crema app. Only the hash is stored; signing out or deleting the account removes it."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="app_tokens")
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    @classmethod
    def issue(cls, user) -> str:
        token = secrets.token_urlsafe(32)
        cls.objects.create(user=user, token_hash=digest(token))
        return token


class Subscription(models.Model):
    """The account's Crema plan. Created on first use as "none" (no card yet); the trial starts when a card
    is registered, becomes "paid" only after the user's separate consent, and otherwise "free"
    (docs: Crema-구독-결제-체험-계획-2026-09-29.md)."""

    NONE, TRIAL, PAID, FREE = "none", "trial", "paid", "free"
    STATUSES = [(NONE, "none"), (TRIAL, "trial"), (PAID, "paid"), (FREE, "free")]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="subscription")
    status = models.CharField(max_length=8, choices=STATUSES, default=NONE)
    trial_ends_at = models.DateTimeField(null=True, blank=True)
    paid_until = models.DateTimeField(null=True, blank=True)
    card_label = models.CharField(max_length=40, blank=True)  # e.g. "신한 1234"; no card data is kept

    @classmethod
    def of(cls, user) -> "Subscription":
        return cls.objects.get_or_create(user=user)[0]

    def summary(self, now) -> dict:
        """What the app shows: status, whole days left of the trial (the last day counts), price."""
        days_left = None
        if self.status == self.TRIAL and self.trial_ends_at:
            days_left = max(0, -((now - self.trial_ends_at) // timedelta(days=1)))
        return {"status": self.status, "days_left": days_left, "price": settings.CREMA_PRICE_KRW,
                "card": self.card_label, "paid_until": self.paid_until.isoformat() if self.paid_until else None}

