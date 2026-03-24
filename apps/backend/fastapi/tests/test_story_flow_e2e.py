from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

base_dir = Path(__file__).resolve().parents[1]
repo_root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(base_dir))
sys.path.insert(0, str(repo_root))

from models.story import EmailDraft, Scene  # noqa: E402
from routes.story import StorySession, router as story_router  # noqa: E402
from services.tts import SceneTTSCacheEntry  # noqa: E402


def test_story_scene_flow_end_to_end(monkeypatch):
    app = FastAPI()
    app.include_router(story_router)

    inbox = [
        {
            "id": "email-1",
            "sender": "manager@company.com",
            "subject": "Need status update by EOD",
            "snippet": "Can you send a short status update before 5pm?",
        },
        {
            "id": "email-2",
            "sender": "client@startup.io",
            "subject": "Follow-up on proposal",
            "snippet": "Could you clarify timeline and pricing details?",
        },
    ]

    def fake_build_scene(emails, trace, max_scenes=3):
        assert emails
        if not trace:
            return Scene.model_validate(
                {
                    "scene_id": "scene-1",
                    "npc_id": "email-1",
                    "npc_name": "Manager Steve",
                    "dialogue": "The village chief asks for your progress before sunset.",
                    "choices": [
                        {
                            "slug": "agree-fast",
                            "label": "Send now",
                            "intent": "agree_immediately",
                        },
                        {
                            "slug": "ask-time",
                            "label": "Ask for time",
                            "intent": "ask_for_more_time",
                        },
                        {
                            "slug": "chaos",
                            "label": "Cause chaos",
                            "intent": "rude_dismissal",
                        },
                    ],
                    "is_terminal": False,
                    "related_email_ids": ["email-1"],
                }
            )
        return Scene.model_validate(
            {
                "scene_id": "scene-2",
                "npc_id": "narrator",
                "npc_name": "The Narrator",
                "dialogue": "Your inbox quest is complete.",
                "choices": [],
                "is_terminal": True,
                "related_email_ids": ["email-1", "email-2"],
            }
        )

    def fake_resolve_emails(emails, trace, user_context="", email_context_by_id=None):
        assert len(trace) == 1
        assert trace[0].scene_id == "scene-1"
        assert trace[0].choice_slug == "agree-fast"
        assert trace[0].choice_intent == "agree_immediately"
        assert trace[0].choice_context == "timeline 6 weeks, budget 20k max"
        assert trace[0].related_email_ids == ["email-1"]
        assert "budget cap 20k" in user_context
        assert (email_context_by_id or {}).get("email-2") == "timeline is 6 weeks"
        return [
            EmailDraft(
                email_id="email-1",
                to="manager@company.com",
                subject="Re: Need status update by EOD",
                body="Thanks for the reminder. I will send the status update before 5pm.",
            ),
            EmailDraft(
                email_id="email-2",
                to="client@startup.io",
                subject="Re: Follow-up on proposal",
                body="Thanks for the follow-up. I will send timeline and pricing details today.",
            ),
        ]

    monkeypatch.setattr("routes.story.build_scene", fake_build_scene)
    monkeypatch.setattr("routes.story.resolve_emails", fake_resolve_emails)
    monkeypatch.setattr(
        "routes.story.ensure_scene_entry",
        lambda session_id, scene_id: SimpleNamespace(voice_id="voice-1"),
    )
    monkeypatch.setattr("routes.story.generate_and_cache_scene_tts", lambda *args, **kwargs: None)
    monkeypatch.setattr("routes.story.SESSIONS", {})

    client = TestClient(app)

    start = client.post(
        "/story/scene/start",
        json={"user_id": "demo-user", "inbox_override": inbox},
    )
    assert start.status_code == 200
    start_json = start.json()
    assert start_json["done"] is False
    assert start_json["scene"]["scene_id"] == "scene-1"
    assert len(start_json["scene"]["choices"]) == 3
    assert start_json["scene"]["tts"]
    assert start_json["scene"]["voice_id"] == "voice-1"

    session_id = start_json["session_id"]
    advance = client.post(
        f"/story/scene/{session_id}/advance",
        json={
            "choice_slug": "agree-fast",
            "choice_context": "timeline 6 weeks, budget 20k max",
        },
    )
    assert advance.status_code == 200
    advance_json = advance.json()
    assert advance_json["done"] is True
    assert advance_json["scene"]["is_terminal"] is True
    assert advance_json["scene"]["tts"] == f"/story/scene/{session_id}/scene-2/tts"
    assert advance_json["scene"]["voice_id"] == "voice-1"
    assert len(advance_json["trace"]) == 1
    assert advance_json["trace"][0]["choice_intent"] == "agree_immediately"
    assert advance_json["trace"][0]["choice_context"] == "timeline 6 weeks, budget 20k max"
    assert advance_json["trace"][0]["related_email_ids"] == ["email-1"]

    resolve = client.post(
        f"/story/scene/{session_id}/resolve",
        json={
            "user_context": "pricing constraints: budget cap 20k",
            "email_context_by_id": {"email-2": "timeline is 6 weeks"},
        },
    )
    assert resolve.status_code == 200
    resolve_json = resolve.json()
    assert resolve_json["session_id"] == session_id
    assert len(resolve_json["drafts"]) == 2
    assert {draft["email_id"] for draft in resolve_json["drafts"]} == {
        "email-1",
        "email-2",
    }


