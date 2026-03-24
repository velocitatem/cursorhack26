from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from authlib.integrations.starlette_client import OAuth

from config import Settings

GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GOOGLE_GMAIL_SCOPES = {
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
}
GOOGLE_SCOPE = " ".join(
    [
        "openid",
        "email",
        "profile",
        *sorted(GOOGLE_GMAIL_SCOPES),
    ]
)


def normalize_scope(scope: Any) -> str:
    if isinstance(scope, str):
        return scope.strip()
    if isinstance(scope, (list, tuple, set)):
        return " ".join(str(value) for value in scope)
    return ""


def gmail_scopes_granted(scope: str | None) -> bool:
    granted = set(normalize_scope(scope).split())
    return GOOGLE_GMAIL_SCOPES.issubset(granted)


class GoogleOAuthClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._oauth: OAuth | None = None

    def _get_client(self):
        if not self.settings.google_client_id or not self.settings.google_client_secret:
            raise RuntimeError("Google OAuth is not configured.")

        if self._oauth is None:
            self._oauth = OAuth()
            self._oauth.register(
                "google",
                client_id=self.settings.google_client_id,
                client_secret=self.settings.google_client_secret,
                server_metadata_url=GOOGLE_DISCOVERY_URL,
                client_kwargs={"scope": GOOGLE_SCOPE},
            )

        client = self._oauth.create_client("google")
        if client is None:
            raise RuntimeError("Google OAuth client is unavailable.")
        return client

    async def authorize_redirect(self, request, redirect_uri: str):
        client = self._get_client()
        return await client.authorize_redirect(
            request,
            redirect_uri,
            access_type="offline",
            prompt="consent",
            include_granted_scopes="true",
        )

    async def authorize_access_token(self, request) -> dict[str, Any]:
        client = self._get_client()
        return await client.authorize_access_token(request)

    async def fetch_userinfo(self, token: Mapping[str, Any]) -> dict[str, Any]:
        userinfo = token.get("userinfo")
        if isinstance(userinfo, Mapping):
            return dict(userinfo)

        client = self._get_client()
        response = await client.get(GOOGLE_USERINFO_URL, token=token)
        response.raise_for_status()
        return response.json()
