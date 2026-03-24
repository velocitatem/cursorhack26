from __future__ import annotations

import asyncio
import base64
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sys
from typing import Any
from urllib.parse import unquote

import httpx
import pytest

base_dir = Path(__file__).resolve().parents[1]
repo_root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(base_dir))
sys.path.insert(0, str(repo_root))

from config import Settings  # noqa: E402
from services.auth.types import StoredGoogleToken  # noqa: E402
from services.gmail import (  # noqa: E402
    GMAIL_BATCH_MAX_SUBREQUESTS,
    GMAIL_READONLY_SCOPE,
    GmailRequestError,
    GOOGLE_TOKEN_URL,
    list_todays_emails,
)


def make_settings() -> Settings:
    return Settings(
        google_client_id="client-id",
        google_client_secret="client-secret",
        backend_public_url="http://localhost:9812",
        webapp_origin="http://localhost:5173",
        session_cookie_name="athens_session",
        session_ttl_seconds=604800,
        session_cookie_secure=False,
        session_cookie_same_site="lax",
        app_secret_key="test-secret",
        database_url="postgresql://unused",
    )


def make_token(*, expired: bool = False, access_token: str = "access-token") -> StoredGoogleToken:
    now = datetime.now(timezone.utc)
    return StoredGoogleToken(
        user_id="user-1",
        access_token=access_token,
        refresh_token="refresh-token",
        id_token="id-token",
        scope=GMAIL_READONLY_SCOPE,
        token_type="Bearer",
        expires_at=now - timedelta(minutes=5) if expired else now + timedelta(hours=1),
    )


