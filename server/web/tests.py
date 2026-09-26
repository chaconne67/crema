import base64
import hashlib
import json
from urllib.parse import parse_qs, urlparse

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import AppToken, LoginCode

VERIFIER = "v" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()
STATE = "state-1234567890abcdef"


@override_settings(SECURE_SSL_REDIRECT=False)
class PagesTests(TestCase):
    def test_home_offers_the_latest_installer_and_sign_in(self):
        page = self.client.get("/").content.decode()
        self.assertIn("releases/latest/download/Crema-setup-x64.exe", page)
        self.assertIn("/accounts/google/login/", page)

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
        self.assertEqual(me.json(), {"email": "me@example.com", "name": "주인"})
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
