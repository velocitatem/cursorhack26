from __future__ import annotations

import asyncio
import base64
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
import json
import sys
from pathlib import Path

import httpx

repo_root = Path(__file__).resolve().parents[4]
base_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(base_dir))
sys.path.insert(0, str(repo_root))

from models.story import EmailDraft  # noqa: E402
from services.auth.types import StoredGoogleToken  # noqa: E402
from services.gmail import (  # noqa: E402
    DEFAULT_HTTP_TIMEOUT,
    GMAIL_READONLY_SCOPE,
    GMAIL_SEND_SCOPE,
    GMAIL_API_BASE,
    GmailMessageParseError,
    GmailRequestError,
    GOOGLE_TOKEN_URL,
    _build_today_query,
    _decode_base64url,
    list_todays_emails,
    send_draft_replies,
)


class FakeSettings:
    google_client_id = "client-id"
    google_client_secret = "client-secret"


def make_response(
    request: httpx.Request,
    payload: dict | None = None,
    *,
    status_code: int = 200,
    text: str | None = None,
) -> httpx.Response:
    if payload is not None:
        return httpx.Response(status_code, json=payload, request=request)
    if text is not None:
        return httpx.Response(status_code, text=text, request=request)
    return httpx.Response(status_code, content=b"", request=request)


def run_with_transport(handler, coro_factory):
    async def runner():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport, timeout=DEFAULT_HTTP_TIMEOUT) as client:
            return await coro_factory(client)

    return asyncio.run(runner())


def request_json(request: httpx.Request) -> dict:
    return json.loads(request.content.decode("utf-8"))


def make_token(
    *,
    scope: str,
    expires_at: datetime | None = None,
    refresh_token: str | None = "refresh-token",
) -> StoredGoogleToken:
    return StoredGoogleToken(
        user_id="user-1",
        access_token="access-token",
        refresh_token=refresh_token,
        id_token="id-token",
        scope=scope,
        token_type="Bearer",
        expires_at=expires_at,
    )


def encode_text(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode("utf-8")).decode("ascii").rstrip("=")


def test_list_todays_emails_paginates_sorts_and_extracts_bodies():
    request_log: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        request_log.append(request)
        if request.method == "GET" and request.url.path == "/gmail/v1/users/me/messages":
            if request.url.params.get("pageToken") == "page-2":
                return make_response(request, {"messages": [{"id": "msg-3"}]})
            return make_response(
                request,
                {
                    "messages": [{"id": "msg-1"}, {"id": "msg-2"}],
                    "nextPageToken": "page-2",
                },
            )
        if request.method == "GET" and request.url == httpx.URL(f"{GMAIL_API_BASE}/messages/msg-1?format=full"):
            return make_response(
                request,
                {
                    "id": "msg-1",
                    "threadId": "thread-1",
                    "internalDate": "100",
                    "snippet": "plain snippet",
                    "payload": {
                        "mimeType": "multipart/alternative",
                        "headers": [
                            {"name": "From", "value": "Boss <boss@example.com>"},
                            {"name": "Subject", "value": "Status"},
                        ],
                        "parts": [
                            {"mimeType": "text/html", "body": {"data": encode_text("<p>Ignore html</p>")}},
                            {"mimeType": "text/plain", "body": {"data": encode_text("Plain body")}},
                        ],
                    },
                },
            )
        if request.method == "GET" and request.url == httpx.URL(f"{GMAIL_API_BASE}/messages/msg-2?format=full"):
            return make_response(
                request,
                {
                    "id": "msg-2",
                    "threadId": "thread-2",
                    "internalDate": "200",
                    "snippet": "html snippet",
                    "payload": {
                        "mimeType": "text/html",
                        "headers": [
                            {"name": "From", "value": "Client <client@example.com>"},
                            {"name": "Subject", "value": "Proposal"},
                        ],
                        "body": {"data": encode_text("<div>Hello<br>World</div>")},
                    },
                },
            )
        if request.method == "GET" and request.url == httpx.URL(f"{GMAIL_API_BASE}/messages/msg-3?format=full"):
            return make_response(
                request,
                {
                    "id": "msg-3",
                    "threadId": "thread-3",
                    "internalDate": "50",
                    "snippet": "nested snippet",
                    "payload": {
                        "mimeType": "multipart/mixed",
                        "headers": [
                            {"name": "From", "value": "Ops <ops@example.com>"},
                            {"name": "Subject", "value": "Check-in"},
                        ],
                        "parts": [
                            {
                                "mimeType": "multipart/alternative",
                                "parts": [
                                    {"mimeType": "text/plain", "body": {"data": encode_text("Nested body")}},
                                ],
                            }
                        ],
                    },
                },
            )
        raise AssertionError(f"Unexpected {request.method} URL: {request.url}")

    emails, _ = run_with_transport(
        handler,
        lambda client: list_todays_emails(
            make_token(scope=GMAIL_READONLY_SCOPE),
            http_client=client,
        ),
    )

    assert [email.id for email in emails] == ["msg-2", "msg-1", "msg-3"]
    assert emails[0].body == "Hello\nWorld"
    assert emails[0].sender == "Client <client@example.com>"
    assert emails[1].body == "Plain body"
    assert emails[2].body == "Nested body"

    list_calls = [request for request in request_log if request.url.path == "/gmail/v1/users/me/messages"]
    assert len(list_calls) == 2
    assert list_calls[0].url.params["labelIds"] == "INBOX"
    assert list_calls[0].url.params["includeSpamTrash"] == "false"
    assert list_calls[0].url.params["q"].startswith("after:")


