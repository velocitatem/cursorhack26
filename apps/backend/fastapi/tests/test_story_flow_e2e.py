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
from models.world import WorldLocation, WorldPlan, WorldPlanBuild  # noqa: E402
from routes.story import StorySession, router as story_router  # noqa: E402
from services.tts import SceneTTSCacheEntry  # noqa: E402


def test_story_preview_returns_mock_inbox_without_auth_repo():
    app = FastAPI()
    app.include_router(story_router)
    client = TestClient(app)

    preview = client.post("/story/scene/preview", json={"user_id": "demo-user"})
    assert preview.status_code == 200
    preview_json = preview.json()
    assert preview_json["source"] == "mock"
    assert len(preview_json["emails"]) == 2


def test_story_preview_returns_override_inbox():
    app = FastAPI()
    app.include_router(story_router)
    client = TestClient(app)

    inbox = [
        {
            "id": "email-99",
            "sender": "founder@company.com",
            "subject": "Decision before lunch",
            "snippet": "Need a clear yes or no this morning.",
        }
    ]

    preview = client.post(
        "/story/scene/preview",
        json={"user_id": "demo-user", "inbox_override": inbox},
    )
    assert preview.status_code == 200
    preview_json = preview.json()
    assert preview_json["source"] == "override"
    assert len(preview_json["emails"]) == 1
    assert preview_json["emails"][0]["id"] == inbox[0]["id"]
    assert preview_json["emails"][0]["sender"] == inbox[0]["sender"]
    assert preview_json["emails"][0]["subject"] == inbox[0]["subject"]


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

    def fake_world_plan(emails, user_id, max_locations=5, run_seed=None):
        raise RuntimeError("planner unavailable")

    monkeypatch.setattr("routes.story.build_scene", fake_build_scene)
    monkeypatch.setattr("routes.story.resolve_emails", fake_resolve_emails)
    monkeypatch.setattr("routes.story.build_world_plan", fake_world_plan)
    monkeypatch.setattr(
        "routes.story.ensure_scene_entry",
        lambda session_id, scene_id: SimpleNamespace(voice_id="voice-1"),
    )
    monkeypatch.setattr(
        "routes.story.ensure_speaker_entry",
        lambda session_id, scene_id, voice_key: SimpleNamespace(
            voice_id=f"voice-{voice_key}"
        ),
    )
    monkeypatch.setattr(
        "routes.story.generate_and_cache_scene_tts", lambda *args, **kwargs: None
    )
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
    assert (
        advance_json["trace"][0]["choice_context"] == "timeline 6 weeks, budget 20k max"
    )
    assert advance_json["trace"][0]["related_email_ids"] == ["email-1"]
    assert advance_json["trace"][0]["from_location_id"] == ""
    assert advance_json["trace"][0]["to_location_id"] == ""

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


