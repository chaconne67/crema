from django.contrib import admin
from django.urls import include, path

from web import views

urlpatterns = [
    path("", views.home, name="home"),
    path("privacy/", views.privacy, name="privacy"),
    path("terms/", views.terms, name="terms"),
    path("health/", views.health, name="health"),
    path("i/<slug:code>/", views.invite, name="invite"),
    path("start/", views.start, name="start"),
    path("download/", views.download, name="download"),
    path("account/", views.account, name="account"),
    path("account/delete/", views.delete_account, name="delete_account"),
    # The desktop app's sign-in: browser → Google → back to the app on this PC (RFC 8252).
    path("app/login/", views.app_login, name="app_login"),
    path("app/complete/", views.app_complete, name="app_complete"),
    path("api/app/token", views.api_token, name="api_token"),
    path("api/me", views.api_me, name="api_me"),
    path("api/app/logout", views.api_logout, name="api_logout"),
    path("api/free-catalog", views.free_catalog, name="free_catalog"),
    path("api/route", views.api_route, name="api_route"),
    path("api/onboarding/step", views.api_onboarding_step, name="api_onboarding_step"),
    path("api/onboarding/help", views.api_onboarding_help, name="api_onboarding_help"),
    path("accounts/", include("allauth.urls")),
    path("admin/", admin.site.urls),
]