def test_list_todays_emails_refreshes_expired_token(monkeypatch):
    request_log: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        request_log.append(request)
        if request.method == "POST" and str(request.url) == GOOGLE_TOKEN_URL:
            return make_response(
                request,
                {
                    "access_token": "fresh-access-token",
                    "expires_in": 3600,
                    "scope": GMAIL_READONLY_SCOPE,
                    "token_type": "Bearer",
                },
            )
        if request.method == "GET" and request.url.path == "/gmail/v1/users/me/messages":
            return make_response(request, {"messages": []})
        raise AssertionError(f"Unexpected {request.method} URL: {request.url}")

    monkeypatch.setattr("services.gmail.get_settings", lambda: FakeSettings())

    _, returned_token = run_with_transport(
        handler,
        lambda client: list_todays_emails(
            make_token(
                scope=GMAIL_READONLY_SCOPE,
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            ),
            http_client=client,
        ),
    )

    assert str(request_log[0].url) == GOOGLE_TOKEN_URL
    assert request_log[1].headers["Authorization"] == "Bearer fresh-access-token"
    assert returned_token.access_token == "fresh-access-token"


def test_list_todays_emails_refresh_persists_rotated_refresh_token(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and str(request.url) == GOOGLE_TOKEN_URL:
            return make_response(
                request,
                {
                    "access_token": "fresh-access-token",
                    "refresh_token": "rotated-refresh-token",
                    "expires_in": 3600,
                    "scope": GMAIL_READONLY_SCOPE,
                    "token_type": "Bearer",
                },
            )
        if request.method == "GET" and request.url.path == "/gmail/v1/users/me/messages":
            return make_response(request, {"messages": []})
        raise AssertionError(f"Unexpected {request.method} URL: {request.url}")

    monkeypatch.setattr("services.gmail.get_settings", lambda: FakeSettings())

    _, returned_token = run_with_transport(
        handler,
        lambda client: list_todays_emails(
            make_token(
                scope=GMAIL_READONLY_SCOPE,
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            ),
            http_client=client,
        ),
    )

    assert returned_token.refresh_token == "rotated-refresh-token"


def test_list_todays_emails_refresh_keeps_existing_refresh_token_when_missing(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and str(request.url) == GOOGLE_TOKEN_URL:
            return make_response(
                request,
                {
                    "access_token": "fresh-access-token",
                    "expires_in": 3600,
                    "scope": GMAIL_READONLY_SCOPE,
                    "token_type": "Bearer",
                },
            )
        if request.method == "GET" and request.url.path == "/gmail/v1/users/me/messages":
            return make_response(request, {"messages": []})
        raise AssertionError(f"Unexpected {request.method} URL: {request.url}")

    monkeypatch.setattr("services.gmail.get_settings", lambda: FakeSettings())

    _, returned_token = run_with_transport(
        handler,
        lambda client: list_todays_emails(
            make_token(
                scope=GMAIL_READONLY_SCOPE,
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
                refresh_token="existing-refresh-token",
            ),
            http_client=client,
        ),
    )

    assert returned_token.refresh_token == "existing-refresh-token"


def test_list_todays_emails_raises_when_token_not_refreshable():
    token = make_token(
        scope=GMAIL_READONLY_SCOPE,
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        refresh_token=None,
    )

    try:
        asyncio.run(list_todays_emails(token))
    except GmailRequestError:
        raise AssertionError("Expected token refresh failure, got request error")
    except Exception as exc:
        assert str(exc) == "Google token expired and cannot be refreshed."
    else:
        raise AssertionError("Expected RuntimeError for expired non-refreshable token")


def test_list_todays_emails_raises_when_scope_missing():
    try:
        asyncio.run(list_todays_emails(make_token(scope=GMAIL_SEND_SCOPE)))
    except Exception as exc:
        assert "Missing required Gmail scopes" in str(exc)
    else:
        raise AssertionError("Expected scope validation failure")


def test_send_draft_replies_sends_threaded_reply_and_falls_back_to_reply_to():
    post_payloads: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path.endswith("/messages/original-1"):
            return make_response(
                request,
                {
                    "id": "original-1",
                    "threadId": "thread-1",
                    "payload": {
                        "headers": [
                            {"name": "Message-ID", "value": "<msg-1@example.com>"},
                            {"name": "References", "value": "<older@example.com>"},
                            {"name": "Subject", "value": "Original subject"},
                            {"name": "From", "value": "Boss <boss@example.com>"},
                            {"name": "Reply-To", "value": "Reply Desk <reply@example.com>"},
                        ]
                    },
                },
            )
        if request.method == "POST" and request.url.path.endswith("/messages/send"):
            post_payloads.append(request_json(request))
            return make_response(request, {"id": "sent-1", "threadId": "thread-1"})
        raise AssertionError(f"Unexpected {request.method} URL: {request.url}")

    results, _ = run_with_transport(
        handler,
        lambda client: send_draft_replies(
            make_token(scope=GMAIL_SEND_SCOPE),
            [
                EmailDraft(
                    email_id="original-1",
                    to="",
                    subject="",
                    body="Thanks, sending an update shortly.",
                )
            ],
            http_client=client,
        ),
    )

    assert results[0].status == "sent"
    assert results[0].gmail_message_id == "sent-1"
    payload = post_payloads[0]
    assert payload["threadId"] == "thread-1"

    raw_bytes = _decode_base64url(payload["raw"])
    parsed = BytesParser(policy=policy.default).parsebytes(raw_bytes)
    assert parsed["To"] == "Reply Desk <reply@example.com>"
    assert parsed["Subject"] == "Re: Original subject"
    assert parsed["In-Reply-To"] == "<msg-1@example.com>"
    assert parsed["References"] == "<older@example.com> <msg-1@example.com>"
    assert "Thanks, sending an update shortly." in parsed.get_body(preferencelist=("plain",)).get_content()


def test_send_draft_replies_returns_failed_result_when_original_fetch_fails():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path.endswith("/messages/missing"):
            return make_response(request, status_code=404, text='{"error":"not found"}')
        raise AssertionError(f"Unexpected {request.method} URL: {request.url}")

    results, _ = run_with_transport(
        handler,
        lambda client: send_draft_replies(
            make_token(scope=GMAIL_SEND_SCOPE),
            [EmailDraft(email_id="missing", to="person@example.com", subject="Re: Test", body="Body")],
            http_client=client,
        ),
    )

    assert results == [
        type(results[0])(
            email_id="missing",
            thread_id=None,
            gmail_message_id=None,
            status="failed",
            error="Gmail API request failed (404).",
        )
    ]


def test_send_draft_replies_supports_mixed_batch_results():
    sent_payloads: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path.endswith("/messages/original-good"):
            return make_response(
                request,
                {
                    "id": "original-good",
                    "threadId": "thread-good",
                    "payload": {
                        "headers": [
                            {"name": "Subject", "value": "Good"},
                            {"name": "From", "value": "good@example.com"},
                        ]
                    },
                },
            )
        if request.method == "GET" and request.url.path.endswith("/messages/original-bad"):
            return make_response(request, status_code=500, text='{"error":"boom"}')
        if request.method == "POST" and request.url.path.endswith("/messages/send"):
            sent_payloads.append(request_json(request))
            return make_response(request, {"id": "sent-good", "threadId": "thread-good"})
        raise AssertionError(f"Unexpected {request.method} URL: {request.url}")

    results, _ = run_with_transport(
        handler,
        lambda client: send_draft_replies(
            make_token(scope=GMAIL_SEND_SCOPE),
            [
                EmailDraft(email_id="original-good", to="good@example.com", subject="Re: Good", body="Yes"),
                EmailDraft(email_id="original-bad", to="bad@example.com", subject="Re: Bad", body="No"),
            ],
            http_client=client,
        ),
    )

    assert [result.status for result in results] == ["sent", "failed"]
    assert sent_payloads[0]["threadId"] == "thread-good"
    assert results[1].error == "Gmail API request failed (500)."


def test_send_draft_replies_refreshes_expired_token(monkeypatch):
    request_log: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        request_log.append(request)
        if request.method == "POST" and str(request.url) == GOOGLE_TOKEN_URL:
            return make_response(
                request,
                {
                    "access_token": "fresh-send-token",
                    "expires_in": 3600,
                    "scope": GMAIL_SEND_SCOPE,
                    "token_type": "Bearer",
                },
            )
        if request.method == "GET" and request.url.path.endswith("/messages/original-1"):
            return make_response(
                request,
                {
                    "id": "original-1",
                    "threadId": "thread-1",
                    "payload": {
                        "headers": [
                            {"name": "Subject", "value": "Original"},
                            {"name": "From", "value": "boss@example.com"},
                        ]
                    },
                },
            )
        if request.method == "POST" and request.url.path.endswith("/messages/send"):
            assert request.headers["Authorization"] == "Bearer fresh-send-token"
            return make_response(request, {"id": "sent-1", "threadId": "thread-1"})
        raise AssertionError(f"Unexpected {request.method} URL: {request.url}")

    monkeypatch.setattr("services.gmail.get_settings", lambda: FakeSettings())

    results, returned_token = run_with_transport(
        handler,
        lambda client: send_draft_replies(
            make_token(
                scope=GMAIL_SEND_SCOPE,
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            ),
            [EmailDraft(email_id="original-1", to="boss@example.com", subject="Re: Original", body="Reply")],
            http_client=client,
        ),
    )

    assert results[0].status == "sent"
    assert request_log[1].headers["Authorization"] == "Bearer fresh-send-token"
    assert returned_token.access_token == "fresh-send-token"


def test_send_draft_replies_raises_when_scope_missing():
    try:
        asyncio.run(
            send_draft_replies(
                make_token(scope=GMAIL_READONLY_SCOPE),
                [EmailDraft(email_id="original-1", to="boss@example.com", subject="Re: Original", body="Reply")],
            )
        )
    except Exception as exc:
        assert "Missing required Gmail scopes" in str(exc)
    else:
        raise AssertionError("Expected scope validation failure")


def test_list_todays_emails_skips_message_with_malformed_body():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == "/gmail/v1/users/me/messages":
            return make_response(request, {"messages": [{"id": "bad-msg"}, {"id": "good-msg"}]})
        if request.method == "GET" and request.url == httpx.URL(f"{GMAIL_API_BASE}/messages/bad-msg?format=full"):
            return make_response(
                request,
                {
                    "id": "bad-msg",
                    "threadId": "bad-thread",
                    "internalDate": "10",
                    "snippet": "bad",
                    "payload": {
                        "mimeType": "text/plain",
                        "headers": [{"name": "From", "value": "bad@example.com"}],
                        "body": {"data": "!"},
                    },
                },
            )
        if request.method == "GET" and request.url == httpx.URL(f"{GMAIL_API_BASE}/messages/good-msg?format=full"):
            return make_response(
                request,
                {
                    "id": "good-msg",
                    "threadId": "good-thread",
                    "internalDate": "20",
                    "snippet": "good",
                    "payload": {
                        "mimeType": "text/plain",
                        "headers": [{"name": "From", "value": "good@example.com"}],
                        "body": {"data": encode_text("Good body")},
                    },
                },
            )
        raise AssertionError(f"Unexpected {request.method} URL: {request.url}")

    emails, _ = run_with_transport(
        handler,
        lambda client: list_todays_emails(
            make_token(scope=GMAIL_READONLY_SCOPE),
            http_client=client,
        ),
    )

    assert [email.id for email in emails] == ["good-msg"]


def test_decode_base64url_raises_precise_parse_error():
    try:
        _decode_base64url("*")
    except GmailMessageParseError as exc:
        assert str(exc) == "Malformed Gmail message body encoding."
    else:
        raise AssertionError("Expected GmailMessageParseError")


def test_gmail_request_network_failure_raises_precise_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("network down", request=request)

    try:
        run_with_transport(
            handler,
            lambda client: list_todays_emails(
                make_token(scope=GMAIL_READONLY_SCOPE),
                http_client=client,
            ),
        )
    except GmailRequestError as exc:
        assert "network down" in str(exc)
    else:
        raise AssertionError("Expected GmailRequestError")


def test_build_today_query_uses_same_local_day_window():
    now = datetime(2026, 3, 24, 15, 30, tzinfo=timezone.utc)
    query = _build_today_query(now)
    local_now = now.astimezone()
    start_of_day = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    assert query == f"after:{int(start_of_day.timestamp())} before:{int(local_now.timestamp())}"