def test_story_start_uses_world_plan(monkeypatch):
    monkeypatch.setenv("STORY_WORLD_HUB_MODE", "true")
    app = FastAPI()
    app.include_router(story_router)

    inbox = [
        {
            "id": "email-1",
            "sender": "manager@company.com",
            "subject": "Need status update by EOD",
            "snippet": "Send update.",
        },
        {
            "id": "email-2",
            "sender": "client@startup.io",
            "subject": "Follow-up on proposal",
            "snippet": "Need timeline.",
        },
    ]

    scene_start = Scene.model_validate(
        {
            "scene_id": "scene-loc-1",
            "npc_id": "email-1",
            "npc_name": "Manager Steve",
            "dialogue": "Send update now. Keep it concise.",
            "choices": [
                {"slug": "go-next", "label": "Go next", "intent": "agree_immediately"}
            ],
            "is_terminal": False,
            "related_email_ids": ["email-1"],
        }
    )
    scene_end = Scene.model_validate(
        {
            "scene_id": "scene-loc-2",
            "npc_id": "email-2",
            "npc_name": "Client Builder",
            "dialogue": "Wrap up route. Confirm timeline.",
            "choices": [],
            "is_terminal": True,
            "related_email_ids": ["email-2"],
        }
    )
    world_plan = WorldPlan(
        world_id="world-demo",
        entry_location_id="loc-1",
        locations=[
            WorldLocation(
                id="loc-1",
                scene=scene_start,
                bounds={"minX": -14, "maxX": 14, "minZ": -14, "maxZ": 14},
            ),
            WorldLocation(
                id="loc-2",
                scene=scene_end,
                bounds={"minX": -14, "maxX": 14, "minZ": -14, "maxZ": 14},
            ),
        ],
        transitions={"loc-1": {"go-next": "loc-2"}, "loc-2": {}},
    )

    monkeypatch.setattr(
        "routes.story.build_world_plan",
        lambda emails, user_id, max_locations=5, run_seed=None: WorldPlanBuild(
            plan=world_plan,
            source="test",
            run_seed=run_seed or 0,
        ),
    )
    monkeypatch.setattr(
        "routes.story.ensure_scene_entry",
        lambda session_id, scene_id: SimpleNamespace(voice_id="voice-1"),
    )
    monkeypatch.setattr(
        "routes.story.ensure_speaker_entry",
        lambda session_id, scene_id, voice_key: SimpleNamespace(
            voice_id=f"voice-{voice_key}"
        ),
    )
    monkeypatch.setattr(
        "routes.story.generate_and_cache_scene_tts", lambda *args, **kwargs: None
    )
    monkeypatch.setattr("routes.story.SESSIONS", {})

    client = TestClient(app)
    start = client.post(
        "/story/scene/start", json={"user_id": "demo-user", "inbox_override": inbox}
    )
    assert start.status_code == 200
    body = start.json()
    assert body["scene"]["world"]["world_id"] == "world-demo"
    assert body["scene"]["world"]["location_id"] == "hub"
    assert len(body["scene"]["npcs"]) == 2
    assert {npc["email_id"] for npc in body["scene"]["npcs"]} == {"email-1", "email-2"}
    assert (
        body["scene"]["npcs"][0]["tts"]
        == f"/story/scene/{body['session_id']}/scene-loc-1-hub/npc/email-1/tts"
    )
    assert body["scene"]["npcs"][0]["voice_id"] == "voice-email-1"
    assert (
        body["scene"]["npcs"][1]["tts"]
        == f"/story/scene/{body['session_id']}/scene-loc-1-hub/npc/email-2/tts"
    )
    assert body["scene"]["npcs"][1]["voice_id"] == "voice-email-2"
    assert body["done"] is False

    session_id = body["session_id"]
    first_advance = client.post(
        f"/story/scene/{session_id}/advance",
        json={"npc_id": "email-1", "choice_slug": "go-next"},
    )
    assert first_advance.status_code == 200
    first_advance_json = first_advance.json()
    assert first_advance_json["done"] is False
    assert len(first_advance_json["scene"]["npcs"]) == 1
    assert first_advance_json["trace"][0]["npc_id"] == "email-1"
    assert first_advance_json["trace"][0]["from_location_id"] == "hub"
    assert first_advance_json["trace"][0]["to_location_id"] == "hub"

    second_advance = client.post(
        f"/story/scene/{session_id}/advance",
        json={"npc_id": "email-2", "choice_slug": "reply_now"},
    )
    assert second_advance.status_code == 200
    second_advance_json = second_advance.json()
    assert second_advance_json["done"] is True
    assert second_advance_json["scene"]["is_terminal"] is True
    assert second_advance_json["scene"]["npcs"] == []


