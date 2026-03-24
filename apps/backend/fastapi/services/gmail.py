from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.parser import BytesParser
from email.policy import default as email_policy
from html import unescape
import json
import re
from typing import Any, Literal
from urllib.parse import quote
from uuid import uuid4

from alveslib import get_logger
import httpx

from config import get_settings
from models.story import EmailDraft, EmailItem
from services.auth.types import StoredGoogleToken

log = get_logger("backend-fastapi.gmail")

GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
GMAIL_BATCH_URL = "https://gmail.googleapis.com/batch/gmail/v1"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
GMAIL_BATCH_MAX_SUBREQUESTS = 50
DEFAULT_HTTP_TIMEOUT = httpx.Timeout(30.0)


class GmailServiceError(RuntimeError):
    pass


class GmailTokenRefreshError(GmailServiceError):
    pass


class GmailRequestError(GmailServiceError):
    pass


class GmailMessageParseError(GmailServiceError):
    pass


@dataclass(slots=True)
class SendResult:
    email_id: str
    thread_id: str | None
    gmail_message_id: str | None
    status: Literal["sent", "failed"]
    error: str | None = None


def _normalize_scope(scope: Any) -> str:
    if isinstance(scope, str):
        return scope.strip()
    if isinstance(scope, (list, tuple, set)):
        return " ".join(str(value) for value in scope)
    return ""


def _normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.now().astimezone().tzinfo)
    return value.astimezone()


def _token_is_expired(token: StoredGoogleToken) -> bool:
    if token.expires_at is None:
        return False
    expires_at = _normalize_datetime(token.expires_at)
    now = datetime.now(expires_at.tzinfo)
    return expires_at <= now + timedelta(seconds=60)


def _require_scopes(token: StoredGoogleToken, required_scopes: set[str]) -> None:
    granted_scopes = set(_normalize_scope(token.scope).split())
    missing_scopes = sorted(required_scopes - granted_scopes)
    if missing_scopes:
        raise GmailServiceError(f"Missing required Gmail scopes: {', '.join(missing_scopes)}")


async def _refresh_access_token(
    token: StoredGoogleToken, client: httpx.AsyncClient
) -> StoredGoogleToken:
    if not token.refresh_token:
        raise GmailTokenRefreshError("Google token expired and cannot be refreshed.")

    settings = get_settings()
    if not settings.google_client_id or not settings.google_client_secret:
        raise GmailTokenRefreshError("Google OAuth is not configured.")

    log.info("gmail_token_refresh_start user_id=%s", token.user_id)
    try:
        response = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "refresh_token": token.refresh_token,
                "grant_type": "refresh_token",
            },
        )
    except httpx.HTTPError as exc:
        raise GmailRequestError(f"Gmail API request failed: {exc}") from exc

    if response.status_code >= 400:
        log.warning(
            "gmail_token_refresh_failed user_id=%s status=%s body_preview=%s",
            token.user_id,
            response.status_code,
            response.text[:300],
        )
        raise GmailTokenRefreshError("Failed to refresh Google access token.")

    payload = response.json()
    access_token = payload.get("access_token")
    if not access_token:
        log.warning("gmail_token_refresh_missing_access_token user_id=%s", token.user_id)
        raise GmailTokenRefreshError("Failed to refresh Google access token.")

    expires_in = payload.get("expires_in")
    expires_at = None
    if expires_in is not None:
        expires_at = datetime.now().astimezone() + timedelta(seconds=int(expires_in))

    refreshed = StoredGoogleToken(
        user_id=token.user_id,
        access_token=access_token,
        refresh_token=payload.get("refresh_token") or token.refresh_token,
        id_token=payload.get("id_token") or token.id_token,
        scope=_normalize_scope(payload.get("scope") or token.scope),
        token_type=payload.get("token_type") or token.token_type,
        expires_at=expires_at,
    )
    log.info("gmail_token_refresh_ok user_id=%s", token.user_id)
    return refreshed


async def _ensure_fresh_token(
    token: StoredGoogleToken, client: httpx.AsyncClient
) -> StoredGoogleToken:
    if _token_is_expired(token):
        return await _refresh_access_token(token, client)
    return token


