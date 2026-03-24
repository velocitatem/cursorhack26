from __future__ import annotations

import argparse
import asyncio
import base64
from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path
import sys
from typing import Any

import httpx

repo_root = Path(__file__).resolve().parents[1]
backend_dir = repo_root / "apps" / "backend" / "fastapi"
sys.path.insert(0, str(backend_dir))
sys.path.insert(0, str(repo_root))

from config import get_settings  # noqa: E402
from services.auth.db import create_connection  # noqa: E402
from services.auth.types import StoredGoogleToken  # noqa: E402
from services.gmail import (  # noqa: E402
    DEFAULT_HTTP_TIMEOUT,
    GMAIL_READONLY_SCOPE,
    GMAIL_SEND_SCOPE,
    _ensure_fresh_token,
    _gmail_request,
    list_todays_emails,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Smoke test the real Gmail integration by reading today's inbox and sending a test email."
    )
    parser.add_argument(
        "--user-email",
        default=None,
        help="Authenticated Gmail account email to test with. Required when multiple stored users exist.",
    )
    parser.add_argument(
        "--to",
        required=True,
        help="Recipient for the outbound smoke-test email.",
    )
    parser.add_argument(
        "--max-emails",
        type=int,
        default=5,
        help="Maximum number of today's emails to fetch for the read check.",
    )
    return parser.parse_args()


def _load_user_and_token(user_email: str | None) -> tuple[str, str, StoredGoogleToken]:
    settings = get_settings()
    query = """
        SELECT
            u.id AS user_id,
            u.email,
            t.access_token,
            t.refresh_token,
            t.id_token,
            t.scope,
            t.token_type,
            t.expires_at
        FROM users u
        JOIN google_oauth_tokens t ON t.user_id = u.id
    """
    params: tuple[Any, ...] = ()
    if user_email:
        query += " WHERE u.email = %s"
        params = (user_email,)
    query += " ORDER BY u.created_at ASC"

    with create_connection(settings) as conn:
        with conn.cursor() as cursor:
            cursor.execute(query, params)
            rows = cursor.fetchall()

    if not rows:
        target = user_email or "any user"
        raise RuntimeError(f"No stored Google OAuth token found for {target}.")
    if user_email is None and len(rows) > 1:
        emails = ", ".join(str(row["email"]) for row in rows)
        raise RuntimeError(
            f"Multiple Gmail users found ({emails}). Re-run with --user-email to pick one."
        )

    row = rows[0]
    token = StoredGoogleToken(
        user_id=str(row["user_id"]),
        access_token=row["access_token"],
        refresh_token=row["refresh_token"],
        id_token=row["id_token"],
        scope=row["scope"],
        token_type=row["token_type"],
        expires_at=row["expires_at"],
    )
    return str(row["user_id"]), str(row["email"]), token


def _encode_raw_message(message: EmailMessage) -> str:
    raw_bytes = message.as_bytes()
    return base64.urlsafe_b64encode(raw_bytes).decode("ascii").rstrip("=")


def _build_test_email(sender_email: str, recipient_email: str, inbox_count: int) -> EmailMessage:
    now = datetime.now(UTC).isoformat()
    message = EmailMessage()
    message["To"] = recipient_email
    message["Subject"] = f"UltiPlate Gmail smoke test {now}"
    message.set_content(
        "\n".join(
            [
                "This is an automated Gmail smoke test from the UltiPlate backend.",
                f"Authenticated account: {sender_email}",
                f"Read check fetched {inbox_count} email(s) from today's inbox.",
                f"Sent at: {now}",
            ]
        )
    )
    return message


async def _run_smoke_test(user_email: str | None, recipient_email: str, max_emails: int) -> int:
    _, resolved_email, token = _load_user_and_token(user_email)

    print(f"Using Gmail account: {resolved_email}")
    async with httpx.AsyncClient(timeout=DEFAULT_HTTP_TIMEOUT) as client:
        inbox_items, token = await list_todays_emails(token, max_emails=max_emails, http_client=client)
        print(f"Read check succeeded: fetched {len(inbox_items)} email(s) from today's inbox.")
        for index, item in enumerate(inbox_items, start=1):
            print(f"{index}. [{item.id}] from={item.sender} subject={item.subject}")

        token = await _ensure_fresh_token(token, client)
        granted_scopes = set((token.scope or "").split())
        missing_scopes = {GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE} - granted_scopes
        if missing_scopes:
            raise RuntimeError(
                f"Stored token is missing required Gmail scopes: {', '.join(sorted(missing_scopes))}"
            )

        test_email = _build_test_email(resolved_email, recipient_email, len(inbox_items))
        sent_message = await _gmail_request(
            "POST",
            "messages/send",
            token,
            client,
            json={"raw": _encode_raw_message(test_email)},
        )
        print(
            "Write check succeeded: "
            f"sent message to {recipient_email} "
            f"(gmail_message_id={sent_message.get('id')}, thread_id={sent_message.get('threadId')})."
        )
    return 0


def main() -> int:
    args = _parse_args()
    return asyncio.run(_run_smoke_test(args.user_email, args.to, args.max_emails))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nCancelled by user.", file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
