from django.contrib import admin
from django.shortcuts import redirect
from django.utils import timezone

from .models import AppToken, Invite, Membership, Subscription

admin.site.site_header = admin.site.site_title = "Crema 관리"
admin.site.index_title = "회원·등급"


def google_login(request, extra_context=None):
    """The admin signs in with Google like everyone else (the site has no passwords); only staff get in."""
    target = request.GET.get("next") or "/admin/"
    if request.user.is_authenticated and request.user.is_staff:
        return redirect(target)
    return redirect(f"/accounts/google/login/?next={target}")


admin.site.login = google_login


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("user_email", "grade", "full_access", "models_provided", "model_budget_krw", "expires_at", "suspended_at")
    list_filter = ("grade", "full_access", "models_provided")
    search_fields = ("user__email", "note")
    readonly_fields = ("user", "created_at")
    actions = ["suspend", "resume"]

    @admin.display(description="이메일", ordering="user__email")
    def user_email(self, obj):
        return obj.user.email

    def save_model(self, request, obj, form, change):
        if "grade" in form.changed_data:
            # A new grade brings its defaults unless the admin also changed them in the same save.
            full, provided, budget = Membership.DEFAULTS[obj.grade]
            if "full_access" not in form.changed_data:
                obj.full_access = full
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


@admin.register(Invite)
class InviteAdmin(admin.ModelAdmin):
    list_display = ("link", "grade", "days", "used", "max_uses", "valid_until", "note", "created_at")
    list_filter = ("grade",)
    search_fields = ("code", "note", "uses__user__email")
    readonly_fields = ("link", "used_by")

    @admin.display(description="링크")
    def link(self, obj):
        return f"https://crema-agent.site/i/{obj.code}/" if obj.pk else "저장하면 만들어집니다"

    @admin.display(description="쓴 사람 수")
    def used(self, obj):
        return obj.uses.count()

    @admin.display(description="쓴 사람")
    def used_by(self, obj):
        return ", ".join(use.user.email for use in obj.uses.select_related("user")) or "—"

