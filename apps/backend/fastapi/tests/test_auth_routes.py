from __future__ import annotations

from datetime import datetime, timedelta, timezone
import sys
from pathlib import Path
from uuid import uuid4

from authlib.integrations.base_client.errors import OAuthError
from fastapi.testclient import TestClient
from starlette.responses import RedirectResponse

base_dir = Path(__file__).resolve().parents[1]
repo_root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(base_dir))
sys.path.insert(0, str(repo_root))

from config import Settings  # noqa: E402
from server import create_app  # noqa: E402
from services.auth.session_service import SessionService  # noqa: E402
from services.auth.types import AuthUser, SessionUser, StoredGoogleToken  # noqa: E402


class FakeAuthRepository:
    def __init__(self):
        self.users_by_sub: dict[str, AuthUser] = {}
        self.tokens_by_user_id: dict[str, StoredGoogleToken] = {}
        self.sessions_by_hash: dict[str, dict] = {}
        self.bootstrap_calls = 0

    def bootstrap_schema(self) -> None:
        self.bootstrap_calls += 1

    def upsert_user(
        self,
        *,
        google_sub: str,
        email: str,
        name: str | None,
        avatar_url: str | None,
    ) -> AuthUser:
        existing = self.users_by_sub.get(google_sub)
        user = AuthUser(
            id=existing.id if existing else str(uuid4()),
            google_sub=google_sub,
            email=email,
            name=name,
            avatar_url=avatar_url,
        )
        self.users_by_sub[google_sub] = user
        return user

    def store_google_token(self, token: StoredGoogleToken) -> StoredGoogleToken:
        existing = self.tokens_by_user_id.get(token.user_id)
        stored = StoredGoogleToken(
            user_id=token.user_id,
            access_token=token.access_token,
            refresh_token=token.refresh_token or (existing.refresh_token if existing else None),
            id_token=token.id_token,
            scope=token.scope,
            token_type=token.token_type,
            expires_at=token.expires_at,
        )
        self.tokens_by_user_id[token.user_id] = stored
        return stored

    def create_auth_session(
        self,
        *,
        user_id: str,
        session_token_hash: str,
        expires_at: datetime,
        created_at: datetime,
        last_seen_at: datetime,
    ) -> str:
        session_id = str(uuid4())
        self.sessions_by_hash[session_token_hash] = {
            "session_id": session_id,
            "user_id": user_id,
            "expires_at": expires_at,
            "created_at": created_at,
            "last_seen_at": last_seen_at,
        }
        return session_id

    def fetch_session_user(self, session_token_hash: str) -> SessionUser | None:
        record = self.sessions_by_hash.get(session_token_hash)
        if record is None:
            return None

        user = next((candidate for candidate in self.users_by_sub.values() if candidate.id == record["user_id"]), None)
        if user is None:
            return None

        token = self.tokens_by_user_id.get(user.id)
        return SessionUser(
            session_id=record["session_id"],
            user_id=user.id,
            email=user.email,
            name=user.name,
            avatar_url=user.avatar_url,
            expires_at=record["expires_at"],
            last_seen_at=record["last_seen_at"],
            google_scope=token.scope if token else None,
        )

    def touch_session(self, session_id: str, last_seen_at: datetime) -> None:
        for record in self.sessions_by_hash.values():
            if record["session_id"] == session_id:
                record["last_seen_at"] = last_seen_at
                return

    def delete_session_by_hash(self, session_token_hash: str) -> bool:
        return self.sessions_by_hash.pop(session_token_hash, None) is not None

    def get_google_credentials_for_user(self, user_id: str) -> StoredGoogleToken | None:
        return self.tokens_by_user_id.get(user_id)


class FakeGoogleClient:
    def __init__(self):
        self.token_response = {
            "access_token": "access-token-1",
            "refresh_token": "refresh-token-1",
            "id_token": "id-token-1",
            "scope": "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
            "token_type": "Bearer",
            "expires_at": int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp()),
            "userinfo": {
                "sub": "google-sub-1",
                "email": "player@example.com",
                "name": "Player One",
                "picture": "https://example.com/avatar.png",
            },
        }
        self.raise_error: Exception | None = None

    async def authorize_redirect(self, request, redirect_uri: str):
        return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?redirect_uri={redirect_uri}")

    async def authorize_access_token(self, request):
        if self.raise_error is not None:
            raise self.raise_error
        return dict(self.token_response)

    async def fetch_userinfo(self, token):
        return dict(token["userinfo"])


