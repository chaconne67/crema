import hashlib
import secrets
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone


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


INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I to misread


def new_invite_code() -> str:
    body = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(8))
    return f"CRM-{body[:4]}-{body[4:]}"


class Membership(models.Model):
    """The account's Crema access, built like Thock's product access (docs: Crema-이용권-권한-Thock방식-계획-
    2026-10-01.md): its kind decides what the app may use (the free kind is the narrow plan, 4,900원 is all of
    Crema, 9,900원 and the kinds not sold add the built-in Thock voice input), until when, renewed how, with how
    much voice time and correction cost a period, and whether Crema provides the AI models (with a monthly budget).
    A new account starts on the trial; an ended access counts as free; a suspended account cannot use the app."""

    FREE, TRIAL, STANDARD, PLUS = "free", "trial", "standard", "plus"
    BETA, PARTNER, EMPLOYEE, OWNER = "beta", "partner", "employee", "owner"
    KINDS = [(FREE, "무료"), (TRIAL, "무료 체험"), (STANDARD, "4,900원 이용권"), (PLUS, "9,900원 이용권"),
             (BETA, "무료 베타"), (PARTNER, "파트너 무료"), (EMPLOYEE, "직원 무료"), (OWNER, "소유자·관리자")]
    # kind -> (Crema models provided, monthly model budget in won). Voice: every kind but free and 4,900원.
    DEFAULTS = {FREE: (False, 0), TRIAL: (False, 0), STANDARD: (False, 0), PLUS: (False, 0), BETA: (False, 0),
                PARTNER: (True, 10000), EMPLOYEE: (True, 10000), OWNER: (True, 10000)}
    NO_VOICE = {FREE, STANDARD}
    # Which kind is better, for invite codes that only raise one.
    RANK = [FREE, TRIAL, STANDARD, BETA, PLUS, PARTNER, EMPLOYEE, OWNER]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="membership")
    kind = models.CharField("종류", max_length=8, choices=KINDS, default=TRIAL)
    starts_at = models.DateTimeField("시작", default=timezone.now)
    expires_at = models.DateTimeField("끝나는 때", null=True, blank=True, help_text="비우면 계속. 지나면 무료로 씁니다.")
    cycle = models.CharField("갱신", max_length=8, choices=[("once", "전체 기간"), ("monthly", "시작일 기준 매월")],
                             default="monthly")
    voice_allowance_ms = models.PositiveBigIntegerField(
        "기간당 음성 시간 (밀리초)", default=7200000, help_text="60분 = 3,600,000 / 120분 = 7,200,000")
    key_limit_usd = models.DecimalField("월 교정 비용 한도 (USD)", max_digits=8, decimal_places=2, default=Decimal("1.00"))
    models_provided = models.BooleanField("Crema 모델 제공", default=False)
    model_budget_krw = models.PositiveIntegerField("월 모델 한도(원)", default=0)
    suspended_at = models.DateTimeField("정지한 때", null=True, blank=True, help_text="정지하면 앱 로그인이 모두 끊깁니다.")
    note = models.CharField("부여·변경 사유", max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = verbose_name_plural = "Crema 이용권"

    def __str__(self):
        return f"{self.user.email} · {self.get_kind_display()}"

    @classmethod
    def of(cls, user) -> "Membership":
        """The account's access; a new account gets the trial (all of Crema, voice included) for its days."""
        return cls.objects.get_or_create(user=user, defaults={
            "kind": cls.TRIAL, "expires_at": timezone.now() + timedelta(days=settings.CREMA_TRIAL_DAYS)})[0]

    def apply_kind(self, kind: str) -> None:
        """Set a kind with its default models and budget."""
        self.kind = kind
        self.models_provided, self.model_budget_krw = self.DEFAULTS[kind]

    def summary(self, now) -> dict:
        """What the app follows: an ended access is the free kind (the app keeps working, narrowly)."""
        ended = self.expires_at is not None and self.expires_at <= now
        kind = self.FREE if ended else self.kind
        provided, budget = self.DEFAULTS[self.FREE] if ended else (self.models_provided, self.model_budget_krw)
        return {"kind": kind, "label": dict(self.KINDS)[kind], "full": kind != self.FREE,
                "voice": kind not in self.NO_VOICE, "models": provided, "budget": budget if provided else 0,
                "until": None if ended or not self.expires_at else self.expires_at.isoformat()}


class InviteCode(models.Model):
    """A one-time code, entered in the app, that gives one member a kind of access (as Thock's invite codes)."""

    code = models.CharField("코드", max_length=16, unique=True, default=new_invite_code, editable=False)
    kind = models.CharField("종류", max_length=8, default=Membership.PARTNER, choices=[
        (Membership.BETA, "무료 베타"), (Membership.PARTNER, "파트너 무료"), (Membership.EMPLOYEE, "직원 무료")])
    days = models.PositiveIntegerField("기간(일)", null=True, blank=True, help_text="받은 날부터. 비우면 계속.")
    models_provided = models.BooleanField("Crema 모델 제공", null=True, blank=True, help_text="비우면 종류 기본값")
    model_budget_krw = models.PositiveIntegerField("월 모델 한도(원)", null=True, blank=True, help_text="비우면 종류 기본값")
    note = models.CharField("받는 사람 메모", max_length=200)
    expires_at = models.DateTimeField("사용 기한")
    created_at = models.DateTimeField(auto_now_add=True)
    used_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                related_name="+", verbose_name="쓴 사람")
    used_at = models.DateTimeField("쓴 때", null=True, blank=True)

    class Meta:
        verbose_name = verbose_name_plural = "초대 코드"

    def __str__(self):
        return f"{self.code} · {self.get_kind_display()} · {self.note}"

    def redeem(self, user, now) -> str:
        """Give the member this code's kind; "" when done, else why not (the code stays unused then)."""
        if self.used_at:
            return "code_used"
        if self.expires_at <= now:
            return "code_expired"
        membership = Membership.of(user)
        current = membership.summary(now)["kind"]
        if Membership.RANK.index(current) >= Membership.RANK.index(self.kind):
            return "access_exists"
        membership.apply_kind(self.kind)
        if self.models_provided is not None:
            membership.models_provided = self.models_provided
        if self.model_budget_krw is not None:
            membership.model_budget_krw = self.model_budget_krw
        membership.starts_at, membership.cycle = now, "monthly"
        membership.expires_at = now + timedelta(days=self.days) if self.days else None
        membership.note = f"초대 코드 {self.code} ({self.note})"[:200]
        membership.save()
        self.used_by, self.used_at = user, now
        self.save(update_fields=["used_by", "used_at"])
        return ""


class ModelUsage(models.Model):
    """One request through Crema's AI window: what it cost, for the member's monthly budget."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="model_usage")
    at = models.DateTimeField(auto_now_add=True, db_index=True)
    model = models.CharField(max_length=80)
    prompt_tokens = models.PositiveIntegerField(default=0)
    completion_tokens = models.PositiveIntegerField(default=0)
    cost_usd = models.DecimalField(max_digits=12, decimal_places=6, default=0)
    cost_krw = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = verbose_name_plural = "모델 사용량"

    @classmethod
    def spent_this_month(cls, user, now) -> int:
        """Won used since the first of this month (Korea time), from the exact dollar costs (one small
        request rounds to 0 won, many of them do not)."""
        start = timezone.localtime(now).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        usd = cls.objects.filter(user=user, at__gte=start).aggregate(total=models.Sum("cost_usd"))["total"] or 0
        return round(float(usd) * settings.CREMA_USD_KRW)