def _authorized_headers(token: StoredGoogleToken) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token.access_token}",
        "Accept": "application/json",
    }


def _batch_content_id_for_message(message_id: str) -> str:
    return f"<message-{message_id}>"


def _extract_message_id_from_content_id(content_id: str | None) -> str | None:
    if not content_id:
        return None
    normalized = content_id.strip().strip("<>")
    if normalized.startswith("response-"):
        normalized = normalized[len("response-") :]
    prefix = "message-"
    if not normalized.startswith(prefix):
        return None
    return normalized[len(prefix) :]


def _build_gmail_batch_request_parts(message_ids: list[str]) -> tuple[bytes, str, dict[str, str]]:
    boundary = f"gmail_batch_{uuid4().hex}"
    body = bytearray()
    for message_id in message_ids:
        encoded_message_id = quote(message_id, safe="")
        body.extend(f"--{boundary}\r\n".encode("ascii"))
        body.extend(b"Content-Type: application/http\r\n")
        body.extend(f"Content-ID: {_batch_content_id_for_message(message_id)}\r\n\r\n".encode("ascii"))
        body.extend(
            (
                f"GET /gmail/v1/users/me/messages/{encoded_message_id}?format=full HTTP/1.1\r\n"
                "Accept: application/json\r\n\r\n"
            ).encode("ascii")
        )
    body.extend(f"--{boundary}--\r\n".encode("ascii"))
    headers = {
        "Content-Type": f'multipart/mixed; boundary="{boundary}"',
    }
    return bytes(body), boundary, headers


def _parse_gmail_batch_response(
    response: httpx.Response, requested_ids: list[str]
) -> list[dict[str, Any] | GmailRequestError]:
    content_type = response.headers.get("Content-Type", "")
    if "multipart/mixed" not in content_type.lower():
        raise GmailRequestError("Gmail batch response was not multipart.")

    raw_message = (
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8")
        + response.content
    )
    try:
        parsed = BytesParser(policy=email_policy).parsebytes(raw_message)
    except Exception as exc:
        raise GmailRequestError("Failed to parse Gmail batch response.") from exc

    if not parsed.is_multipart():
        raise GmailRequestError("Gmail batch response was not multipart.")

    results_by_message_id: dict[str, dict[str, Any] | GmailRequestError] = {
        message_id: GmailRequestError("Missing Gmail batch subresponse.")
        for message_id in requested_ids
    }
    fallback_ids = iter(requested_ids)

    for part in parsed.iter_parts():
        raw_part = part.get_payload(decode=True)
        if raw_part is None:
            continue

        header_block, separator, body = raw_part.partition(b"\r\n\r\n")
        if not separator:
            header_block, separator, body = raw_part.partition(b"\n\n")
        if not separator:
            message_id = _extract_message_id_from_content_id(part.get("Content-ID"))
            if message_id is None:
                message_id = next(fallback_ids, None)
            if message_id is None:
                continue
            results_by_message_id[message_id] = GmailRequestError("Malformed Gmail batch subresponse.")
            continue

        header_lines = [line.strip() for line in header_block.splitlines() if line.strip()]
        if not header_lines:
            message_id = _extract_message_id_from_content_id(part.get("Content-ID"))
            if message_id is None:
                message_id = next(fallback_ids, None)
            if message_id is None:
                continue
            results_by_message_id[message_id] = GmailRequestError("Missing Gmail batch subresponse status.")
            continue

        status_line = header_lines[0].decode("utf-8", errors="replace")
        match = re.match(r"HTTP/\d+(?:\.\d+)?\s+(\d{3})", status_line)
        if not match:
            message_id = _extract_message_id_from_content_id(part.get("Content-ID"))
            if message_id is None:
                message_id = next(fallback_ids, None)
            if message_id is None:
                continue
            results_by_message_id[message_id] = GmailRequestError("Malformed Gmail batch subresponse status.")
            continue

        message_id = _extract_message_id_from_content_id(part.get("Content-ID"))
        if message_id is None:
            message_id = next(fallback_ids, None)
        if message_id is None:
            continue

        status_code = int(match.group(1))
        if status_code >= 400:
            results_by_message_id[message_id] = GmailRequestError(
                f"Gmail batch subrequest failed ({status_code})."
            )
            continue

        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            results_by_message_id[message_id] = GmailRequestError(
                "Malformed Gmail batch subresponse body."
            )
            results_by_message_id[message_id].__cause__ = exc
            continue

        results_by_message_id[message_id] = payload

    return [results_by_message_id[message_id] for message_id in requested_ids]