def test_story_start_builds_one_hub_npc_per_email_even_with_single_planner_location(
    monkeypatch,
):
    monkeypatch.setenv("STORY_WORLD_HUB_MODE", "true")
    app = FastAPI()
    app.include_router(story_router)

    inbox = [
        {
            "id": "email-1",
            "sender": "manager@company.com",
            "subject": "Need status update by EOD",
            "snippet": "Send update.",
        },
        {
            "id": "email-2",
            "sender": "client@startup.io",
            "subject": "Follow-up on proposal",
            "snippet": "Need timeline.",
        },
        {
            "id": "email-3",
            "sender": "ops@company.com",
            "subject": "Approve payment",
            "snippet": "Need same-day approval.",
        },
    ]

    single_hub_scene = Scene.model_validate(
        {
            "scene_id": "planner-hub",
            "npc_id": "email-1",
            "npc_name": "Manager Steve",
            "dialogue": "Old planner text.",
            "choices": [
                {"slug": "go-next", "label": "Go next", "intent": "agree_immediately"}
            ],
            "is_terminal": False,
            "related_email_ids": ["email-1", "email-2", "email-3"],
            "npcs": [
                {
                    "id": "email-1",
                    "name": "Manager Steve",
                    "email_id": "email-1",
                    "position": {"x": 0, "y": 0, "z": 0},
                    "opening_line": "Old planner text.",
                    "choices": [
                        {
                            "slug": "go-next",
                            "label": "Go next",
                            "intent": "agree_immediately",
                        }
                    ],
                    "related_email_ids": ["email-1"],
                }
            ],
        }
    )
    world_plan = WorldPlan(
        world_id="world-hub",
        entry_location_id="hub",
        locations=[
            WorldLocation(
                id="hub",
                scene=single_hub_scene,
                bounds={"minX": -14, "maxX": 14, "minZ": -14, "maxZ": 14},
            ),
        ],
        transitions={"hub": {}},
    )

    monkeypatch.setattr(
        "routes.story.build_world_plan",
        lambda emails, user_id, max_locations=5, run_seed=None: WorldPlanBuild(
            plan=world_plan,
            source="test",
            run_seed=run_seed or 0,
        ),
    )
    monkeypatch.setattr(
        "routes.story.ensure_scene_entry",
        lambda session_id, scene_id: SimpleNamespace(voice_id="voice-1"),
    )
    monkeypatch.setattr(
        "routes.story.ensure_speaker_entry",
        lambda session_id, scene_id, voice_key: SimpleNamespace(
            voice_id=f"voice-{voice_key}"
        ),
    )
    monkeypatch.setattr(
        "routes.story.generate_and_cache_scene_tts", lambda *args, **kwargs: None
    )
    monkeypatch.setattr("routes.story.SESSIONS", {})

    client = TestClient(app)
    start = client.post(
        "/story/scene/start", json={"user_id": "demo-user", "inbox_override": inbox}
    )
    assert start.status_code == 200
    body = start.json()
    assert len(body["scene"]["npcs"]) == 3
    assert [npc["email_id"] for npc in body["scene"]["npcs"]] == [
        "email-1",
        "email-2",
        "email-3",
    ]


def test_story_start_uses_sender_derived_hub_npc_names(monkeypatch):
    monkeypatch.setenv("STORY_WORLD_HUB_MODE", "true")
    app = FastAPI()
    app.include_router(story_router)

    inbox = [
        {
            "id": "email-1",
            "sender": "candidate1@example.com",
            "subject": "Frontend application",
            "snippet": "React engineer.",
        },
        {
            "id": "email-2",
            "sender": "candidate2@example.com",
            "subject": "Frontend application",
            "snippet": "Vue engineer.",
        },
        {
            "id": "email-3",
            "sender": "candidate3@example.com",
            "subject": "Frontend application",
            "snippet": "Typescript engineer.",
        },
        {
            "id": "email-4",
            "sender": "candidate4@example.com",
            "subject": "Frontend application",
            "snippet": "Design systems.",
        },
        {
            "id": "email-5",
            "sender": "candidate5@example.com",
            "subject": "Frontend application",
            "snippet": "Strong CSS.",
        },
    ]

    single_hub_scene = Scene.model_validate(
        {
            "scene_id": "planner-hub",
            "npc_id": "email-1",
            "npc_name": "Planner Name",
            "dialogue": "Planner dialogue.",
            "choices": [
                {
                    "slug": "reply_now",
                    "label": "Reply now",
                    "intent": "agree_immediately",
                }
            ],
            "is_terminal": False,
            "related_email_ids": [
                "email-1",
                "email-2",
                "email-3",
                "email-4",
                "email-5",
            ],
        }
    )
    world_plan = WorldPlan(
        world_id="world-hub",
        entry_location_id="hub",
        locations=[
            WorldLocation(
                id="hub",
                scene=single_hub_scene,
                bounds={"minX": -14, "maxX": 14, "minZ": -14, "maxZ": 14},
            ),
        ],
        transitions={"hub": {}},
    )

    monkeypatch.setattr(
        "routes.story.build_world_plan",
        lambda emails, user_id, max_locations=5, run_seed=None: WorldPlanBuild(
            plan=world_plan,
            source="test",
            run_seed=run_seed or 0,
        ),
    )
    monkeypatch.setattr(
        "routes.story.ensure_scene_entry",
        lambda session_id, scene_id: SimpleNamespace(voice_id="voice-1"),
    )
    monkeypatch.setattr(
        "routes.story.ensure_speaker_entry",
        lambda session_id, scene_id, voice_key: SimpleNamespace(
            voice_id=f"voice-{voice_key}"
        ),
    )
    monkeypatch.setattr(
        "routes.story.generate_and_cache_scene_tts", lambda *args, **kwargs: None
    )
    monkeypatch.setattr("routes.story.SESSIONS", {})

    client = TestClient(app)
    start = client.post(
        "/story/scene/start", json={"user_id": "demo-user", "inbox_override": inbox}
    )
    assert start.status_code == 200
    body = start.json()
    assert [npc["name"] for npc in body["scene"]["npcs"]] == [
        "Candidate1",
        "Candidate2",
        "Candidate3",
        "Candidate4",
        "Candidate5",
    ]
    assert body["scene"]["dialogue"].startswith("Hi, I'm Candidate1.")