def encode_body(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii").rstrip("=")


def make_message(
    message_id: str,
    *,
    internal_date: int,
    sender: str | None = None,
    subject: str | None = None,
    body: str = "Plain text body",
    snippet: str | None = None,
) -> dict[str, Any]:
    return {
        "id": message_id,
        "threadId": f"thread-{message_id}",
        "internalDate": str(internal_date),
        "snippet": snippet or f"snippet-{message_id}",
        "payload": {
            "mimeType": "multipart/alternative",
            "headers": [
                {"name": "From", "value": sender or f"{message_id}@example.com"},
                {"name": "Subject", "value": subject or f"Subject {message_id}"},
            ],
            "parts": [
                {
                    "mimeType": "text/plain",
                    "body": {"data": encode_body(body)},
                }
            ],
        },
    }


def make_batch_http_response(
    responses_by_message_id: dict[str, tuple[int, Any]],
    *,
    include_content_ids: bool = True,
) -> httpx.Response:
    boundary = "batch_response_boundary"
    parts: list[bytes] = []
    for message_id, (status_code, payload) in responses_by_message_id.items():
        reason = "OK" if status_code < 400 else "Bad Request"
        body = payload if isinstance(payload, str) else json.dumps(payload)
        headers = [
            f"--{boundary}",
            "Content-Type: application/http",
        ]
        if include_content_ids:
            headers.append(f"Content-ID: <response-message-{message_id}>")
        headers.extend(
            [
                "",
                f"HTTP/1.1 {status_code} {reason}",
                "Content-Type: application/json; charset=UTF-8",
                "",
                body,
            ]
        )
        parts.append("\r\n".join(headers).encode("utf-8"))
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    return httpx.Response(
        200,
        headers={"Content-Type": f'multipart/mixed; boundary="{boundary}"'},
        content=b"\r\n".join(parts),
    )


def extract_batch_message_ids(request: httpx.Request) -> list[str]:
    matches = re.findall(
        r"GET /gmail/v1/users/me/messages/([^?\s]+)\?format=full HTTP/1\.1",
        request.content.decode("utf-8"),
    )
    return [unquote(match) for match in matches]


def run(coro):
    return asyncio.run(coro)


def test_list_todays_emails_uses_single_batch_for_small_page(monkeypatch):
    monkeypatch.setattr("services.gmail.get_settings", make_settings)
    requests: list[httpx.Request] = []
    messages = {
        "msg-1": make_message("msg-1", internal_date=2000, subject="Later"),
        "msg-2": make_message("msg-2", internal_date=3000, subject="Latest"),
        "msg-3": make_message("msg-3", internal_date=1000, subject="Earlier"),
    }

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/gmail/v1/users/me/messages":
            return httpx.Response(200, json={"messages": [{"id": message_id} for message_id in messages]})
        if request.url.path == "/batch/gmail/v1":
            ids = extract_batch_message_ids(request)
            return make_batch_http_response({message_id: (200, messages[message_id]) for message_id in ids})
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        items, returned_token = run(list_todays_emails(make_token(), max_emails=10, http_client=client))
    finally:
        run(client.aclose())

    assert returned_token.access_token == "access-token"
    assert [item.id for item in items] == ["msg-2", "msg-1", "msg-3"]
    assert [item.subject for item in items] == ["Latest", "Later", "Earlier"]
    assert items[0].body == "Plain text body"
    assert len([request for request in requests if request.url.path == "/batch/gmail/v1"]) == 1
    assert not any(
        request.method == "GET" and request.url.path.startswith("/gmail/v1/users/me/messages/")
        for request in requests
    )


def test_list_todays_emails_splits_large_pages_into_multiple_batches(monkeypatch):
    monkeypatch.setattr("services.gmail.get_settings", make_settings)
    message_ids = [f"msg-{index}" for index in range(55)]

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/gmail/v1/users/me/messages":
            return httpx.Response(200, json={"messages": [{"id": message_id} for message_id in message_ids]})
        if request.url.path == "/batch/gmail/v1":
            ids = extract_batch_message_ids(request)
            assert len(ids) <= GMAIL_BATCH_MAX_SUBREQUESTS
            return make_batch_http_response(
                {
                    message_id: (
                        200,
                        make_message(message_id, internal_date=1000 + index),
                    )
                    for index, message_id in enumerate(ids)
                }
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    batch_requests: list[list[str]] = []

    async def wrapped_handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/batch/gmail/v1":
            batch_requests.append(extract_batch_message_ids(request))
        return await handler(request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(wrapped_handler))
    try:
        items, _ = run(list_todays_emails(make_token(), max_emails=55, http_client=client))
    finally:
        run(client.aclose())

    assert len(items) == 55
    assert len(batch_requests) == 2
    assert len(batch_requests[0]) == 50
    assert len(batch_requests[1]) == 5


def test_list_todays_emails_skips_failed_subresponses(monkeypatch):
    monkeypatch.setattr("services.gmail.get_settings", make_settings)
    messages = {
        "msg-1": make_message("msg-1", internal_date=1000),
        "msg-3": make_message("msg-3", internal_date=3000),
    }

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/gmail/v1/users/me/messages":
            return httpx.Response(
                200,
                json={"messages": [{"id": "msg-1"}, {"id": "msg-2"}, {"id": "msg-3"}]},
            )
        if request.url.path == "/batch/gmail/v1":
            ids = extract_batch_message_ids(request)
            response_payload = {
                "msg-1": (200, messages["msg-1"]),
                "msg-2": (404, {"error": {"message": "Not found"}}),
                "msg-3": (200, messages["msg-3"]),
            }
            return make_batch_http_response({message_id: response_payload[message_id] for message_id in ids})
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        items, _ = run(list_todays_emails(make_token(), max_emails=10, http_client=client))
    finally:
        run(client.aclose())

    assert [item.id for item in items] == ["msg-3", "msg-1"]


def test_list_todays_emails_raises_for_malformed_outer_batch_response(monkeypatch):
    monkeypatch.setattr("services.gmail.get_settings", make_settings)

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/gmail/v1/users/me/messages":
            return httpx.Response(200, json={"messages": [{"id": "msg-1"}]})
        if request.url.path == "/batch/gmail/v1":
            return httpx.Response(200, headers={"Content-Type": "application/json"}, json={"id": "msg-1"})
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(GmailRequestError, match="multipart"):
            run(list_todays_emails(make_token(), max_emails=10, http_client=client))
    finally:
        run(client.aclose())


def test_list_todays_emails_refreshes_expired_token_before_batch(monkeypatch):
    monkeypatch.setattr("services.gmail.get_settings", make_settings)
    observed_batch_auth_headers: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == GOOGLE_TOKEN_URL:
            return httpx.Response(
                200,
                json={
                    "access_token": "refreshed-access-token",
                    "refresh_token": "refreshed-refresh-token",
                    "token_type": "Bearer",
                    "scope": GMAIL_READONLY_SCOPE,
                    "expires_in": 3600,
                },
            )
        if request.url.path == "/gmail/v1/users/me/messages":
            assert request.headers["Authorization"] == "Bearer refreshed-access-token"
            return httpx.Response(200, json={"messages": [{"id": "msg-1"}]})
        if request.url.path == "/batch/gmail/v1":
            observed_batch_auth_headers.append(request.headers["Authorization"])
            return make_batch_http_response({"msg-1": (200, make_message("msg-1", internal_date=1000))})
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        items, refreshed_token = run(list_todays_emails(make_token(expired=True), max_emails=10, http_client=client))
    finally:
        run(client.aclose())

    assert [item.id for item in items] == ["msg-1"]
    assert observed_batch_auth_headers == ["Bearer refreshed-access-token"]
    assert refreshed_token.access_token == "refreshed-access-token"
    assert refreshed_token.refresh_token == "refreshed-refresh-token"


def test_list_todays_emails_paginates_until_success_limit(monkeypatch):
    monkeypatch.setattr("services.gmail.get_settings", make_settings)
    list_request_page_tokens: list[str | None] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/gmail/v1/users/me/messages":
            page_token = request.url.params.get("pageToken")
            list_request_page_tokens.append(page_token)
            if page_token is None:
                assert request.url.params.get("maxResults") == "3"
                return httpx.Response(
                    200,
                    json={
                        "messages": [{"id": "msg-1"}, {"id": "msg-2"}],
                        "nextPageToken": "page-2",
                    },
                )
            assert page_token == "page-2"
            assert request.url.params.get("maxResults") == "2"
            return httpx.Response(
                200,
                json={"messages": [{"id": "msg-3"}, {"id": "msg-4"}]},
            )
        if request.url.path == "/batch/gmail/v1":
            ids = extract_batch_message_ids(request)
            payloads = {
                "msg-1": (404, {"error": {"message": "gone"}}),
                "msg-2": (200, make_message("msg-2", internal_date=2000)),
                "msg-3": (200, make_message("msg-3", internal_date=3000)),
                "msg-4": (200, make_message("msg-4", internal_date=4000)),
            }
            return make_batch_http_response({message_id: payloads[message_id] for message_id in ids})
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        items, _ = run(list_todays_emails(make_token(), max_emails=3, http_client=client))
    finally:
        run(client.aclose())

    assert [item.id for item in items] == ["msg-4", "msg-3", "msg-2"]
    assert list_request_page_tokens == [None, "page-2"]
