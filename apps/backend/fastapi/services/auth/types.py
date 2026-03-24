from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(slots=True)
class AuthUser:
    id: str
    google_sub: str
    email: str
    name: str | None
    avatar_url: str | None


@dataclass(slots=True)
class StoredGoogleToken:
    user_id: str
    access_token: str
    refresh_token: str | None
    id_token: str | None
    scope: str
    token_type: str | None
    expires_at: datetime | None


@dataclass(slots=True)
class SessionUser:
    session_id: str
    user_id: str
    email: str
    name: str | None
    avatar_url: str | None
    expires_at: datetime
    last_seen_at: datetime
    google_scope: str | None
