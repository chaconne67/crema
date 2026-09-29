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


def new_invite_code() -> str:
    return secrets.token_urlsafe(9)


class Membership(models.Model):
    """The account's grade and what it may use (docs: Crema-회원등급-계획-2026-09-29.md): whether the app
    is used in full or on the narrow free plan, whether Crema provides the AI models (with a monthly budget),
    until when; admins manage everyone here. An expired grade counts as a free member; a suspended account
    cannot use the app at all."""

    FREE, PAID, BETA, STAFF, GIFT, ADMIN = "free", "paid", "beta", "staff", "gift", "admin"
    GRADES = [(FREE, "무료 회원"), (PAID, "유료 회원"), (BETA, "베타 테스터"), (STAFF, "직원"),
              (GIFT, "한 세트"), (ADMIN, "관리자")]
    # grade -> (full use, models provided, monthly model budget in won); approved 2026-09-30.
    DEFAULTS = {FREE: (False, False, 0), PAID: (True, False, 0), BETA: (True, False, 0),
                STAFF: (True, True, 10000), GIFT: (True, True, 10000), ADMIN: (True, True, 10000)}

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="membership")
    grade = models.CharField("등급", max_length=8, choices=GRADES, default=FREE)
    full_access = models.BooleanField("전체 기능", default=False)
    models_provided = models.BooleanField("Crema 모델 제공", default=False)
    model_budget_krw = models.PositiveIntegerField("월 모델 한도(원)", default=0)
    expires_at = models.DateTimeField("끝나는 때", null=True, blank=True, help_text="비우면 계속. 지나면 무료 회원으로 씁니다.")
    suspended_at = models.DateTimeField("정지한 때", null=True, blank=True, help_text="정지하면 앱 로그인이 모두 끊깁니다.")
    note = models.CharField("메모", max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = verbose_name_plural = "회원 등급"

    def __str__(self):
        return f"{self.user.email} · {self.get_grade_display()}"

    @classmethod
    def of(cls, user) -> "Membership":
        return cls.objects.get_or_create(user=user)[0]

    def apply_grade(self, grade: str) -> None:
        """Set a grade with its default use, models and budget."""
        self.grade = grade
        self.full_access, self.models_provided, self.model_budget_krw = self.DEFAULTS[grade]

    def summary(self, now) -> dict:
        """What the app follows: an expired grade is a free member (the app keeps working, narrowly)."""
        expired = self.expires_at is not None and self.expires_at <= now
        grade = self.FREE if expired else self.grade
        if expired:
            full, provided, budget = self.DEFAULTS[self.FREE]
        else:
            full, provided, budget = self.full_access, self.models_provided, self.model_budget_krw
        return {"grade": grade, "label": dict(self.GRADES)[grade], "full": full, "models": provided,
                "budget": budget if provided else 0,
                "until": None if expired or not self.expires_at else self.expires_at.isoformat()}


class Invite(models.Model):
    """A link that gives whoever signs up with it a grade for some days (gifts, promotion, beta):
    crema-agent.site/i/<code>/. It only raises a grade and lengthens its time, never lowers them."""

    code = models.SlugField("코드", max_length=40, unique=True, default=new_invite_code)
    grade = models.CharField("줄 등급", max_length=8, choices=Membership.GRADES, default=Membership.GIFT)
    days = models.PositiveIntegerField("기간(일)", null=True, blank=True, default=90, help_text="받은 날부터. 비우면 계속.")
    models_provided = models.BooleanField("Crema 모델 제공", null=True, blank=True, help_text="비우면 등급 기본값")
    model_budget_krw = models.PositiveIntegerField("월 모델 한도(원)", null=True, blank=True, help_text="비우면 등급 기본값")
    max_uses = models.PositiveIntegerField("최대 인원", default=1)
    valid_until = models.DateTimeField("링크 유효 기한", null=True, blank=True)
    note = models.CharField("누구·어떤 홍보", max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = verbose_name_plural = "초대 링크"

    def __str__(self):
        return f"{self.code} · {self.get_grade_display()} · {self.note}"

    def usable(self, now) -> bool:
        return (self.valid_until is None or self.valid_until > now) and self.uses.count() < self.max_uses

    def redeem(self, user, now) -> bool:
        """Give the user this invite's grade unless theirs is already better; records the use once."""
        if self.uses.filter(user=user).exists():
            return True
        if not self.usable(now):
            return False
        membership = Membership.of(user)
        current = membership.summary(now)["grade"]
        if GRADE_RANK[current] <= GRADE_RANK[self.grade]:
            until = now + timedelta(days=self.days) if self.days else None
            if current == self.grade and membership.expires_at is None:
                until = None  # already this grade for good
            elif current == self.grade and until and membership.expires_at and membership.expires_at > until:
                until = membership.expires_at
            membership.apply_grade(self.grade)
            if self.models_provided is not None:
                membership.models_provided = self.models_provided
            if self.model_budget_krw is not None:
                membership.model_budget_krw = self.model_budget_krw
            membership.expires_at = until
            membership.note = (f"초대 {self.code}" + (f" · {self.note}" if self.note else ""))[:200]
            membership.save()
        InviteUse.objects.create(invite=self, user=user)
        return True


class InviteUse(models.Model):
    invite = models.ForeignKey(Invite, on_delete=models.CASCADE, related_name="uses")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="invite_uses")
    used_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("invite", "user")]


# Which grade is better, for invites that only raise a grade.
GRADE_RANK = {Membership.FREE: 0, Membership.PAID: 1, Membership.BETA: 2, Membership.GIFT: 3,
              Membership.STAFF: 4, Membership.ADMIN: 5}