def make_settings() -> Settings:
    return Settings(
        google_client_id="client-id",
        google_client_secret="client-secret",
        backend_public_url="http://localhost:9812",
        webapp_origin="http://localhost:5173",
        session_cookie_name="athens_session",
        session_ttl_seconds=604800,
        session_cookie_secure=False,
        session_cookie_same_site="lax",
        app_secret_key="test-secret",
        database_url="postgresql://unused",
    )


def make_client():
    settings = make_settings()
    repository = FakeAuthRepository()
    google_client = FakeGoogleClient()
    app = create_app(
        settings=settings,
        auth_repository=repository,
        google_client=google_client,
        bootstrap_db=False,
    )
    return TestClient(app), settings, repository, google_client


def test_auth_session_without_cookie_returns_unauthenticated():
    client, _, _, _ = make_client()
    with client:
        response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.json() == {
        "authenticated": False,
        "user": None,
        "gmailScopesGranted": False,
    }


def test_logout_without_cookie_returns_no_content():
    client, _, _, _ = make_client()
    with client:
        response = client.post("/auth/logout")

    assert response.status_code == 204


def test_successful_callback_creates_user_token_session_and_cookie():
    client, _, repository, _ = make_client()
    with client:
        response = client.get("/auth/google/callback", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"] == "http://localhost:5173/"
    assert "athens_session=" in response.headers["set-cookie"]
    assert len(repository.users_by_sub) == 1
    stored_user = repository.users_by_sub["google-sub-1"]
    assert stored_user.email == "player@example.com"
    stored_token = repository.tokens_by_user_id[stored_user.id]
    assert stored_token.refresh_token == "refresh-token-1"
    assert len(repository.sessions_by_hash) == 1


def test_second_callback_preserves_existing_refresh_token():
    client, _, repository, google_client = make_client()
    with client:
        first = client.get("/auth/google/callback", follow_redirects=False)
        assert first.status_code == 302

        google_client.token_response = {
            **google_client.token_response,
            "access_token": "access-token-2",
            "refresh_token": None,
            "userinfo": {
                **google_client.token_response["userinfo"],
                "name": "Player Prime",
                "picture": "https://example.com/updated-avatar.png",
            },
        }
        second = client.get("/auth/google/callback", follow_redirects=False)

    assert second.status_code == 302
    stored_user = repository.users_by_sub["google-sub-1"]
    assert stored_user.name == "Player Prime"
    assert stored_user.avatar_url == "https://example.com/updated-avatar.png"
    stored_token = repository.tokens_by_user_id[stored_user.id]
    assert stored_token.access_token == "access-token-2"
    assert stored_token.refresh_token == "refresh-token-1"


def test_invalid_state_redirects_with_auth_error():
    client, _, _, google_client = make_client()
    google_client.raise_error = OAuthError(error="invalid_state")

    with client:
        response = client.get("/auth/google/callback", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"] == "http://localhost:5173/?auth_error=google_oauth_failed"


def test_expired_session_returns_unauthenticated_and_clears_cookie():
    client, settings, repository, _ = make_client()
    session_service = SessionService(settings, repository)
    user = repository.upsert_user(
        google_sub="google-sub-1",
        email="player@example.com",
        name="Player One",
        avatar_url=None,
    )
    repository.store_google_token(
        StoredGoogleToken(
            user_id=user.id,
            access_token="access-token-1",
            refresh_token="refresh-token-1",
            id_token="id-token-1",
            scope="openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
            token_type="Bearer",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
    )
    session_token = "expired-session"
    repository.create_auth_session(
        user_id=user.id,
        session_token_hash=session_service.hash_session_token(session_token),
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        created_at=datetime.now(timezone.utc) - timedelta(hours=1),
        last_seen_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )

    with client:
        client.cookies.set(settings.session_cookie_name, session_token)
        response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.json()["authenticated"] is False
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert not repository.sessions_by_hash


def test_logout_deletes_session_row_and_clears_cookie():
    client, settings, repository, _ = make_client()
    session_service = SessionService(settings, repository)
    user = repository.upsert_user(
        google_sub="google-sub-1",
        email="player@example.com",
        name="Player One",
        avatar_url=None,
    )
    session_token = session_service.create_session(user.id)

    with client:
        client.cookies.set(settings.session_cookie_name, session_token)
        response = client.post("/auth/logout")

    assert response.status_code == 204
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert not repository.sessions_by_hash


def test_session_returns_authenticated_user_and_scope_status():
    client, settings, repository, _ = make_client()
    session_service = SessionService(settings, repository)
    user = repository.upsert_user(
        google_sub="google-sub-1",
        email="player@example.com",
        name="Player One",
        avatar_url="https://example.com/avatar.png",
    )
    repository.store_google_token(
        StoredGoogleToken(
            user_id=user.id,
            access_token="access-token-1",
            refresh_token="refresh-token-1",
            id_token="id-token-1",
            scope="openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
            token_type="Bearer",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
    )
    session_token = session_service.create_session(user.id)

    with client:
        client.cookies.set(settings.session_cookie_name, session_token)
        response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.json() == {
        "authenticated": True,
        "user": {
            "id": user.id,
            "email": "player@example.com",
            "name": "Player One",
            "avatarUrl": "https://example.com/avatar.png",
        },
        "gmailScopesGranted": True,
    }


def test_cors_allows_frontend_origin_and_credentials():
    client, _, _, _ = make_client()
    with client:
        response = client.options(
            "/auth/session",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_settings_default_cookie_same_site_is_lax(monkeypatch):
    monkeypatch.delenv("SESSION_COOKIE_SAME_SITE", raising=False)
    monkeypatch.delenv("SESSION_COOKIE_SECURE", raising=False)

    settings = Settings.from_env()

    assert settings.session_cookie_same_site == "lax"


def test_settings_reject_invalid_cookie_same_site(monkeypatch):
    monkeypatch.setenv("SESSION_COOKIE_SAME_SITE", "bogus")

    try:
        Settings.from_env()
    except ValueError as exc:
        assert str(exc) == "SESSION_COOKIE_SAME_SITE must be one of: lax, strict, none"
    else:
        raise AssertionError("Expected ValueError for invalid SameSite")


def test_settings_require_secure_when_same_site_none(monkeypatch):
    monkeypatch.setenv("SESSION_COOKIE_SAME_SITE", "none")
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "false")

    try:
        Settings.from_env()
    except ValueError as exc:
        assert str(exc) == "SESSION_COOKIE_SECURE must be true when SESSION_COOKIE_SAME_SITE=none"
    else:
        raise AssertionError("Expected ValueError for insecure SameSite=None")


def test_session_service_uses_configured_same_site_cookie():
    settings = Settings(
        google_client_id="client-id",
        google_client_secret="client-secret",
        backend_public_url="http://localhost:9812",
        webapp_origin="http://localhost:5173",
        session_cookie_name="athens_session",
        session_ttl_seconds=604800,
        session_cookie_secure=True,
        session_cookie_same_site="none",
        app_secret_key="test-secret",
        database_url="postgresql://unused",
    )
    repository = FakeAuthRepository()
    session_service = SessionService(settings, repository)
    response = RedirectResponse("http://localhost:5173/")

    session_service.set_session_cookie(response, "token")

    assert "SameSite=none" in response.headers["set-cookie"]


def test_app_uses_configured_same_site_for_oauth_state_cookie():
    settings = Settings(
        google_client_id="client-id",
        google_client_secret="client-secret",
        backend_public_url="http://localhost:9812",
        webapp_origin="http://localhost:5173",
        session_cookie_name="athens_session",
        session_ttl_seconds=604800,
        session_cookie_secure=True,
        session_cookie_same_site="none",
        app_secret_key="test-secret",
        database_url="postgresql://unused",
    )
    repository = FakeAuthRepository()
    google_client = FakeGoogleClient()
    app = create_app(settings=settings, auth_repository=repository, google_client=google_client, bootstrap_db=False)

    session_middleware = next(m for m in app.user_middleware if m.cls.__name__ == "SessionMiddleware")

    assert session_middleware.kwargs["same_site"] == "none"
