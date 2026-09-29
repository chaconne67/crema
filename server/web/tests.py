import base64
import hashlib
import io
import json
from datetime import timedelta
from unittest import mock
from urllib.parse import parse_qs, urlparse

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import AppToken, Invite, LoginCode, Membership, Subscription

VERIFIER = "v" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()
STATE = "state-1234567890abcdef"


@override_settings(SECURE_SSL_REDIRECT=False)
class PagesTests(TestCase):
    def test_home_asks_to_sign_up_before_the_installer(self):
        page = self.client.get("/").content.decode()
        self.assertIn("/accounts/google/login/?next=/start/", page)
        self.assertNotIn("releases/latest/download/Crema-setup-x64.exe", page)
        self.assertNotIn("/download/", page)

    def test_installer_and_welcome_need_sign_in_then_give_the_latest_release(self):
        for path in ("/start/", "/download/"):
            self.assertTrue(self.client.get(path)["Location"].startswith("/accounts/google/login/"))
        user = get_user_model().objects.create_user("new", email="new@example.com", first_name="새")
        self.client.force_login(user)
        page = self.client.get("/start/").content.decode()
        self.assertIn("환영합니다, 새님", page)
        self.assertIn("무료 회원", page)
        self.assertIn("/download/", page)
        self.assertEqual(self.client.get("/download/")["Location"],
                         "https://github.com/chaconne67/crema/releases/latest/download/Crema-setup-x64.exe")
        self.assertIn("설치 파일 받기", self.client.get("/").content.decode())

    def test_a_suspended_account_gets_no_installer(self):
        user = get_user_model().objects.create_user("stop", email="stop@example.com")
        Membership.objects.create(user=user, suspended_at=timezone.now())
        self.client.force_login(user)
        self.assertEqual(self.client.get("/download/").status_code, 403)
        self.assertIn("이용이 멈춘 계정", self.client.get("/start/").content.decode())

    def test_policy_pages_and_health(self):
        for path in ("/privacy/", "/terms/"):
            self.assertEqual(self.client.get(path).status_code, 200)
        self.assertEqual(self.client.get("/health/").content, b"ok")

    def test_free_catalog_is_the_file_the_app_bundles_readable_from_the_app(self):
        response = self.client.get("/api/free-catalog")
        self.assertEqual(response["Access-Control-Allow-Origin"], "*")
        catalog = response.json()
        self.assertEqual([item["id"] for item in catalog["providers"]], ["gemini", "groq", "openrouter", "mistral"])
        self.assertTrue(all(model["tier"] in (1, 2, 3) for item in catalog["providers"] for model in item["models"]))

    def test_account_needs_sign_in(self):
        response = self.client.get("/account/")
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response["Location"].startswith("/accounts/google/login/"))