async def _fetch_messages_batch(
    client: httpx.AsyncClient,
    token: StoredGoogleToken,
    message_ids: list[str],
) -> list[dict[str, Any]]:
    if not message_ids:
        return []

    log.info("gmail_batch_fetch_start batch_size=%s", len(message_ids))
    body, _, batch_headers = _build_gmail_batch_request_parts(message_ids)
    headers = {
        "Authorization": f"Bearer {token.access_token}",
        "Accept": "multipart/mixed",
        **batch_headers,
    }
    try:
        response = await client.post(GMAIL_BATCH_URL, headers=headers, content=body)
    except httpx.HTTPError as exc:
        raise GmailRequestError(f"Gmail API request failed: {exc}") from exc

    if response.status_code >= 400:
        log.warning(
            "gmail_request_failed method=%s path=%s status=%s body_preview=%s",
            "POST",
            GMAIL_BATCH_URL,
            response.status_code,
            response.text[:300],
        )
        raise GmailRequestError(f"Gmail API request failed ({response.status_code}).")

    parsed_results = _parse_gmail_batch_response(response, message_ids)
    messages: list[dict[str, Any]] = []
    failure_count = 0

    for message_id, parsed in zip(message_ids, parsed_results, strict=False):
        if isinstance(parsed, GmailRequestError):
            failure_count += 1
            if "subrequest failed" in str(parsed):
                match = re.search(r"\((\d{3})\)", str(parsed))
                log.warning(
                    "gmail_batch_subrequest_failed message_id=%s status=%s",
                    message_id,
                    match.group(1) if match else "unknown",
                )
            else:
                log.warning("gmail_batch_parse_failed message_id=%s", message_id, exc_info=parsed)
            continue
        messages.append(parsed)

    log.info(
        "gmail_batch_fetch_ok batch_size=%s success_count=%s failure_count=%s",
        len(message_ids),
        len(messages),
        failure_count,
    )
    return messages


