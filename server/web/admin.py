from django.contrib import admin
from django.shortcuts import redirect
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme

from .models import AppToken, InviteCode, Membership, ModelUsage, Subscription

admin.site.site_header = admin.site.site_title = "Crema 관리"
admin.site.index_title = "회원·이용권"


def google_login(request, extra_context=None):
    """The admin signs in with Google like everyone else (the site has no passwords); only staff get in."""
    target = request.GET.get("next") or "/admin/"
    if not url_has_allowed_host_and_scheme(target, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
        target = "/admin/"  # this site only
    if request.user.is_authenticated and request.user.is_staff:
        return redirect(target)
    return redirect(f"/accounts/google/login/?next={target}")


admin.site.login = google_login


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("user_email", "kind", "expires_at", "cycle", "voice_allowance_ms", "models_provided", "model_budget_krw",
                    "suspended_at")
    list_filter = ("kind", "models_provided")
    search_fields = ("user__email", "note")
    readonly_fields = ("user", "created_at")
    actions = ["suspend", "resume"]

    @admin.display(description="이메일", ordering="user__email")
    def user_email(self, obj):
        return obj.user.email

    def save_model(self, request, obj, form, change):
        if "kind" in form.changed_data:
            # A new kind brings its defaults unless the admin also changed them in the same save.
            provided, budget = Membership.DEFAULTS[obj.kind]
            if "models_provided" not in form.changed_data:
                obj.models_provided = provided
            if "model_budget_krw" not in form.changed_data:
                obj.model_budget_krw = budget
        super().save_model(request, obj, form, change)
        if obj.suspended_at:
            AppToken.objects.filter(user=obj.user).delete()

    @admin.action(description="정지 (앱 로그인 끊기)")
    def suspend(self, request, queryset):
        for membership in queryset:
            membership.suspended_at = timezone.now()
            membership.save(update_fields=["suspended_at"])
            AppToken.objects.filter(user=membership.user).delete()

    @admin.action(description="정지 풀기")
    def resume(self, request, queryset):
        queryset.update(suspended_at=None)


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ("user", "status", "trial_ends_at", "paid_until")
    search_fields = ("user__email",)


@admin.register(InviteCode)
class InviteCodeAdmin(admin.ModelAdmin):
    list_display = ("code", "kind", "note", "days", "expires_at", "used_by", "used_at", "created_at")
    list_filter = ("kind",)
    search_fields = ("code", "note", "used_by__email")
    readonly_fields = ("code", "used_by", "used_at")


@admin.register(ModelUsage)
class ModelUsageAdmin(admin.ModelAdmin):
    list_display = ("at", "user", "model", "prompt_tokens", "completion_tokens", "cost_krw")
    list_filter = ("model",)
    search_fields = ("user__email",)
    date_hierarchy = "at"

