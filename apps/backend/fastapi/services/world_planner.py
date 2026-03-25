from __future__ import annotations

import hashlib
import json
import logging
import os
import random
from typing import Any
from uuid import uuid4

import requests

from models.story import (
    EmailItem,
    Scene,
    SceneBlock,
    SceneChoice,
    SceneEnvironment,
    SceneLayout,
    SceneNpc,
    SceneVector,
    SceneWorldBounds,
)
from models.world import WorldLocation, WorldPlan
from services.cache import get_json, openai_cache_ttl_seconds, set_json

log = logging.getLogger(__name__)

OPENAI_MODEL = os.getenv("WORLD_PLANNER_MODEL", os.getenv("OPENAI_MODEL", "gpt-4.1-mini"))
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

WORLD_PLAN_SCHEMA: dict[str, Any] = {
    "name": "world_plan_schema",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "world_id": {"type": "string"},
            "entry_location_id": {"type": "string"},
            "locations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "id": {"type": "string"},
                        "scene": {"type": "object"},
                        "bounds": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "minX": {"type": "integer"},
                                "maxX": {"type": "integer"},
                                "minZ": {"type": "integer"},
                                "maxZ": {"type": "integer"},
                            },
                            "required": ["minX", "maxX", "minZ", "maxZ"],
                        },
                    },
                    "required": ["id", "scene", "bounds"],
                },
            },
            "transitions": {
                "type": "object",
                "additionalProperties": {
                    "type": "object",
                    "additionalProperties": {"type": "string"},
                },
            },
        },
        "required": ["world_id", "entry_location_id", "locations", "transitions"],
    },
}

WORLD_SYSTEM_PROMPT = """You plan a compact RPG world for inbox triage.
Return a persistent world graph where each location has one scene.
Requirements:
- Keep location count between 2 and 5.
- Every scene must include environment with spawn and optional layout blocks.
- Every scene must include npcs with explicit positions and dialogue.
- Also keep top-level scene npc_id, npc_name, dialogue, choices aligned to the primary npc.
- choice_transitions maps each choice slug to a valid location id.
- related_email_ids and npc email_id must point to known emails.
- Include one terminal location with empty choices and is_terminal=true.
- Ensure transitions can reach a terminal node in <= 4 hops.
"""

DEFAULT_BOUNDS = SceneWorldBounds(minX=-14, maxX=14, minZ=-14, maxZ=14)


def _cache_key(prefix: str, payload: dict[str, Any]) -> str:
    serialized = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return f"openai:{prefix}:{hashlib.sha256(serialized.encode('utf-8')).hexdigest()}"


def _cache_enabled() -> bool:
    return os.getenv("OPENAI_CACHE_ENABLED", "true").lower() in {"1", "true", "yes", "on"}


def _openai_post(api_key: str, body: dict[str, Any]) -> dict[str, Any]:
    response = requests.post(
        OPENAI_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=body,
        timeout=90,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"OpenAI API error ({response.status_code}): {response.text}")
    return response.json()


def _simple_layout(seed: int, location_idx: int) -> SceneLayout:
    rng = random.Random(seed + location_idx)
    blocks = [SceneBlock(x=x, y=-1, z=z, type="grass") for x in range(-14, 15) for z in range(-14, 15)]
    for x in range(-3, 4):
        for z in range(-10, 11):
            blocks.append(SceneBlock(x=x, y=-1, z=z, type="plaza"))
    for _ in range(10):
        tx = rng.randint(-12, 12)
        tz = rng.randint(-12, 12)
        blocks.extend(
            [
                SceneBlock(x=tx, y=0, z=tz, type="tree"),
                SceneBlock(x=tx, y=1, z=tz, type="tree"),
                SceneBlock(x=tx, y=2, z=tz, type="tree"),
                SceneBlock(x=tx, y=3, z=tz, type="leaf"),
            ]
        )
    return SceneLayout(seed=seed + location_idx, bounds=DEFAULT_BOUNDS, blocks=blocks)