def test_story_start_preserves_planner_npc_identity_when_explicit(monkeypatch):
    monkeypatch.setenv("STORY_WORLD_HUB_MODE", "true")
    app = FastAPI()
    app.include_router(story_router)

    inbox = [
        {
            "id": "email-1",
            "sender": "candidate1@example.com",
            "subject": "Frontend application",
            "snippet": "React engineer.",
        },
        {
            "id": "email-2",
            "sender": "candidate2@example.com",
            "subject": "Frontend application",
            "snippet": "Vue engineer.",
        },
    ]

    planner_scene = Scene.model_validate(
        {
            "scene_id": "planner-hub",
            "npc_id": "email-1",
            "npc_name": "Alya",
            "dialogue": "I need your review before noon.",
            "choices": [
                {
                    "slug": "reply_now",
                    "label": "Reply now",
                    "intent": "agree_immediately",
                }
            ],
            "is_terminal": False,
            "related_email_ids": ["email-1", "email-2"],
            "npcs": [
                {
                    "id": "email-1",
                    "name": "Alya",
                    "email_id": "email-1",
                    "position": {"x": -4, "y": 0, "z": 0},
                    "opening_line": "I need your review before noon.",
                    "choices": [
                        {
                            "slug": "reply_now",
                            "label": "Reply now",
                            "intent": "agree_immediately",
                        }
                    ],
                    "related_email_ids": ["email-1"],
                },
                {
                    "id": "email-2",
                    "name": "Bruno",
                    "email_id": "email-2",
                    "position": {"x": 4, "y": 0, "z": 0},
                    "opening_line": "I need pricing confirmation today.",
                    "choices": [
                        {
                            "slug": "reply_now",
                            "label": "Reply now",
                            "intent": "agree_immediately",
                        }
                    ],
                    "related_email_ids": ["email-2"],
                },
            ],
        }
    )
    world_plan = WorldPlan(
        world_id="world-hub",
        entry_location_id="hub",
        locations=[
            WorldLocation(
                id="hub",
                scene=planner_scene,
                bounds={"minX": -14, "maxX": 14, "minZ": -14, "maxZ": 14},
            ),
        ],
        transitions={"hub": {}},
    )

    monkeypatch.setattr(
        "routes.story.build_world_plan",
        lambda emails, user_id, max_locations=5, run_seed=None: WorldPlanBuild(
            plan=world_plan,
            source="test",
            run_seed=run_seed or 0,
        ),
    )
    monkeypatch.setattr(
        "routes.story.ensure_scene_entry",
        lambda session_id, scene_id: SimpleNamespace(voice_id="voice-1"),
    )
    monkeypatch.setattr(
        "routes.story.ensure_speaker_entry",
        lambda session_id, scene_id, voice_key: SimpleNamespace(
            voice_id=f"voice-{voice_key}"
        ),
    )
    monkeypatch.setattr(
        "routes.story.generate_and_cache_scene_tts", lambda *args, **kwargs: None
    )
    monkeypatch.setattr("routes.story.SESSIONS", {})

    client = TestClient(app)
    start = client.post(
        "/story/scene/start", json={"user_id": "demo-user", "inbox_override": inbox}
    )
    assert start.status_code == 200
    body = start.json()
    assert [npc["name"] for npc in body["scene"]["npcs"]] == ["Alya", "Bruno"]
    assert body["scene"]["dialogue"] == "I need your review before noon."


