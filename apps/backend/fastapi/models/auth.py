from __future__ import annotations

from pydantic import BaseModel


class SessionUserPayload(BaseModel):
    id: str
    email: str
    name: str | None
    avatarUrl: str | None


class SessionResponse(BaseModel):
    authenticated: bool
    user: SessionUserPayload | None
    gmailScopesGranted: bool


class SessionExchangeRequest(BaseModel):
    token: str