@override_settings(SECURE_SSL_REDIRECT=False)
class AppSignInTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("u1", email="me@example.com", first_name="주인")

    def begin(self):
        return self.client.get("/app/login/", {"port": "52123", "state": STATE, "challenge": CHALLENGE})

    def signed_in_code(self):
        self.client.force_login(self.user)
        self.assertRedirects(self.begin(), "/app/complete/", fetch_redirect_response=False)
        back = urlparse(self.client.get("/app/complete/")["Location"])
        self.assertEqual((back.scheme, back.hostname, back.port, back.path), ("http", "127.0.0.1", 52123, "/callback"))
        query = parse_qs(back.query)
        self.assertEqual(query["state"], [STATE])
        return query["code"][0]

    def exchange(self, code, verifier=VERIFIER):
        return self.client.post("/api/app/token", json.dumps({"code": code, "verifier": verifier}), content_type="application/json")

    def test_signed_out_start_goes_to_google_then_back_to_the_app(self):
        response = self.begin()
        self.assertEqual(response["Location"], "/accounts/google/login/?next=/app/complete/")

    def test_rejects_a_start_that_is_not_from_the_app(self):
        for bad in ({"port": "80", "state": STATE, "challenge": CHALLENGE}, {"port": "52123", "state": "x", "challenge": CHALLENGE}):
            self.assertEqual(self.client.get("/app/login/", bad).status_code, 400)

    def test_code_and_verifier_give_a_token_that_signs_the_app_in(self):
        body = self.exchange(self.signed_in_code()).json()
        self.assertEqual(body["email"], "me@example.com")
        me = self.client.get("/api/me", HTTP_AUTHORIZATION=f"Bearer {body['token']}")
        self.assertEqual(me.json(), {"email": "me@example.com", "name": "주인", "member": {
            "grade": "free", "label": "무료 회원", "full": False, "models": False, "budget": 0, "until": None}, "plan": {
            "status": "none", "days_left": None, "price": 4900, "card": "", "paid_until": None}})
        self.assertNotEqual(AppToken.objects.get().token_hash, body["token"])

    def test_wrong_verifier_and_reused_code_are_refused(self):
        code = self.signed_in_code()
        self.assertEqual(self.exchange(code, verifier="w" * 64).status_code, 400)
        self.assertEqual(self.exchange(code).status_code, 200)
        self.assertEqual(self.exchange(code).status_code, 400)

    def test_complete_without_a_start_asks_to_restart(self):
        self.client.force_login(self.user)
        self.assertEqual(self.client.get("/app/complete/").status_code, 400)
        self.assertFalse(LoginCode.objects.exists())

    def test_sign_out_and_account_deletion_end_app_sign_in(self):
        token = self.exchange(self.signed_in_code()).json()["token"]
        auth = {"HTTP_AUTHORIZATION": f"Bearer {token}"}
        self.assertEqual(self.client.post("/api/app/logout", **auth).status_code, 204)
        self.assertEqual(self.client.get("/api/me", **auth).status_code, 401)

        token = self.exchange(self.signed_in_code()).json()["token"]
        self.client.force_login(self.user)
        self.client.post("/account/delete/")
        self.assertFalse(get_user_model().objects.exists())
        self.assertEqual(self.client.get("/api/me", HTTP_AUTHORIZATION=f"Bearer {token}").status_code, 401)


class JevReply:
    def __init__(self, answers):
        self.body = json.dumps({"model": "jev-1.13.0", "answers": answers}).encode()

    def __enter__(self):
        return io.BytesIO(self.body)

    def __exit__(self, *exc):
        return False


@override_settings(SECURE_SSL_REDIRECT=False, TYPESAFE_API_KEY="ts-test")
class RouteTests(TestCase):
    ANSWERS = {
        "difficulty": {"type": "score", "score": 2.1, "confidence": 0.8},
        "needs_tools": {"type": "noul", "noul": 0.1},
        "sensitive": {"type": "noul", "noul": 0.9},
    }

    def setUp(self):
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {AppToken.issue(get_user_model().objects.create_user('u2'))}"}

    def route(self, body, **extra):
        return self.client.post("/api/route", json.dumps(body), content_type="application/json", **extra)

    def test_judges_a_signed_in_apps_request_with_jev(self):
        with mock.patch("web.views.urllib.request.urlopen", return_value=JevReply(self.ANSWERS)) as urlopen:
            response = self.route({"text": "x" * 5000}, **self.auth)
        self.assertEqual(response.json(), {"difficulty": 2.1, "confidence": 0.8, "needs_tools": 0.1, "sensitive": 0.9})
        sent = urlopen.call_args.args[0]
        self.assertEqual(sent.headers["Authorization"], "Bearer ts-test")
        self.assertEqual(len(json.loads(sent.data)["state"]), 2000)

    def test_refuses_without_sign_in_and_says_when_jev_is_unreachable(self):
        self.assertEqual(self.route({"text": "안녕"}).status_code, 401)
        self.assertEqual(self.route({"text": " "}, **self.auth).status_code, 400)
        with mock.patch("web.views.urllib.request.urlopen", side_effect=OSError("timed out")):
            self.assertEqual(self.route({"text": "안녕"}, **self.auth).status_code, 502)
        with override_settings(TYPESAFE_API_KEY=""):
            self.assertEqual(self.route({"text": "안녕"}, **self.auth).status_code, 503)

    def test_picks_the_sign_up_guides_next_element_with_jev(self):
        answers = {
            "next": {"type": "choice", "choice": "e2", "confidence": 0.9},
            "consent": {"type": "noul", "noul": 0.1},
            "blocked": {"type": "noul", "noul": 0.05},
        }
        body = {"goal": "Get a Gemini API key", "url": "https://aistudio.google.com/apikey", "elements": {"e1": "link: Docs", "e2": "button: Get API key"}}
        with mock.patch("web.views.urllib.request.urlopen", return_value=JevReply(answers)) as urlopen:
            response = self.client.post("/api/onboarding/step", json.dumps(body), content_type="application/json", **self.auth)
        self.assertEqual(response.json(), {"target": "e2", "confidence": 0.9, "consent": 0.1, "blocked": 0.05})
        sent = json.loads(urlopen.call_args.args[0].data)
        self.assertEqual(set(sent["questions"]["next"]["criteria"]), {"e1", "e2", "none"})
        answers["next"]["choice"] = "none"
        with mock.patch("web.views.urllib.request.urlopen", return_value=JevReply(answers)):
            response = self.client.post("/api/onboarding/step", json.dumps(body), content_type="application/json", **self.auth)
        self.assertIsNone(response.json()["target"])
        self.assertEqual(self.client.post("/api/onboarding/step", json.dumps(body), content_type="application/json").status_code, 401)
        self.assertEqual(self.client.post("/api/onboarding/step", json.dumps({"goal": "x"}), content_type="application/json", **self.auth).status_code, 400)

    def test_says_why_the_user_is_stuck_with_jev(self):
        answers = {"cause": {"type": "choice", "choice": "verification", "confidence": 0.8}}
        body = {
            "goal": "Get a Gemini API key", "step": "구글 계정으로 로그인하세요", "url": "https://accounts.google.com/v3/signin",
            "elements": {"e0": "input: Enter code"}, "errors": ["Wrong code. Try again."],
        }
        with mock.patch("web.views.urllib.request.urlopen", return_value=JevReply(answers)) as urlopen:
            response = self.client.post("/api/onboarding/help", json.dumps(body), content_type="application/json", **self.auth)
        self.assertEqual(response.json(), {"cause": "verification", "confidence": 0.8})
        sent = json.loads(urlopen.call_args.args[0].data)
        self.assertIn("other", sent["questions"]["cause"]["criteria"])
        self.assertEqual(sent["state"]["errors"], ["Wrong code. Try again."])
        self.assertEqual(self.client.post("/api/onboarding/help", json.dumps(body), content_type="application/json").status_code, 401)
        self.assertEqual(self.client.post("/api/onboarding/help", json.dumps({"goal": "x"}), content_type="application/json", **self.auth).status_code, 400)


