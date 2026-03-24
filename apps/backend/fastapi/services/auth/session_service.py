from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import secrets

from fastapi import Request
from starlette.responses import Response

from config import Settings
from services.auth.user_repository import AuthRepository


class SessionService:
    def __init__(self, settings: Settings, repository: AuthRepository):
        self.settings = settings
        self.repository = repository
        self.touch_interval = timedelta(minutes=15)

    def create_session(self, user_id: str) -> str:
        raw_token = secrets.token_urlsafe(48)
        token_hash = self.hash_session_token(raw_token)
        now = datetime.now(timezone.utc)
        self.repository.create_auth_session(
            user_id=user_id,
            session_token_hash=token_hash,
            expires_at=now + timedelta(seconds=self.settings.session_ttl_seconds),
            created_at=now,
            last_seen_at=now,
        )
        return raw_token

    def validate_session(self, request: Request):
        raw_token = self.get_session_token(request)
        if not raw_token:
            return None

        token_hash = self.hash_session_token(raw_token)
        session_user = self.repository.fetch_session_user(token_hash)
        if session_user is None:
            return None

        now = datetime.now(timezone.utc)
        if session_user.expires_at <= now:
            self.repository.delete_session_by_hash(token_hash)
            return None

        if now - session_user.last_seen_at >= self.touch_interval:
            self.repository.touch_session(session_user.session_id, now)
            session_user.last_seen_at = now

        return session_user

    def revoke_session(self, request: Request) -> bool:
        raw_token = self.get_session_token(request)
        if not raw_token:
            return False
        return self.repository.delete_session_by_hash(self.hash_session_token(raw_token))

    def get_session_token(self, request: Request) -> str | None:
        return request.cookies.get(self.settings.session_cookie_name)

    def set_session_cookie(self, response: Response, session_token: str) -> None:
        response.set_cookie(
            key=self.settings.session_cookie_name,
            value=session_token,
            max_age=self.settings.session_ttl_seconds,
            path="/",
            secure=self.settings.session_cookie_secure,
            httponly=True,
            samesite=self.settings.session_cookie_same_site,
        )

    def clear_session_cookie(self, response: Response) -> None:
        response.delete_cookie(
            key=self.settings.session_cookie_name,
            path="/",
            secure=self.settings.session_cookie_secure,
            httponly=True,
            samesite=self.settings.session_cookie_same_site,
        )

    @staticmethod
    def hash_session_token(session_token: str) -> str:
        return hashlib.sha256(session_token.encode("utf-8")).hexdigest()
