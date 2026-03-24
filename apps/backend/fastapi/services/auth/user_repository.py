from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from config import Settings
from services.auth.db import bootstrap_auth_schema, create_connection
from services.auth.types import AuthUser, SessionUser, StoredGoogleToken


class AuthRepository:
    def __init__(self, settings: Settings):
        self.settings = settings

    def bootstrap_schema(self) -> None:
        bootstrap_auth_schema(self.settings)

    def upsert_user(
        self,
        *,
        google_sub: str,
        email: str,
        name: str | None,
        avatar_url: str | None,
    ) -> AuthUser:
        now = datetime.now(timezone.utc)
        with create_connection(self.settings) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO users (
                        id,
                        google_sub,
                        email,
                        name,
                        avatar_url,
                        created_at,
                        updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (google_sub) DO UPDATE SET
                        email = EXCLUDED.email,
                        name = EXCLUDED.name,
                        avatar_url = EXCLUDED.avatar_url,
                        updated_at = EXCLUDED.updated_at
                    RETURNING id, google_sub, email, name, avatar_url
                    """,
                    (str(uuid4()), google_sub, email, name, avatar_url, now, now),
                )
                row = cursor.fetchone()
            conn.commit()

        return AuthUser(
            id=str(row["id"]),
            google_sub=row["google_sub"],
            email=row["email"],
            name=row["name"],
            avatar_url=row["avatar_url"],
        )

    def store_google_token(self, token: StoredGoogleToken) -> StoredGoogleToken:
        now = datetime.now(timezone.utc)
        with create_connection(self.settings) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO google_oauth_tokens (
                        user_id,
                        access_token,
                        refresh_token,
                        id_token,
                        scope,
                        token_type,
                        expires_at,
                        created_at,
                        updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET
                        access_token = EXCLUDED.access_token,
                        refresh_token = COALESCE(EXCLUDED.refresh_token, google_oauth_tokens.refresh_token),
                        id_token = EXCLUDED.id_token,
                        scope = EXCLUDED.scope,
                        token_type = EXCLUDED.token_type,
                        expires_at = EXCLUDED.expires_at,
                        updated_at = EXCLUDED.updated_at
                    RETURNING
                        user_id,
                        access_token,
                        refresh_token,
                        id_token,
                        scope,
                        token_type,
                        expires_at
                    """,
                    (
                        token.user_id,
                        token.access_token,
                        token.refresh_token,
                        token.id_token,
                        token.scope,
                        token.token_type,
                        token.expires_at,
                        now,
                        now,
                    ),
                )
                row = cursor.fetchone()
            conn.commit()

        return StoredGoogleToken(
            user_id=str(row["user_id"]),
            access_token=row["access_token"],
            refresh_token=row["refresh_token"],
            id_token=row["id_token"],
            scope=row["scope"],
            token_type=row["token_type"],
            expires_at=row["expires_at"],
        )

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
        with create_connection(self.settings) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO auth_sessions (
                        id,
                        user_id,
                        session_token_hash,
                        expires_at,
                        created_at,
                        last_seen_at
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (session_id, user_id, session_token_hash, expires_at, created_at, last_seen_at),
                )
            conn.commit()
        return session_id

    def fetch_session_user(self, session_token_hash: str) -> SessionUser | None:
        with create_connection(self.settings) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        s.id AS session_id,
                        s.user_id,
                        s.expires_at,
                        s.last_seen_at,
                        u.email,
                        u.name,
                        u.avatar_url,
                        t.scope AS google_scope
                    FROM auth_sessions s
                    JOIN users u ON u.id = s.user_id
                    LEFT JOIN google_oauth_tokens t ON t.user_id = u.id
                    WHERE s.session_token_hash = %s
                    """,
                    (session_token_hash,),
                )
                row = cursor.fetchone()

        if row is None:
            return None

        return SessionUser(
            session_id=str(row["session_id"]),
            user_id=str(row["user_id"]),
            email=row["email"],
            name=row["name"],
            avatar_url=row["avatar_url"],
            expires_at=row["expires_at"],
            last_seen_at=row["last_seen_at"],
            google_scope=row["google_scope"],
        )

    def touch_session(self, session_id: str, last_seen_at: datetime) -> None:
        with create_connection(self.settings) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "UPDATE auth_sessions SET last_seen_at = %s WHERE id = %s",
                    (last_seen_at, session_id),
                )
            conn.commit()

    def delete_session_by_hash(self, session_token_hash: str) -> bool:
        with create_connection(self.settings) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "DELETE FROM auth_sessions WHERE session_token_hash = %s",
                    (session_token_hash,),
                )
                deleted = cursor.rowcount > 0
            conn.commit()
        return deleted

    def get_google_credentials_for_user(self, user_id: str) -> StoredGoogleToken | None:
        with create_connection(self.settings) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        user_id,
                        access_token,
                        refresh_token,
                        id_token,
                        scope,
                        token_type,
                        expires_at
                    FROM google_oauth_tokens
                    WHERE user_id = %s
                    """,
                    (user_id,),
                )
                row = cursor.fetchone()

        if row is None:
            return None

        return StoredGoogleToken(
            user_id=str(row["user_id"]),
            access_token=row["access_token"],
            refresh_token=row["refresh_token"],
            id_token=row["id_token"],
            scope=row["scope"],
            token_type=row["token_type"],
            expires_at=row["expires_at"],
        )
