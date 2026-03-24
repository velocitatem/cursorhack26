from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status

from config import Settings
from services.auth.google_client import GoogleOAuthClient
from services.auth.session_service import SessionService
from services.auth.user_repository import AuthRepository


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_auth_repository(request: Request) -> AuthRepository:
    return request.app.state.auth_repository


def get_google_client(request: Request) -> GoogleOAuthClient:
    return request.app.state.google_client


def get_session_service(
    settings: Settings = Depends(get_settings),
    repository: AuthRepository = Depends(get_auth_repository),
) -> SessionService:
    return SessionService(settings=settings, repository=repository)


def get_optional_user(
    request: Request,
    session_service: SessionService = Depends(get_session_service),
):
    return session_service.validate_session(request)


def get_current_user(optional_user=Depends(get_optional_user)):
    if optional_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    return optional_user