@override_settings(SECURE_SSL_REDIRECT=False)
class PlanTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("u2", email="plan@example.com")
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {AppToken.issue(self.user)}"}

    def plan(self):
        return self.client.get("/api/me", **self.auth).json()["plan"]

    def test_trial_days_left_count_the_last_day(self):
        now = timezone.now()
        Subscription.objects.create(user=self.user, status="trial", trial_ends_at=now + timedelta(days=29, hours=1))
        self.assertEqual(self.plan()["days_left"], 30)
        Subscription.objects.filter(user=self.user).update(trial_ends_at=now + timedelta(hours=1))
        self.assertEqual(self.plan()["days_left"], 1)
        Subscription.objects.filter(user=self.user).update(trial_ends_at=now - timedelta(hours=1))
        self.assertEqual(self.plan()["days_left"], 0)

    def test_paid_plan_shows_card_and_period_and_goes_with_the_account(self):
        until = timezone.now() + timedelta(days=20)
        Subscription.objects.create(user=self.user, status="paid", paid_until=until, card_label="신한 1234")
        plan = self.plan()
        self.assertEqual((plan["status"], plan["card"], plan["price"], plan["paid_until"]), ("paid", "신한 1234", 4900, until.isoformat()))
        self.user.delete()
        self.assertFalse(Subscription.objects.exists())


@override_settings(SECURE_SSL_REDIRECT=False)
class MembershipTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("u3", email="grade@example.com")
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {AppToken.issue(self.user)}"}

    def member(self):
        return self.client.get("/api/me", **self.auth).json()["member"]

    def test_a_new_account_is_a_free_member(self):
        self.assertEqual(self.member(), {"grade": "free", "label": "무료 회원", "full": False, "models": False, "budget": 0, "until": None})

    def test_grades_bring_their_use_and_models(self):
        membership = Membership.of(self.user)
        for grade, full, models, budget in (("paid", True, False, 0), ("beta", True, False, 0), ("staff", True, True, 10000),
                                            ("gift", True, True, 10000), ("admin", True, True, 10000)):
            membership.apply_grade(grade)
            membership.save()
            got = self.member()
            self.assertEqual((got["grade"], got["full"], got["models"], got["budget"]), (grade, full, models, budget))

    def test_an_expired_grade_is_a_free_member(self):
        membership = Membership.of(self.user)
        membership.apply_grade("gift")
        membership.expires_at = timezone.now() + timedelta(days=90)
        membership.save()
        self.assertEqual((self.member()["grade"], self.member()["full"]), ("gift", True))
        Membership.objects.filter(user=self.user).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.member(), {"grade": "free", "label": "무료 회원", "full": False, "models": False, "budget": 0, "until": None})

    def test_a_suspended_account_is_signed_out_of_the_app(self):
        Membership.objects.create(user=self.user, suspended_at=timezone.now())
        self.assertEqual(self.client.get("/api/me", **self.auth).status_code, 401)


