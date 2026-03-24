from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import json
import requests
import sys
from email import policy
from email.parser import BytesParser
from pathlib import Path

repo_root = Path(__file__).resolve().parents[4]
base_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(base_dir))
sys.path.insert(0, str(repo_root))

from models.story import EmailDraft  # noqa: E402
from services.auth.types import StoredGoogleToken  # noqa: E402
from services.gmail import (  # noqa: E402
    GMAIL_READONLY_SCOPE,
    GMAIL_SEND_SCOPE,
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


class FakeResponse:
    def __init__(self, payload: dict | None = None, status_code: int = 200, text: str | None = None):
        self._payload = payload
        self.status_code = status_code
        self.text = text if text is not None else json.dumps(payload or {})
        self.content = self.text.encode("utf-8") if payload is not None or text else b""

    def json(self):
        if self._payload is None:
            raise ValueError("No JSON payload configured.")
        return self._payload


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


def test_list_todays_emails_paginates_sorts_and_extracts_bodies(monkeypatch):
    get_calls: list[dict] = []

    def fake_get(url, headers=None, params=None, timeout=None):
        get_calls.append({"url": url, "headers": headers, "params": params, "timeout": timeout})
        if url.endswith("/messages"):
            if params.get("pageToken") == "page-2":
                return FakeResponse({"messages": [{"id": "msg-3"}]})
            return FakeResponse(
                {
                    "messages": [{"id": "msg-1"}, {"id": "msg-2"}],
                    "nextPageToken": "page-2",
                }
            )
        if url.endswith("/messages/msg-1"):
            return FakeResponse(
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
                }
            )
        if url.endswith("/messages/msg-2"):
            return FakeResponse(
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
                }
            )
        if url.endswith("/messages/msg-3"):
            return FakeResponse(
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
                }
            )
        raise AssertionError(f"Unexpected GET URL: {url}")

    monkeypatch.setattr("services.gmail.requests.get", fake_get)

    emails, _ = list_todays_emails(make_token(scope=GMAIL_READONLY_SCOPE))

    assert [email.id for email in emails] == ["msg-2", "msg-1", "msg-3"]
    assert emails[0].body == "Hello\nWorld"
    assert emails[0].sender == "Client <client@example.com>"
    assert emails[1].body == "Plain body"
    assert emails[2].body == "Nested body"

    list_calls = [call for call in get_calls if call["url"].endswith("/messages")]
    assert len(list_calls) == 2
    assert list_calls[0]["params"]["labelIds"] == "INBOX"
    assert list_calls[0]["params"]["includeSpamTrash"] == "false"
    assert list_calls[0]["params"]["q"].startswith("after:")