def _fallback_world_plan(emails: list[EmailItem], run_seed: int | None = None) -> WorldPlan:
    world_id = f"world-{uuid4().hex[:8]}"
    email_seed = sum(ord(char) for email in emails for char in email.id) or 1337
    seed = run_seed if run_seed is not None else email_seed
    base_choices = [
        SceneChoice(slug="reply_now", label="Reply now", intent="agree_immediately"),
        SceneChoice(slug="ask_context", label="Ask for context", intent="ask_for_clarification"),
        SceneChoice(slug="defer", label="Defer politely", intent="ask_for_more_time"),
    ]
    locations: list[WorldLocation] = []
    transitions: dict[str, dict[str, str]] = {}
    for idx, email in enumerate(emails[:3] or emails):
        loc_id = f"loc-{idx + 1}"
        primary_npc = SceneNpc(
            id=email.id,
            name=email.sender.split("@")[0].replace(".", " ").title(),
            email_id=email.id,
            position=SceneVector(x=(idx * 4) - 4, y=0, z=2 if idx % 2 == 0 else -2),
            opening_line=f"{email.subject}. {email.snippet or 'This thread needs your response today.'}",
            choices=base_choices if idx < 2 else [],
            related_email_ids=[email.id],
        )
        scene = Scene(
            scene_id=f"scene-{loc_id}",
            npc_id=primary_npc.id,
            npc_name=primary_npc.name,
            dialogue=primary_npc.opening_line,
            choices=primary_npc.choices,
            is_terminal=idx == min(2, len(emails) - 1),
            related_email_ids=[email.id],
            environment=SceneEnvironment(
                theme="inboxPlaza" if idx % 2 == 0 else "cityBlock",
                spawn=SceneVector(x=0, y=0, z=8),
                layout=_simple_layout(seed=seed, location_idx=idx),
            ),
            npcs=[primary_npc],
            choice_transitions={},
        )
        locations.append(WorldLocation(id=loc_id, scene=scene, bounds=DEFAULT_BOUNDS))
    if not locations:
        terminal = Scene(
            scene_id="scene-terminal",
            npc_id="narrator",
            npc_name="Inbox Narrator",
            dialogue="No emails found. The city is calm today.",
            choices=[],
            is_terminal=True,
            related_email_ids=[],
            environment=SceneEnvironment(theme="inboxPlaza", spawn=SceneVector(x=0, y=0, z=8), layout=_simple_layout(seed, 0)),
            npcs=[],
            choice_transitions={},
        )
        return WorldPlan(world_id=world_id, entry_location_id="loc-1", locations=[WorldLocation(id="loc-1", scene=terminal, bounds=DEFAULT_BOUNDS)], transitions={})
    for idx, location in enumerate(locations):
        if location.scene.is_terminal:
            transitions[location.id] = {}
            location.scene.choice_transitions = {}
            continue
        next_id = locations[min(idx + 1, len(locations) - 1)].id
        location_transitions = {choice.slug: next_id for choice in location.scene.choices}
        transitions[location.id] = location_transitions
        location.scene.choice_transitions = location_transitions
    return WorldPlan(
        world_id=world_id,
        entry_location_id=locations[0].id,
        locations=locations,
        transitions=transitions,
    )


def build_world_plan(
    emails: list[EmailItem],
    user_id: str,
    max_locations: int = 4,
    run_seed: int | None = None,
) -> WorldPlan:
    if not emails:
        return _fallback_world_plan([], run_seed=run_seed)
    payload = {
        "user_id": user_id,
        "max_locations": max(2, min(max_locations, 5)),
        "emails": [email.model_dump() for email in emails],
        "run_seed": run_seed,
    }
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return _fallback_world_plan(emails, run_seed=run_seed)
    body = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": WORLD_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=True)},
        ],
        "response_format": {"type": "json_schema", "json_schema": WORLD_PLAN_SCHEMA},
        "temperature": 0.5,
    }
    cache_key = _cache_key("world-plan", body)
    if _cache_enabled():
        cached = get_json(cache_key)
        if isinstance(cached, dict):
            try:
                return WorldPlan.model_validate(cached)
            except Exception:
                log.warning("world_plan_cache_invalid")
    try:
        raw = _openai_post(api_key, body)
        content = json.loads(raw["choices"][0]["message"]["content"])
        plan = WorldPlan.model_validate(content)
        if _cache_enabled():
            set_json(cache_key, plan.model_dump(mode="json"), ttl_seconds=openai_cache_ttl_seconds())
        return plan
    except Exception:
        log.warning("world_plan_generation_failed_fallback", exc_info=True)
        return _fallback_world_plan(emails, run_seed=run_seed)