def test_scene_tts_stream_cache_hit(monkeypatch):
    app = FastAPI()
    app.include_router(story_router)
    session_id = "session-1"
    scene_id = "scene-1"
    monkeypatch.setattr(
        "routes.story.SESSIONS",
        {
            session_id: StorySession(
                emails=[],
                current_scene=Scene.model_validate(
                    {
                        "scene_id": scene_id,
                        "npc_id": "npc-1",
                        "npc_name": "Manager Steve",
                        "dialogue": "Status update please. We still need this today.",
                        "choices": [],
                        "is_terminal": True,
                        "related_email_ids": [],
                    }
                ),
            )
        },
    )
    monkeypatch.setattr(
        "routes.story.get_scene_entry",
        lambda session_id, scene_id: SceneTTSCacheEntry(
            status="ready", voice_id="voice-1", audio_bytes=b"ID3test", error=None
        ),
    )
    client = TestClient(app)
    res = client.get(f"/story/scene/{session_id}/{scene_id}/tts")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("audio/mpeg")
    assert res.content == b"ID3test"


def test_scene_tts_stream_pending(monkeypatch):
    app = FastAPI()
    app.include_router(story_router)
    session_id = "session-2"
    scene_id = "scene-2"
    monkeypatch.setattr(
        "routes.story.SESSIONS",
        {
            session_id: StorySession(
                emails=[],
                current_scene=Scene.model_validate(
                    {
                        "scene_id": scene_id,
                        "npc_id": "npc-2",
                        "npc_name": "Client Builder",
                        "dialogue": "Can you clarify pricing details? We need a timeline too.",
                        "choices": [],
                        "is_terminal": True,
                        "related_email_ids": [],
                    }
                ),
            )
        },
    )
    monkeypatch.setattr(
        "routes.story.get_scene_entry",
        lambda session_id, scene_id: SceneTTSCacheEntry(
            status="pending", voice_id="voice-2", audio_bytes=None, error=None
        ),
    )
    client = TestClient(app)
    res = client.get(f"/story/scene/{session_id}/{scene_id}/tts")
    assert res.status_code == 202
    assert res.json() == {"status": "pending"}
    assert res.headers["retry-after"] == "1"


def test_scene_tts_stream_provider_failure(monkeypatch):
    app = FastAPI()
    app.include_router(story_router)
    session_id = "session-3"
    scene_id = "scene-3"
    monkeypatch.setattr(
        "routes.story.SESSIONS",
        {
            session_id: StorySession(
                emails=[],
                current_scene=Scene.model_validate(
                    {
                        "scene_id": scene_id,
                        "npc_id": "npc-3",
                        "npc_name": "Ops Villager",
                        "dialogue": "The pipeline failed and needs action now.",
                        "choices": [],
                        "is_terminal": True,
                        "related_email_ids": [],
                    }
                ),
            )
        },
    )
    monkeypatch.setattr(
        "routes.story.get_scene_entry",
        lambda session_id, scene_id: SceneTTSCacheEntry(
            status="failed", voice_id="voice-3", audio_bytes=None, error="provider timeout"
        ),
    )
    client = TestClient(app)
    res = client.get(f"/story/scene/{session_id}/{scene_id}/tts")
    assert res.status_code == 502
    assert "provider timeout" in res.json()["detail"]
