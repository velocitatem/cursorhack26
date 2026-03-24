from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from alveslib import get_logger
from authlib.integrations.base_client.errors import OAuthError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse

from config import Settings
from models.auth import SessionResponse, SessionUserPayload
from services.auth.dependencies import (
    get_auth_repository,
    get_google_client,
    get_optional_user,
    get_session_service,
    get_settings,
)
from services.auth.google_client import GoogleOAuthClient, gmail_scopes_granted, normalize_scope
from services.auth.session_service import SessionService
from services.auth.types import SessionUser, StoredGoogleToken
from services.auth.user_repository import AuthRepository

router = APIRouter(prefix="/auth", tags=["auth"])
log = get_logger("backend-fastapi.auth")


def _redirect_with_error(settings: Settings, error_code: str) -> RedirectResponse:
    query = urlencode({"auth_error": error_code})
    return RedirectResponse(url=f"{settings.webapp_origin}/?{query}", status_code=status.HTTP_302_FOUND)


def _redirect_to_app(settings: Settings) -> RedirectResponse:
    return RedirectResponse(url=f"{settings.webapp_origin}/", status_code=status.HTTP_302_FOUND)


def _serialize_session(user: SessionUser | None) -> SessionResponse:
    if user is None:
        return SessionResponse(authenticated=False, user=None, gmailScopesGranted=False)

    return SessionResponse(
        authenticated=True,
        user=SessionUserPayload(
            id=user.user_id,
            email=user.email,
            name=user.name,
            avatarUrl=user.avatar_url,
        ),
        gmailScopesGranted=gmail_scopes_granted(user.google_scope),
    )


def _token_expiry(token: dict) -> datetime | None:
    expires_at = token.get("expires_at")
    if expires_at is not None:
        return datetime.fromtimestamp(int(expires_at), tz=timezone.utc)

    expires_in = token.get("expires_in")
    if expires_in is not None:
        return datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))

    return None


@router.get("/google/login")
async def google_login(
    request: Request,
    settings: Settings = Depends(get_settings),
    google_client: GoogleOAuthClient = Depends(get_google_client),
):
    try:
        redirect_uri = f"{settings.backend_public_url}/auth/google/callback"
        return await google_client.authorize_redirect(request, redirect_uri)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.get("/google/callback")
async def google_callback(
    request: Request,
    settings: Settings = Depends(get_settings),
    repository: AuthRepository = Depends(get_auth_repository),
    google_client: GoogleOAuthClient = Depends(get_google_client),
    session_service: SessionService = Depends(get_session_service),
):
    if request.query_params.get("error"):
        log.warning("google_oauth_error error=%s", request.query_params.get("error"))
        return _redirect_with_error(settings, "google_oauth_failed")

    try:
        token = await google_client.authorize_access_token(request)
        userinfo = await google_client.fetch_userinfo(token)
    except (OAuthError, RuntimeError):
        log.warning("google_oauth_callback_failed", exc_info=True)
        return _redirect_with_error(settings, "google_oauth_failed")

    google_sub = userinfo.get("sub")
    email = userinfo.get("email")
    if not google_sub or not email:
        log.warning("google_oauth_missing_identity_fields")
        return _redirect_with_error(settings, "google_oauth_failed")

    user = repository.upsert_user(
        google_sub=google_sub,
        email=email,
        name=userinfo.get("name"),
        avatar_url=userinfo.get("picture"),
    )
    repository.store_google_token(
        StoredGoogleToken(
            user_id=user.id,
            access_token=token["access_token"],
            refresh_token=token.get("refresh_token"),
            id_token=token.get("id_token"),
            scope=normalize_scope(token.get("scope")),
            token_type=token.get("token_type"),
            expires_at=_token_expiry(token),
        )
    )

    app_session_token = session_service.create_session(user.id)
    response = _redirect_to_app(settings)
    session_service.set_session_cookie(response, app_session_token)
    return response


@router.get("/session", response_model=SessionResponse)
async def get_session(
    request: Request,
    session_service: SessionService = Depends(get_session_service),
    session_user: SessionUser | None = Depends(get_optional_user),
):
    response = JSONResponse(_serialize_session(session_user).model_dump())
    if session_user is None and session_service.get_session_token(request):
        session_service.clear_session_cookie(response)
    return response


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    session_service: SessionService = Depends(get_session_service),
):
    session_service.revoke_session(request)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    session_service.clear_session_cookie(response)
    return response