async def _gmail_request(
    method: str,
    path: str,
    token: StoredGoogleToken,
    client: httpx.AsyncClient,
    *,
    params: Any = None,
    json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    url = f"{GMAIL_API_BASE}/{path.lstrip('/')}"
    headers = _authorized_headers(token)
    try:
        if method == "GET":
            response = await client.get(url, headers=headers, params=params)
        elif method == "POST":
            response = await client.post(url, headers=headers, params=params, json=json)
        else:
            raise GmailRequestError(f"Unsupported Gmail request method: {method}")
    except httpx.HTTPError as exc:
        raise GmailRequestError(f"Gmail API request failed: {exc}") from exc

    if response.status_code >= 400:
        log.warning(
            "gmail_request_failed method=%s path=%s status=%s body_preview=%s",
            method,
            path,
            response.status_code,
            response.text[:300],
        )
        raise GmailRequestError(f"Gmail API request failed ({response.status_code}).")

    if not response.content:
        return {}
    return response.json()


def _email_item_from_message(full_message: dict[str, Any], fallback_message_id: str) -> tuple[int, EmailItem]:
    payload = full_message.get("payload") or {}
    headers = payload.get("headers") or []
    return (
        int(full_message.get("internalDate") or 0),
        EmailItem(
            id=full_message.get("id") or fallback_message_id,
            sender=_extract_header(headers, "From") or "",
            subject=_extract_header(headers, "Subject") or "",
            snippet=full_message.get("snippet") or "",
            body=_extract_text_body(payload),
            thread_id=full_message.get("threadId"),
        ),
    )


def _extract_header(headers: list[dict[str, str]] | None, name: str) -> str | None:
    for header in headers or []:
        if header.get("name", "").lower() == name.lower():
            return header.get("value")
    return None


def _decode_base64url(data: str | None) -> bytes:
    if not data:
        return b""
    padding = "=" * (-len(data) % 4)
    try:
        return base64.b64decode((data + padding).encode("ascii"), altchars=b"-_", validate=True)
    except (ValueError, TypeError, binascii.Error) as exc:
        raise GmailMessageParseError("Malformed Gmail message body encoding.") from exc


def _html_to_text(html: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p\s*>", "\n", text)
    text = re.sub(r"(?i)</div\s*>", "\n", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_text_body(payload: dict[str, Any]) -> str:
    def walk(part: dict[str, Any]) -> tuple[str | None, str | None]:
        if not isinstance(part, dict):
            raise GmailMessageParseError("Malformed Gmail message payload.")
        mime_type = (part.get("mimeType") or "").lower()
        body = part.get("body") or {}
        data = body.get("data")
        html_candidate: str | None = None

        if mime_type == "text/plain" and data:
            text = _decode_base64url(data).decode("utf-8", errors="replace").strip()
            return text or None, None

        if mime_type == "text/html" and data:
            html_text = _html_to_text(_decode_base64url(data).decode("utf-8", errors="replace"))
            html_candidate = html_text or None

        for child in part.get("parts") or []:
            plain_text, child_html = walk(child)
            if plain_text:
                return plain_text, html_candidate or child_html
            if child_html and not html_candidate:
                html_candidate = child_html

        if mime_type.startswith("text/") and mime_type != "text/html" and data:
            text = _decode_base64url(data).decode("utf-8", errors="replace").strip()
            return text or None, html_candidate

        return None, html_candidate

    plain_text, html_text = walk(payload)
    return plain_text or html_text or ""


def _build_today_query(now: datetime) -> str:
    local_now = _normalize_datetime(now)
    start_of_day = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return f"after:{int(start_of_day.timestamp())} before:{int(local_now.timestamp())}"


def _build_reply_raw_message(
    original_headers: dict[str, str | None], draft: EmailDraft
) -> bytes:
    reply_to = (draft.to or "").strip() or original_headers.get("reply_to") or original_headers.get("from")
    if not reply_to:
        raise RuntimeError("Original message is missing recipient headers for reply.")

    original_subject = (original_headers.get("subject") or "").strip()
    subject = (draft.subject or "").strip() or (f"Re: {original_subject}" if original_subject else "Re:")

    message = EmailMessage()
    message["To"] = reply_to
    message["Subject"] = subject

    message_id = (original_headers.get("message_id") or "").strip()
    references = (original_headers.get("references") or "").strip()
    if message_id:
        message["In-Reply-To"] = message_id
        reference_parts = [part for part in [references, message_id] if part]
        if reference_parts:
            message["References"] = " ".join(reference_parts)

    message.set_content(draft.body or "")
    return message.as_bytes()


async def _list_todays_emails_impl(
    client: httpx.AsyncClient,
    user_token: StoredGoogleToken,
    *,
    max_emails: int,
) -> tuple[list[EmailItem], StoredGoogleToken]:
    _require_scopes(user_token, {GMAIL_READONLY_SCOPE})
    token = await _ensure_fresh_token(user_token, client)

    page_token: str | None = None
    items_with_dates: list[tuple[int, EmailItem]] = []

    while True:
        params: dict[str, Any] = {
            "labelIds": "INBOX",
            "includeSpamTrash": "false",
            "maxResults": min(max_emails - len(items_with_dates), 100),
            "q": _build_today_query(datetime.now().astimezone()),
        }
        if page_token:
            params["pageToken"] = page_token

        page = await _gmail_request("GET", "messages", token, client, params=params)
        messages = page.get("messages") or []
        log.info("gmail_list_page count=%s total_so_far=%s", len(messages), len(items_with_dates))

        page_message_ids: list[str] = []
        for message_ref in messages:
            if len(page_message_ids) + len(items_with_dates) >= max_emails:
                break
            message_id = message_ref.get("id")
            if message_id:
                page_message_ids.append(message_id)

        for start in range(0, len(page_message_ids), GMAIL_BATCH_MAX_SUBREQUESTS):
            batch_message_ids = page_message_ids[start : start + GMAIL_BATCH_MAX_SUBREQUESTS]
            full_messages = await _fetch_messages_batch(client, token, batch_message_ids)
            for full_message in full_messages:
                message_id = full_message.get("id") or ""
                try:
                    items_with_dates.append(_email_item_from_message(full_message, message_id))
                except GmailServiceError:
                    log.warning("gmail_message_parse_failed message_id=%s", message_id, exc_info=True)
                if len(items_with_dates) >= max_emails:
                    break
            if len(items_with_dates) >= max_emails:
                break

        page_token = page.get("nextPageToken")
        if not page_token or len(items_with_dates) >= max_emails:
            break

    items_with_dates.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in items_with_dates], token


async def list_todays_emails(
    user_token: StoredGoogleToken,
    *,
    max_emails: int = 50,
    http_client: httpx.AsyncClient | None = None,
) -> tuple[list[EmailItem], StoredGoogleToken]:
    if http_client is not None:
        return await _list_todays_emails_impl(http_client, user_token, max_emails=max_emails)

    async with httpx.AsyncClient(timeout=DEFAULT_HTTP_TIMEOUT) as client:
        return await _list_todays_emails_impl(client, user_token, max_emails=max_emails)


async def _send_draft_replies_impl(
    client: httpx.AsyncClient,
    user_token: StoredGoogleToken,
    drafts: list[EmailDraft],
) -> tuple[list[SendResult], StoredGoogleToken]:
    _require_scopes(user_token, {GMAIL_SEND_SCOPE})
    token = await _ensure_fresh_token(user_token, client)
    results: list[SendResult] = []

    for draft in drafts:
        thread_id: str | None = None
        try:
            original_message = await _gmail_request(
                "GET",
                f"messages/{draft.email_id}",
                token,
                client,
                params=[
                    ("format", "metadata"),
                    ("metadataHeaders", "Message-ID"),
                    ("metadataHeaders", "References"),
                    ("metadataHeaders", "Subject"),
                    ("metadataHeaders", "From"),
                    ("metadataHeaders", "Reply-To"),
                ],
            )
            thread_id = original_message.get("threadId")
            if not thread_id:
                raise RuntimeError("Original Gmail message is missing threadId.")

            headers = (original_message.get("payload") or {}).get("headers") or []
            raw_message = _build_reply_raw_message(
                {
                    "message_id": _extract_header(headers, "Message-ID"),
                    "references": _extract_header(headers, "References"),
                    "subject": _extract_header(headers, "Subject"),
                    "from": _extract_header(headers, "From"),
                    "reply_to": _extract_header(headers, "Reply-To"),
                },
                draft,
            )
            encoded_message = base64.urlsafe_b64encode(raw_message).decode("ascii").rstrip("=")
            sent_message = await _gmail_request(
                "POST",
                "messages/send",
                token,
                client,
                json={"threadId": thread_id, "raw": encoded_message},
            )
            result = SendResult(
                email_id=draft.email_id,
                thread_id=sent_message.get("threadId") or thread_id,
                gmail_message_id=sent_message.get("id"),
                status="sent",
            )
            log.info(
                "gmail_send_reply_ok email_id=%s thread_id=%s gmail_message_id=%s",
                draft.email_id,
                result.thread_id,
                result.gmail_message_id,
            )
            results.append(result)
        except GmailServiceError as exc:
            log.warning(
                "gmail_send_reply_failed email_id=%s thread_id=%s",
                draft.email_id,
                thread_id,
                exc_info=True,
            )
            results.append(
                SendResult(
                    email_id=draft.email_id,
                    thread_id=thread_id,
                    gmail_message_id=None,
                    status="failed",
                    error=str(exc),
                )
            )

    return results, token


async def send_draft_replies(
    user_token: StoredGoogleToken,
    drafts: list[EmailDraft],
    *,
    http_client: httpx.AsyncClient | None = None,
) -> tuple[list[SendResult], StoredGoogleToken]:
    if http_client is not None:
        return await _send_draft_replies_impl(http_client, user_token, drafts)

    async with httpx.AsyncClient(timeout=DEFAULT_HTTP_TIMEOUT) as client:
        return await _send_draft_replies_impl(client, user_token, drafts)