def test_story_start_fills_hub_choices_from_tree(monkeypatch):
    monkeypatch.setenv("STORY_WORLD_HUB_MODE", "true")
    app = FastAPI()
    app.include_router(story_router)

    inbox = [
        {
            "id": "email-1",
            "sender": "manager@company.com",
            "subject": "Status update",
            "snippet": "Need this before noon.",
        },
        {
            "id": "email-2",
            "sender": "client@startup.io",
            "subject": "Pricing confirmation",
            "snippet": "Can we confirm by today?",
        },
    ]

    planner_scene = Scene.model_validate(
        {
            "scene_id": "planner-hub",
            "npc_id": "email-1",
            "npc_name": "Planner Name",
            "dialogue": "Planner dialogue.",
            "choices": [],
            "is_terminal": False,
            "related_email_ids": ["email-1", "email-2"],
            "npcs": [],
        }
    )
    world_plan = WorldPlan(
        world_id="world-hub",
        entry_location_id="hub",
        locations=[
            WorldLocation(
                id="hub",
                scene=planner_scene,
                bounds={"minX": -14, "maxX": 14, "minZ": -14, "maxZ": 14},
            ),
        ],
        transitions={"hub": {}},
    )

    def fake_build_scene(emails, trace, max_scenes=3):
        assert len(emails) == 1
        assert trace == []
        email = emails[0]
        return Scene.model_validate(
            {
                "scene_id": f"tree-{email.id}",
                "npc_id": email.id,
                "npc_name": "Tree NPC",
                "dialogue": f"I need your response for {email.subject}.",
                "choices": [
                    {
                        "slug": f"{email.id}-direct",
                        "label": "Answer directly",
                        "intent": "direct_response",
                    },
                    {
                        "slug": f"{email.id}-delay",
                        "label": "Ask for time",
                        "intent": "ask_for_more_time",
                    },
                    {
                        "slug": f"{email.id}-alt",
                        "label": "Offer alternative",
                        "intent": "offer_alternative",
                    },
                ],
                "is_terminal": False,
                "related_email_ids": [email.id],
            }
        )

    monkeypatch.setattr(
        "routes.story.build_world_plan",
        lambda emails, user_id, max_locations=5, run_seed=None: WorldPlanBuild(
            plan=world_plan,
            source="test",
            run_seed=run_seed or 0,
        ),
    )
    monkeypatch.setattr("routes.story.build_scene", fake_build_scene)
    monkeypatch.setattr(
        "routes.story.ensure_scene_entry",
        lambda session_id, scene_id: SimpleNamespace(voice_id="voice-1"),
    )
    monkeypatch.setattr(
        "routes.story.ensure_speaker_entry",
        lambda session_id, scene_id, voice_key: SimpleNamespace(
            voice_id=f"voice-{voice_key}"
        ),
    )
    monkeypatch.setattr(
        "routes.story.generate_and_cache_scene_tts", lambda *args, **kwargs: None
    )
    monkeypatch.setattr("routes.story.SESSIONS", {})

    client = TestClient(app)
    start = client.post(
        "/story/scene/start", json={"user_id": "demo-user", "inbox_override": inbox}
    )
    assert start.status_code == 200
    body = start.json()

    first_npc_choices = body["scene"]["npcs"][0]["choices"]
    second_npc_choices = body["scene"]["npcs"][1]["choices"]

    assert first_npc_choices[0]["slug"] == "email-1-direct"
    assert second_npc_choices[0]["slug"] == "email-2-direct"
    assert body["scene"]["choices"][0]["slug"] == "email-1-direct"


