import hashlib
import secrets

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
