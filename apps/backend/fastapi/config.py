from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from urllib.parse import quote_plus


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    return int(value)


def _env_same_site(name: str, default: str) -> str:
    value = os.getenv(name, default).strip().lower()
    if value not in {"lax", "strict", "none"}:
        raise ValueError(f"{name} must be one of: lax, strict, none")
    return value


def _default_app_session_key() -> str:
    project_name = os.getenv("COMPOSE_PROJECT_NAME") or os.getenv("NAME") or "athens"
    return f"{project_name}-dev-session"


def _build_database_url() -> str:
    user = quote_plus(os.getenv("POSTGRES_USER", "postgres"))
    password = os.getenv("POSTGRES_PASSWORD")
    auth = user if not password else f"{user}:{quote_plus(password)}"
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    database = quote_plus(os.getenv("POSTGRES_DB", "app"))
    return f"postgresql://{auth}@{host}:{port}/{database}"


@dataclass(frozen=True)
class Settings:
    google_client_id: str
    google_client_secret: str
    backend_public_url: str
    webapp_origin: str
    session_cookie_name: str
    session_ttl_seconds: int
    session_cookie_secure: bool
    session_cookie_same_site: str
    app_secret_key: str
    database_url: str

    @classmethod
    def from_env(cls) -> "Settings":
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            database_url = _build_database_url()

        session_cookie_secure = _env_bool("SESSION_COOKIE_SECURE", False)
        session_cookie_same_site = _env_same_site("SESSION_COOKIE_SAME_SITE", "lax")
        if session_cookie_same_site == "none" and not session_cookie_secure:
            raise ValueError("SESSION_COOKIE_SECURE must be true when SESSION_COOKIE_SAME_SITE=none")

        return cls(
            google_client_id=os.getenv("GOOGLE_CLIENT_ID", ""),
            google_client_secret=os.getenv("GOOGLE_CLIENT_SECRET", ""),
            backend_public_url=os.getenv("BACKEND_PUBLIC_URL", "http://localhost:9812").rstrip("/"),
            webapp_origin=os.getenv("WEBAPP_ORIGIN", "http://localhost:5173").rstrip("/"),
            session_cookie_name=os.getenv("SESSION_COOKIE_NAME", "athens_session"),
            session_ttl_seconds=_env_int("SESSION_TTL_SECONDS", 604800),
            session_cookie_secure=session_cookie_secure,
            session_cookie_same_site=session_cookie_same_site,
            app_secret_key=os.getenv("APP_SECRET_KEY") or _default_app_session_key(),
            database_url=database_url,
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_env()