@override_settings(SECURE_SSL_REDIRECT=False)
class AdminTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_user("boss", email="boss@example.com", is_staff=True, is_superuser=True)
        self.member = get_user_model().objects.create_user("m", email="m@example.com")
        self.token = AppToken.issue(self.member)

    def test_admin_signs_in_with_google_and_only_staff_get_in(self):
        self.assertEqual(self.client.get("/admin/login/?next=/admin/")["Location"], "/accounts/google/login/?next=/admin/")
        self.client.force_login(self.member)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.client.force_login(self.admin)
        self.assertEqual(self.client.get("/admin/").status_code, 200)

    def test_changing_the_grade_brings_its_defaults_and_suspending_ends_app_sign_in(self):
        self.client.force_login(self.admin)
        membership = Membership.of(self.member)
        url = f"/admin/web/membership/{membership.pk}/change/"
        form = {"grade": "staff", "model_budget_krw": 0, "note": ""}
        self.assertEqual(self.client.post(url, form).status_code, 302)
        membership.refresh_from_db()
        self.assertEqual((membership.full_access, membership.models_provided, membership.model_budget_krw), (True, True, 10000))
        self.client.post("/admin/web/membership/", {"action": "suspend", "_selected_action": [membership.pk]})
        self.assertFalse(AppToken.objects.filter(user=self.member).exists())
        self.assertEqual(self.client.get("/api/me", HTTP_AUTHORIZATION=f"Bearer {self.token}").status_code, 401)


@override_settings(SECURE_SSL_REDIRECT=False)
class InviteTests(TestCase):
    def setUp(self):
        self.invite = Invite.objects.create(code="gift-ceo", grade="gift", days=90, max_uses=2, note="대표님 선물")

    def join(self, name):
        user = get_user_model().objects.create_user(name, email=f"{name}@example.com")
        self.client.force_login(user)
        return user, self.client.get("/i/gift-ceo/")

    def test_signed_out_goes_to_google_and_comes_back_to_the_link(self):
        self.assertEqual(self.client.get("/i/gift-ceo/")["Location"], "/accounts/google/login/?next=/i/gift-ceo/")

    def test_joining_gives_the_grade_for_its_days_and_counts_the_use(self):
        user, response = self.join("a")
        self.assertEqual(response["Location"], "/start/")
        member = Membership.of(user).summary(timezone.now())
        self.assertEqual((member["grade"], member["full"], member["models"], member["budget"]), ("gift", True, True, 10000))
        self.assertAlmostEqual((Membership.of(user).expires_at - timezone.now()).days, 89, delta=1)
        self.assertEqual(self.invite.uses.count(), 1)
        self.client.get("/i/gift-ceo/")  # again: no second use
        self.assertEqual(self.invite.uses.count(), 1)

    def test_a_full_or_expired_link_says_so_and_a_better_grade_stays(self):
        self.join("a")
        self.join("b")
        self.assertEqual(self.join("c")[1].status_code, 410)
        Invite.objects.create(code="old", grade="beta", valid_until=timezone.now() - timedelta(days=1))
        self.assertEqual(self.client.get("/i/old/").status_code, 410)
        self.assertEqual(self.client.get("/i/nothing/").status_code, 404)
        staff = get_user_model().objects.create_user("s", email="s@example.com")
        membership = Membership.of(staff)
        membership.apply_grade("staff")
        membership.save()
        Invite.objects.create(code="beta-1", grade="beta", days=30)
        self.client.force_login(staff)
        self.client.get("/i/beta-1/")
        self.assertEqual(Membership.of(staff).summary(timezone.now())["grade"], "staff")

