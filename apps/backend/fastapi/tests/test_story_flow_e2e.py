from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

base_dir = Path(__file__).resolve().parents[1]
repo_root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(base_dir))
sys.path.insert(0, str(repo_root))

from models.story import EmailDraft, Scene
from routes.story import router as story_router


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

    def fake_resolve_emails(emails, trace):
        assert len(trace) == 1
        assert trace[0].scene_id == "scene-1"
        assert trace[0].choice_slug == "agree-fast"
        assert trace[0].choice_intent == "agree_immediately"
        assert trace[0].related_email_ids == ["email-1"]
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

    session_id = start_json["session_id"]
    advance = client.post(
        f"/story/scene/{session_id}/advance",
        json={"choice_slug": "agree-fast"},
    )
    assert advance.status_code == 200
    advance_json = advance.json()
    assert advance_json["done"] is True
    assert advance_json["scene"]["is_terminal"] is True
    assert len(advance_json["trace"]) == 1
    assert advance_json["trace"][0]["choice_intent"] == "agree_immediately"
    assert advance_json["trace"][0]["related_email_ids"] == ["email-1"]

    resolve = client.post(f"/story/scene/{session_id}/resolve")
    assert resolve.status_code == 200
    resolve_json = resolve.json()
    assert resolve_json["session_id"] == session_id
    assert len(resolve_json["drafts"]) == 2
    assert {draft["email_id"] for draft in resolve_json["drafts"]} == {
        "email-1",
        "email-2",
    }