def test_story_start_repairs_non_terminal_scene_without_choices(monkeypatch):
    monkeypatch.setenv("STORY_WORLD_HUB_MODE", "true")
    app = FastAPI()
    app.include_router(story_router)

    inbox = [
        {
            "id": "email-1",
            "sender": "manager@company.com",
            "subject": "Need status update by EOD",
            "snippet": "Send update.",
        },
        {
            "id": "email-2",
            "sender": "client@startup.io",
            "subject": "Follow-up on proposal",
            "snippet": "Need timeline.",
        },
    ]

    broken_scene = Scene.model_validate(
        {
            "scene_id": "scene-broken",
            "npc_id": "email-1",
            "npc_name": "Manager Steve",
            "dialogue": "Status request is pending and needs a response.",
            "choices": [],
            "is_terminal": False,
            "related_email_ids": ["email-1"],
            "npcs": [],
        }
    )
    terminal_scene = Scene.model_validate(
        {
            "scene_id": "scene-terminal",
            "npc_id": "email-2",
            "npc_name": "Client Builder",
            "dialogue": "Route complete.",
            "choices": [],
            "is_terminal": True,
            "related_email_ids": ["email-2"],
        }
    )
    world_plan = WorldPlan(
        world_id="world-broken",
        entry_location_id="loc-1",
        locations=[
            WorldLocation(
                id="loc-1",
                scene=broken_scene,
                bounds={"minX": -14, "maxX": 14, "minZ": -14, "maxZ": 14},
            ),
            WorldLocation(
                id="loc-2",
                scene=terminal_scene,
                bounds={"minX": -14, "maxX": 14, "minZ": -14, "maxZ": 14},
            ),
        ],
        transitions={"loc-1": {"reply_now": "loc-2"}, "loc-2": {}},
    )

    monkeypatch.setattr(
        "routes.story.build_world_plan",
        lambda emails, user_id, max_locations=5, run_seed=None: WorldPlanBuild(
            plan=world_plan,
            source="test",
            run_seed=run_seed or 0,
        ),
    )
    monkeypatch.setattr(
        "routes.story.ensure_scene_entry",
        lambda session_id, scene_id: SimpleNamespace(voice_id="voice-1"),
    )
    monkeypatch.setattr(
        "routes.story.ensure_speaker_entry",
        lambda session_id, scene_id, voice_key: SimpleNamespace(
            voice_id=f"voice-{voice_key}"
        ),
    )
    monkeypatch.setattr(
        "routes.story.generate_and_cache_scene_tts", lambda *args, **kwargs: None
    )
    monkeypatch.setattr("routes.story.SESSIONS", {})

    client = TestClient(app)
    start = client.post(
        "/story/scene/start", json={"user_id": "demo-user", "inbox_override": inbox}
    )
    assert start.status_code == 200
    body = start.json()
    assert body["scene"]["is_terminal"] is False
    assert len(body["scene"]["choices"]) == 3
    assert body["scene"]["choices"][0]["slug"] == "reply_now"
    assert body["scene"]["npcs"]
    assert body["scene"]["npcs"][0]["choices"][0]["slug"] == "reply_now"


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
            status="failed",
            voice_id="voice-3",
            audio_bytes=None,
            error="provider timeout",
        ),
    )
    client = TestClient(app)
    res = client.get(f"/story/scene/{session_id}/{scene_id}/tts")
    assert res.status_code == 502
    assert "provider timeout" in res.json()["detail"]


def test_npc_tts_stream_generates_audio_for_selected_npc(monkeypatch):
    app = FastAPI()
    app.include_router(story_router)
    session_id = "session-4"
    scene_id = "scene-hub"
    npc_id = "email-2"
    target_cache_id = f"{scene_id}::npc::{npc_id}"
    calls: list[tuple[str, str, str, str | None]] = []
    state = {"ready": False}
    monkeypatch.setattr(
        "routes.story.SESSIONS",
        {
            session_id: StorySession(
                emails=[],
                current_scene=Scene.model_validate(
                    {
                        "scene_id": scene_id,
                        "npc_id": "email-1",
                        "npc_name": "Alberto",
                        "dialogue": "Primary dialogue.",
                        "choices": [],
                        "is_terminal": False,
                        "related_email_ids": ["email-1", "email-2"],
                        "npcs": [
                            {
                                "id": "email-1",
                                "name": "Alberto",
                                "email_id": "email-1",
                                "position": {"x": 0, "y": 0, "z": 0},
                                "opening_line": "Primary dialogue.",
                                "choices": [],
                                "related_email_ids": ["email-1"],
                            },
                            {
                                "id": "email-2",
                                "name": "Paul Ruiz",
                                "email_id": "email-2",
                                "position": {"x": 1, "y": 0, "z": 0},
                                "opening_line": "This is Paul speaking, not Alberto.",
                                "choices": [],
                                "related_email_ids": ["email-2"],
                            },
                        ],
                    }
                ),
            )
        },
    )

    def fake_get_scene_entry(session_id, scene_id):
        if scene_id == target_cache_id and state["ready"]:
            return SceneTTSCacheEntry(
                status="ready",
                voice_id="voice-email-2",
                audio_bytes=b"ID3npc",
                error=None,
            )
        return None

    def fake_generate(session_id, scene_id, text, voice_key=None):
        calls.append((session_id, scene_id, text, voice_key))
        state["ready"] = True

    monkeypatch.setattr("routes.story.get_scene_entry", fake_get_scene_entry)
    monkeypatch.setattr("routes.story.generate_and_cache_scene_tts", fake_generate)

    client = TestClient(app)
    res = client.get(f"/story/scene/{session_id}/{scene_id}/npc/{npc_id}/tts")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("audio/mpeg")
    assert res.content == b"ID3npc"
    assert calls == [
        (
            session_id,
            target_cache_id,
            "This is Paul speaking, not Alberto.",
            "email-2",
        )
    ]
