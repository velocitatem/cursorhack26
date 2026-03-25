from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets
from urllib.parse import urlencode, urlsplit, urlunsplit

from alveslib import get_logger
from authlib.integrations.base_client.errors import OAuthError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse

from config import Settings
from models.auth import SessionExchangeRequest, SessionResponse, SessionUserPayload
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
from services.cache import delete_keys, get_json, set_json

router = APIRouter(prefix="/auth", tags=["auth"])
log = get_logger("backend-fastapi.auth")
POST_AUTH_REDIRECT_SESSION_KEY = "post_auth_redirect"
EXCHANGE_TOKEN_QUERY_PARAM = "exchange_token"
EXCHANGE_TOKEN_TTL_SECONDS = 30


def _normalize_absolute_url(value: str | None) -> str | None:
    if not value:
        return None

    try:
        parts = urlsplit(value)
    except ValueError:
        return None

    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return None

    path = parts.path or "/"
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


def _url_origin(value: str | None) -> str | None:
    normalized = _normalize_absolute_url(value)
    if normalized is None:
        return None

    parts = urlsplit(normalized)
    return f"{parts.scheme}://{parts.netloc}"


def _post_auth_redirect_fallback(settings: Settings) -> str:
    return f"{settings.webapp_origin}/"


def _resolve_post_auth_redirect(request: Request, settings: Settings) -> str:
    requested_redirect = _normalize_absolute_url(request.query_params.get("return_to"))
    if requested_redirect is None:
        return _post_auth_redirect_fallback(settings)

    trusted_origins = {settings.webapp_origin}
    for header_name in ("origin", "referer"):
        header_origin = _url_origin(request.headers.get(header_name))
        if header_origin is not None:
            trusted_origins.add(header_origin)

    if _url_origin(requested_redirect) not in trusted_origins:
        return _post_auth_redirect_fallback(settings)

    return requested_redirect


def _pop_post_auth_redirect(request: Request, settings: Settings) -> str:
    redirect_url = _normalize_absolute_url(request.session.pop(POST_AUTH_REDIRECT_SESSION_KEY, None))
    if redirect_url is None:
        return _post_auth_redirect_fallback(settings)
    return redirect_url


def _redirect_with_error(request: Request, settings: Settings, error_code: str) -> RedirectResponse:
    query = urlencode({"auth_error": error_code})
    redirect_url = _pop_post_auth_redirect(request, settings)
    separator = "&" if urlsplit(redirect_url).query else "?"
    return RedirectResponse(url=f"{redirect_url}{separator}{query}", status_code=status.HTTP_302_FOUND)


def _redirect_to_app(request: Request, settings: Settings) -> RedirectResponse:
    return RedirectResponse(url=_pop_post_auth_redirect(request, settings), status_code=status.HTTP_302_FOUND)


def _append_query_param(url: str, key: str, value: str) -> str:
    separator = "&" if urlsplit(url).query else "?"
    return f"{url}{separator}{urlencode({key: value})}"


def _exchange_cache_key(token: str) -> str:
    return f"auth:exchange:{token}"


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
        request.session[POST_AUTH_REDIRECT_SESSION_KEY] = _resolve_post_auth_redirect(request, settings)
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
        return _redirect_with_error(request, settings, "google_oauth_failed")

    try:
        token = await google_client.authorize_access_token(request)
        userinfo = await google_client.fetch_userinfo(token)
    except (OAuthError, RuntimeError):
        log.warning("google_oauth_callback_failed", exc_info=True)
        return _redirect_with_error(request, settings, "google_oauth_failed")

    google_sub = userinfo.get("sub")
    email = userinfo.get("email")
    if not google_sub or not email:
        log.warning("google_oauth_missing_identity_fields")
        return _redirect_with_error(request, settings, "google_oauth_failed")

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
    exchange_token = secrets.token_urlsafe(32)
    scope = normalize_scope(token.get("scope"))
    set_json(
        key=_exchange_cache_key(exchange_token),
        value={
            "session_token": app_session_token,
            "user": {
                "id": user.id,
                "email": user.email,
                "name": user.name,
                "avatarUrl": user.avatar_url,
            },
            "gmailScopesGranted": gmail_scopes_granted(scope),
        },
        ttl_seconds=EXCHANGE_TOKEN_TTL_SECONDS,
    )
    redirect_url = _append_query_param(
        _pop_post_auth_redirect(request, settings),
        EXCHANGE_TOKEN_QUERY_PARAM,
        exchange_token,
    )
    return RedirectResponse(url=redirect_url, status_code=status.HTTP_302_FOUND)


@router.post("/exchange", response_model=SessionResponse)
async def exchange_session(
    body: SessionExchangeRequest,
    session_service: SessionService = Depends(get_session_service),
):
    token = body.token.strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing exchange token.")
    cache_key = _exchange_cache_key(token)
    payload = get_json(cache_key)
    delete_keys(cache_key)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired exchange token.")
    session_token = payload.get("session_token")
    user_payload = payload.get("user")
    gmail_scopes_granted = payload.get("gmailScopesGranted")
    if not isinstance(session_token, str) or not isinstance(user_payload, dict) or not session_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid exchange token payload.")
    try:
        response_payload = SessionResponse(
            authenticated=True,
            user=SessionUserPayload(**user_payload),
            gmailScopesGranted=bool(gmail_scopes_granted),
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid exchange token payload.") from exc
    response = JSONResponse(response_payload.model_dump())
    session_service.set_session_cookie(response, session_token)
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