def test_list_todays_emails_refreshes_expired_token(monkeypatch):
    get_headers: list[dict[str, str]] = []
    post_calls: list[dict] = []

    def fake_post(url, headers=None, params=None, json=None, data=None, timeout=None):
        post_calls.append({"url": url})
        if url == GOOGLE_TOKEN_URL:
            return FakeResponse(
                {
                    "access_token": "fresh-access-token",
                    "expires_in": 3600,
                    "scope": GMAIL_READONLY_SCOPE,
                    "token_type": "Bearer",
                }
            )
        raise AssertionError(f"Unexpected POST URL: {url}")

    def fake_get(url, headers=None, params=None, timeout=None):
        get_headers.append(headers)
        if url.endswith("/messages"):
            return FakeResponse({"messages": []})
        raise AssertionError(f"Unexpected GET URL: {url}")

    monkeypatch.setattr("services.gmail.requests.post", fake_post)
    monkeypatch.setattr("services.gmail.requests.get", fake_get)
    monkeypatch.setattr("services.gmail.get_settings", lambda: FakeSettings())

    _, returned_token = list_todays_emails(
        make_token(
            scope=GMAIL_READONLY_SCOPE,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
    )

    assert post_calls[0]["url"] == GOOGLE_TOKEN_URL
    assert get_headers[0]["Authorization"] == "Bearer fresh-access-token"
    assert returned_token.access_token == "fresh-access-token"


def test_list_todays_emails_refresh_persists_rotated_refresh_token(monkeypatch):
    def fake_post(url, headers=None, params=None, json=None, data=None, timeout=None):
        if url == GOOGLE_TOKEN_URL:
            return FakeResponse(
                {
                    "access_token": "fresh-access-token",
                    "refresh_token": "rotated-refresh-token",
                    "expires_in": 3600,
                    "scope": GMAIL_READONLY_SCOPE,
                    "token_type": "Bearer",
                }
            )
        raise AssertionError(f"Unexpected POST URL: {url}")

    def fake_get(url, headers=None, params=None, timeout=None):
        if url.endswith("/messages"):
            return FakeResponse({"messages": []})
        raise AssertionError(f"Unexpected GET URL: {url}")

    monkeypatch.setattr("services.gmail.requests.post", fake_post)
    monkeypatch.setattr("services.gmail.requests.get", fake_get)
    monkeypatch.setattr("services.gmail.get_settings", lambda: FakeSettings())

    _, returned_token = list_todays_emails(
        make_token(
            scope=GMAIL_READONLY_SCOPE,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
    )

    assert returned_token.refresh_token == "rotated-refresh-token"


def test_list_todays_emails_refresh_keeps_existing_refresh_token_when_missing(monkeypatch):
    def fake_post(url, headers=None, params=None, json=None, data=None, timeout=None):
        if url == GOOGLE_TOKEN_URL:
            return FakeResponse(
                {
                    "access_token": "fresh-access-token",
                    "expires_in": 3600,
                    "scope": GMAIL_READONLY_SCOPE,
                    "token_type": "Bearer",
                }
            )
        raise AssertionError(f"Unexpected POST URL: {url}")

    def fake_get(url, headers=None, params=None, timeout=None):
        if url.endswith("/messages"):
            return FakeResponse({"messages": []})
        raise AssertionError(f"Unexpected GET URL: {url}")

    monkeypatch.setattr("services.gmail.requests.post", fake_post)
    monkeypatch.setattr("services.gmail.requests.get", fake_get)
    monkeypatch.setattr("services.gmail.get_settings", lambda: FakeSettings())

    _, returned_token = list_todays_emails(
        make_token(
            scope=GMAIL_READONLY_SCOPE,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            refresh_token="existing-refresh-token",
        )
    )

    assert returned_token.refresh_token == "existing-refresh-token"


def test_list_todays_emails_raises_when_token_not_refreshable():
    token = make_token(
        scope=GMAIL_READONLY_SCOPE,
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        refresh_token=None,
    )

    try:
        list_todays_emails(token)
    except GmailRequestError:
        raise AssertionError("Expected token refresh failure, got request error")
    except Exception as exc:
        assert str(exc) == "Google token expired and cannot be refreshed."
    else:
        raise AssertionError("Expected RuntimeError for expired non-refreshable token")


def test_list_todays_emails_raises_when_scope_missing():
    try:
        list_todays_emails(make_token(scope=GMAIL_SEND_SCOPE))
    except Exception as exc:
        assert "Missing required Gmail scopes" in str(exc)
    else:
        raise AssertionError("Expected scope validation failure")


def test_send_draft_replies_sends_threaded_reply_and_falls_back_to_reply_to(monkeypatch):
    post_calls: list[dict] = []

    def fake_get(url, headers=None, params=None, timeout=None):
        if url.endswith("/messages/original-1"):
            return FakeResponse(
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
                }
            )
        raise AssertionError(f"Unexpected GET URL: {url}")

    def fake_post(url, headers=None, params=None, json=None, data=None, timeout=None):
        post_calls.append({"url": url, "headers": headers, "params": params, "json": json, "data": data})
        if url.endswith("/messages/send"):
            return FakeResponse({"id": "sent-1", "threadId": "thread-1"})
        raise AssertionError(f"Unexpected POST URL: {url}")

    monkeypatch.setattr("services.gmail.requests.get", fake_get)
    monkeypatch.setattr("services.gmail.requests.post", fake_post)

    results, _ = send_draft_replies(
        make_token(scope=GMAIL_SEND_SCOPE),
        [
            EmailDraft(
                email_id="original-1",
                to="",
                subject="",
                body="Thanks, sending an update shortly.",
            )
        ],
    )

    assert results[0].status == "sent"
    assert results[0].gmail_message_id == "sent-1"
    payload = post_calls[0]["json"]
    assert payload["threadId"] == "thread-1"

    raw_bytes = _decode_base64url(payload["raw"])
    parsed = BytesParser(policy=policy.default).parsebytes(raw_bytes)
    assert parsed["To"] == "Reply Desk <reply@example.com>"
    assert parsed["Subject"] == "Re: Original subject"
    assert parsed["In-Reply-To"] == "<msg-1@example.com>"
    assert parsed["References"] == "<older@example.com> <msg-1@example.com>"
    assert "Thanks, sending an update shortly." in parsed.get_body(preferencelist=("plain",)).get_content()


def test_send_draft_replies_returns_failed_result_when_original_fetch_fails(monkeypatch):
    def fake_get(url, headers=None, params=None, timeout=None):
        return FakeResponse(status_code=404, text='{"error":"not found"}')

    def fake_post(url, headers=None, params=None, json=None, data=None, timeout=None):
        raise AssertionError("Send endpoint should not be called when original fetch fails")

    monkeypatch.setattr("services.gmail.requests.get", fake_get)
    monkeypatch.setattr("services.gmail.requests.post", fake_post)

    results, _ = send_draft_replies(
        make_token(scope=GMAIL_SEND_SCOPE),
        [EmailDraft(email_id="missing", to="person@example.com", subject="Re: Test", body="Body")],
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


def test_send_draft_replies_supports_mixed_batch_results(monkeypatch):
    sent_payloads: list[dict] = []

    def fake_get(url, headers=None, params=None, timeout=None):
        if url.endswith("/messages/original-good"):
            return FakeResponse(
                {
                    "id": "original-good",
                    "threadId": "thread-good",
                    "payload": {
                        "headers": [
                            {"name": "Subject", "value": "Good"},
                            {"name": "From", "value": "good@example.com"},
                        ]
                    },
                }
            )
        if url.endswith("/messages/original-bad"):
            return FakeResponse(status_code=500, text='{"error":"boom"}')
        raise AssertionError(f"Unexpected GET URL: {url}")

    def fake_post(url, headers=None, params=None, json=None, data=None, timeout=None):
        sent_payloads.append(json)
        if url.endswith("/messages/send"):
            return FakeResponse({"id": "sent-good", "threadId": "thread-good"})
        raise AssertionError(f"Unexpected POST URL: {url}")

    monkeypatch.setattr("services.gmail.requests.get", fake_get)
    monkeypatch.setattr("services.gmail.requests.post", fake_post)

    results, _ = send_draft_replies(
        make_token(scope=GMAIL_SEND_SCOPE),
        [
            EmailDraft(email_id="original-good", to="good@example.com", subject="Re: Good", body="Yes"),
            EmailDraft(email_id="original-bad", to="bad@example.com", subject="Re: Bad", body="No"),
        ],
    )

    assert [result.status for result in results] == ["sent", "failed"]
    assert sent_payloads[0]["threadId"] == "thread-good"
    assert results[1].error == "Gmail API request failed (500)."


def test_send_draft_replies_refreshes_expired_token(monkeypatch):
    get_headers: list[dict[str, str]] = []

    def fake_get(url, headers=None, params=None, timeout=None):
        get_headers.append(headers)
        if url.endswith("/messages/original-1"):
            return FakeResponse(
                {
                    "id": "original-1",
                    "threadId": "thread-1",
                    "payload": {
                        "headers": [
                            {"name": "Subject", "value": "Original"},
                            {"name": "From", "value": "boss@example.com"},
                        ]
                    },
                }
            )
        raise AssertionError(f"Unexpected GET URL: {url}")

    def fake_post(url, headers=None, params=None, json=None, data=None, timeout=None):
        if url == GOOGLE_TOKEN_URL:
            return FakeResponse(
                {
                    "access_token": "fresh-send-token",
                    "expires_in": 3600,
                    "scope": GMAIL_SEND_SCOPE,
                    "token_type": "Bearer",
                }
            )
        if url.endswith("/messages/send"):
            assert headers["Authorization"] == "Bearer fresh-send-token"
            return FakeResponse({"id": "sent-1", "threadId": "thread-1"})
        raise AssertionError(f"Unexpected POST URL: {url}")

    monkeypatch.setattr("services.gmail.requests.get", fake_get)
    monkeypatch.setattr("services.gmail.requests.post", fake_post)
    monkeypatch.setattr("services.gmail.get_settings", lambda: FakeSettings())

    results, returned_token = send_draft_replies(
        make_token(
            scope=GMAIL_SEND_SCOPE,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        ),
        [EmailDraft(email_id="original-1", to="boss@example.com", subject="Re: Original", body="Reply")],
    )

    assert results[0].status == "sent"
    assert get_headers[0]["Authorization"] == "Bearer fresh-send-token"
    assert returned_token.access_token == "fresh-send-token"


def test_send_draft_replies_raises_when_scope_missing():
    try:
        send_draft_replies(
            make_token(scope=GMAIL_READONLY_SCOPE),
            [EmailDraft(email_id="original-1", to="boss@example.com", subject="Re: Original", body="Reply")],
        )
    except Exception as exc:
        assert "Missing required Gmail scopes" in str(exc)
    else:
        raise AssertionError("Expected scope validation failure")


def test_list_todays_emails_skips_message_with_malformed_body(monkeypatch):
    def fake_get(url, headers=None, params=None, timeout=None):
        if url.endswith("/messages"):
            return FakeResponse({"messages": [{"id": "bad-msg"}, {"id": "good-msg"}]})
        if url.endswith("/messages/bad-msg"):
            return FakeResponse(
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
                }
            )
        if url.endswith("/messages/good-msg"):
            return FakeResponse(
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
                }
            )
        raise AssertionError(f"Unexpected GET URL: {url}")

    monkeypatch.setattr("services.gmail.requests.get", fake_get)

    emails, _ = list_todays_emails(make_token(scope=GMAIL_READONLY_SCOPE))

    assert [email.id for email in emails] == ["good-msg"]


def test_decode_base64url_raises_precise_parse_error():
    try:
        _decode_base64url("*")
    except GmailMessageParseError as exc:
        assert str(exc) == "Malformed Gmail message body encoding."
    else:
        raise AssertionError("Expected GmailMessageParseError")


def test_gmail_request_network_failure_raises_precise_error(monkeypatch):
    def fake_get(url, headers=None, params=None, timeout=None):
        raise requests.RequestException("network down")

    monkeypatch.setattr("services.gmail.requests.get", fake_get)

    try:
        list_todays_emails(make_token(scope=GMAIL_READONLY_SCOPE))
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
