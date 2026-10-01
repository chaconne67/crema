"""crema-agent.site settings. Everything machine-specific comes from the environment
(on main: /srv/consolidation/secrets/crema.env)."""

import os
from decimal import Decimal
from pathlib import Path
from urllib.parse import unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent.parent


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    raise RuntimeError("DJANGO_SECRET_KEY is required")
DEBUG = os.environ.get("DJANGO_DEBUG", "").lower() in {"1", "true", "yes"}
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "crema-agent.site,www.crema-agent.site")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", "https://crema-agent.site,https://www.crema-agent.site")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",
    "web",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "allauth.account.middleware.AccountMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "web.views.site_context",
            ],
        },
    },
]


def database_config(url: str) -> dict:
    parsed = urlparse(url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise RuntimeError("DATABASE_URL must be a postgres URL")
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": unquote(parsed.path.lstrip("/")),
        "USER": unquote(parsed.username or ""),
        "PASSWORD": unquote(parsed.password or ""),
        "HOST": parsed.hostname or "",
        "PORT": str(parsed.port or 5432),
        "CONN_MAX_AGE": 60,
    }


DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required")
DATABASES = {"default": database_config(DATABASE_URL)}

LANGUAGE_CODE = "ko-kr"
TIME_ZONE = "Asia/Seoul"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = not DEBUG
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

# Google is the only way in: no passwords are kept here.
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]
LOGIN_URL = "/accounts/login/"
LOGIN_REDIRECT_URL = "/start/"
ACCOUNT_LOGOUT_REDIRECT_URL = "/"
SOCIALACCOUNT_ONLY = True
ACCOUNT_EMAIL_VERIFICATION = "none"
SOCIALACCOUNT_LOGIN_ON_GET = True
SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "APP": {
            "client_id": os.environ.get("GOOGLE_CLIENT_ID", ""),
            "secret": os.environ.get("GOOGLE_CLIENT_SECRET", ""),
        },
        "SCOPE": ["openid", "email", "profile"],
        "AUTH_PARAMS": {"prompt": "select_account"},
    },
}

# Shown on the site; left empty until the operator confirms them.
CREMA_CONTACT_EMAIL = os.environ.get("CREMA_CONTACT_EMAIL", "")
# Jev (typesafe.ai) judges how hard an automatic free-AI request is; without it /api/route answers 503.
TYPESAFE_API_KEY = os.environ.get("TYPESAFE_API_KEY", "")
CREMA_DOWNLOAD_URL = "https://github.com/chaconne67/crema/releases/latest/download/Crema-setup-x64.exe"
# The one Crema subscription (VAT included) and its trial, 2026-09-29 decision.
CREMA_PRICE_KRW = 4900
CREMA_TRIAL_DAYS = 30
# Crema's AI window for grades with models provided (Crema-회원등급-계획-2026-09-29.md 4-4): one OpenRouter
# account behind /ai/v1, the models offered, and the won per dollar used to count each member's monthly budget.
CREMA_OPENROUTER_API_KEY = os.environ.get("CREMA_OPENROUTER_API_KEY", "")
CREMA_AI_MODELS = ["openai/gpt-6-luna", "openai/gpt-6-sol", "anthropic/claude-sonnet-5.5",
                   "google/gemini-3.8-flash", "deepseek/deepseek-v4.1-flash"]
CREMA_AI_DEFAULT_MODEL = CREMA_AI_MODELS[0]
CREMA_USD_KRW = int(os.environ.get("CREMA_USD_KRW", "1450"))

# Thock voice input built into Crema (docs: Crema-이용권-권한-Thock방식-계획-2026-10-01.md): the company Soniox and
# OpenRouter management keys Thock uses, with Crema's own monthly voice budget. Values as Thock's server.
CREMA_SONIOX_API_KEY = os.environ.get("CREMA_SONIOX_API_KEY", "")
CREMA_OPENROUTER_MANAGEMENT_KEY = os.environ.get("CREMA_OPENROUTER_MANAGEMENT_KEY", "")
CREMA_VOICE_MONTH_BUDGET_KRW = Decimal(os.environ.get("CREMA_VOICE_MONTH_BUDGET_KRW", "100000"))
CREMA_VOICE_USD_KRW = Decimal(CREMA_USD_KRW)
CREMA_VOICE_SESSION_RESERVE_KRW = Decimal("100")
CREMA_VOICE_SESSION_SECONDS = 300
CREMA_VOICE_FINALIZE_SECONDS = 5
CREMA_VOICE_KEY_DAYS = 30
CREMA_VOICE_POLISH_MODEL = "openai/gpt-6-luna"
CREMA_VOICE_REPORT_NOTICE = "2026-10-01"  # version of the error-report notice
CREMA_VOICE_READY = bool(CREMA_SONIOX_API_KEY and CREMA_OPENROUTER_MANAGEMENT_KEY
                         and 0 < CREMA_VOICE_MONTH_BUDGET_KRW <= 100000)
