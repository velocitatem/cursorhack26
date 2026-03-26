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
from models.world import WorldLocation, WorldPlan, WorldPlanBuild
from services.cache import get_json, openai_cache_ttl_seconds, set_json

try:
    from alveslib import ask as agent_ask
except Exception:
    agent_ask = None

log = logging.getLogger(__name__)

OPENAI_MODEL = os.getenv(
    "WORLD_PLANNER_MODEL", os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
)
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

_VECTOR3 = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "x": {"type": "number"},
        "y": {"type": "number"},
        "z": {"type": "number"},
    },
    "required": ["x", "y", "z"],
}

_CHOICE = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "slug": {"type": "string"},
        "label": {"type": "string"},
        "intent": {"type": "string"},
    },
    "required": ["slug", "label", "intent"],
}

_NPC = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "id": {"type": "string"},
        "name": {"type": "string"},
        "email_id": {"type": "string"},
        "position": _VECTOR3,
        "opening_line": {"type": "string"},
        "choices": {"type": "array", "items": _CHOICE},
        "related_email_ids": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "id",
        "name",
        "email_id",
        "position",
        "opening_line",
        "choices",
        "related_email_ids",
    ],
}

_SCENE = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "scene_id": {"type": "string"},
        "npc_id": {"type": "string"},
        "npc_name": {"type": "string"},
        "dialogue": {"type": "string"},
        "choices": {"type": "array", "items": _CHOICE},
        "is_terminal": {"type": "boolean"},
        "related_email_ids": {"type": "array", "items": {"type": "string"}},
        "choice_transitions": {
            "type": "object",
            "additionalProperties": {"type": "string"},
        },
        "npcs": {"type": "array", "items": _NPC},
        "environment": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "theme": {"type": "string"},
                "spawn": _VECTOR3,
            },
            "required": ["theme", "spawn"],
        },
    },
    "required": [
        "scene_id",
        "npc_id",
        "npc_name",
        "dialogue",
        "choices",
        "is_terminal",
        "related_email_ids",
        "choice_transitions",
        "npcs",
        "environment",
    ],
}

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
                        "scene": _SCENE,
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
Return one persistent world hub where each selected email becomes one NPC.

Requirements:
- Create exactly 1 location when emails exist.
- Add one NPC per email (up to 5), with explicit positions and dialogue.
- Keep scene-level npc_id/npc_name/dialogue/choices aligned with one unresolved NPC.
- related_email_ids and npc email_id must reference known input email ids.
- Do not merge multiple emails into a single NPC.
- Set is_terminal=false when unresolved email NPCs exist.
- opening_line must be first-person spoken dialogue grounded in the source email facts.
- npc_name must be derived from sender identity; never use fixed team rosters or placeholder names.
- For application/recruiting emails, include 2-4 concrete candidate facts when available.
- NPC choices must be specific to each email's ask; avoid generic fallback options like
  "Reply now", "Send polished reply", or "Defer politely".
- Do not mention raw inbox mechanics like "thread", "subject line", or "inbox".
- Preserve requests, constraints, urgency, and concrete details from the source emails.
"""

DEFAULT_BOUNDS = SceneWorldBounds(minX=-14, maxX=14, minZ=-14, maxZ=14)


def _cache_key(prefix: str, payload: dict[str, Any]) -> str:
    serialized = json.dumps(
        payload, ensure_ascii=True, sort_keys=True, separators=(",", ":")
    )
    return f"openai:{prefix}:{hashlib.sha256(serialized.encode('utf-8')).hexdigest()}"


def _cache_enabled() -> bool:
    return os.getenv("OPENAI_CACHE_ENABLED", "true").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _openai_post(api_key: str, body: dict[str, Any]) -> dict[str, Any]:
    response = requests.post(
        OPENAI_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=body,
        timeout=90,
    )
    if response.status_code >= 400:
        raise RuntimeError(
            f"OpenAI API error ({response.status_code}): {response.text}"
        )
    return response.json()


def _simple_layout(seed: int, location_idx: int) -> SceneLayout:
    rng = random.Random(seed + location_idx)
    blocks: list[SceneBlock] = []
    for x in range(-14, 15):
        for z in range(-14, 15):
            y = -1
            ground = "grass"
            if (x + z + seed + location_idx) % 13 == 0:
                y = 0
            if abs(x) <= 2 or abs(z) <= 2:
                ground = "plaza"
                y = -1
            blocks.append(SceneBlock(x=x, y=y, z=z, type=ground))
            if y > -1:
                blocks.append(SceneBlock(x=x, y=-1, z=z, type="dirt"))
    for _ in range(8):
        tx = rng.randint(-12, 12)
        tz = rng.randint(-12, 12)
        if abs(tx) <= 3 or abs(tz) <= 3:
            continue
        blocks.extend(
            [
                SceneBlock(x=tx, y=0, z=tz, type="tree"),
                SceneBlock(x=tx, y=1, z=tz, type="tree"),
                SceneBlock(x=tx, y=2, z=tz, type="tree"),
                SceneBlock(x=tx, y=3, z=tz, type="leaf"),
            ]
        )
    for _ in range(5):
        bx = rng.choice([-10, -7, 7, 10])
        bz = rng.choice([-10, -7, 7, 10])
        height = rng.randint(2, 5)
        for x in range(bx - 1, bx + 2):
            for z in range(bz - 1, bz + 2):
                for y in range(0, height):
                    blocks.append(
                        SceneBlock(
                            x=x, y=y, z=z, type="wood" if y < height - 1 else "stone"
                        )
                    )
    for lamp_x, lamp_z in [(-6, -6), (-6, 6), (6, -6), (6, 6)]:
        blocks.extend(
            [
                SceneBlock(x=lamp_x, y=0, z=lamp_z, type="wood"),
                SceneBlock(x=lamp_x, y=1, z=lamp_z, type="wood"),
                SceneBlock(x=lamp_x, y=2, z=lamp_z, type="wood"),
                SceneBlock(x=lamp_x, y=3, z=lamp_z, type="glass"),
            ]
        )
    return SceneLayout(seed=seed + location_idx, bounds=DEFAULT_BOUNDS, blocks=blocks)


def _sender_display_name(sender: str) -> str:
    local_part = (sender or "").split("@", 1)[0]
    tokens = [
        part
        for part in local_part.replace(".", " ")
        .replace("_", " ")
        .replace("-", " ")
        .split()
        if part
    ]
    if not tokens:
        return "there"
    return " ".join(token.capitalize() for token in tokens)


def _spoken_request_line(email: EmailItem) -> str:
    speaker_name = _sender_display_name(email.sender)
    subject = (email.subject or "something important").strip().rstrip(".")
    context = (email.snippet or email.body or "I need your response today.").strip()
    context = " ".join(context.split())
    if context and not context.endswith((".", "!", "?")):
        context = f"{context}."
    return f"Hi, I'm {speaker_name}, and I'm reaching out about {subject}. {context}"


def _fallback_world_plan(
    emails: list[EmailItem], run_seed: int | None = None
) -> WorldPlan:
    world_id = f"world-{uuid4().hex[:8]}"
    selected_emails = emails[:5] if emails else []
    email_seed = (
        sum(ord(char) for email in selected_emails for char in email.id) or 1337
    )
    seed = run_seed if run_seed is not None else email_seed
    base_choices = [
        SceneChoice(slug="reply_now", label="Reply now", intent="agree_immediately"),
        SceneChoice(
            slug="send_polished_reply",
            label="Send polished reply",
            intent="confident_response",
        ),
        SceneChoice(slug="defer", label="Defer politely", intent="ask_for_more_time"),
    ]
    positions = [
        SceneVector(x=-7, y=0, z=1),
        SceneVector(x=-3, y=0, z=-4),
        SceneVector(x=1, y=0, z=3),
        SceneVector(x=5, y=0, z=-3),
        SceneVector(x=8, y=0, z=2),
    ]
    if not selected_emails:
        terminal = Scene(
            scene_id="scene-terminal",
            npc_id="narrator",
            npc_name="Inbox Narrator",
            dialogue="No emails found. The city is calm today.",
            choices=[],
            is_terminal=True,
            related_email_ids=[],
            environment=SceneEnvironment(
                theme="inboxPlaza",
                spawn=SceneVector(x=0, y=0, z=8),
                layout=_simple_layout(seed, 0),
            ),
            npcs=[],
            choice_transitions={},
        )
        return WorldPlan(
            world_id=world_id,
            entry_location_id="hub",
            locations=[WorldLocation(id="hub", scene=terminal, bounds=DEFAULT_BOUNDS)],
            transitions={"hub": {}},
        )

    npcs: list[SceneNpc] = []
    for idx, email in enumerate(selected_emails):
        npcs.append(
            SceneNpc(
                id=email.id,
                name=email.sender.split("@")[0].replace(".", " ").title(),
                email_id=email.id,
                position=positions[idx % len(positions)],
                opening_line=_spoken_request_line(email),
                choices=base_choices,
                related_email_ids=[email.id],
            )
        )
    primary_npc = npcs[0]
    scene = Scene(
        scene_id="scene-hub",
        npc_id=primary_npc.id,
        npc_name=primary_npc.name,
        dialogue=primary_npc.opening_line,
        choices=primary_npc.choices,
        is_terminal=False,
        related_email_ids=[email.id for email in selected_emails],
        environment=SceneEnvironment(
            theme="inboxPlaza",
            spawn=SceneVector(x=0, y=0, z=8),
            layout=_simple_layout(seed=seed, location_idx=0),
        ),
        npcs=npcs,
        choice_transitions={},
    )
    return WorldPlan(
        world_id=world_id,
        entry_location_id="hub",
        locations=[WorldLocation(id="hub", scene=scene, bounds=DEFAULT_BOUNDS)],
        transitions={"hub": {}},
    )


def _fix_vector(v: Any) -> dict[str, Any]:
    if not isinstance(v, dict):
        return {"x": 0, "y": 0, "z": 0}
    return {"x": v.get("x", 0), "y": v.get("y", 0), "z": v.get("z", 0)}


def _fix_npc(npc: Any) -> dict[str, Any]:
    if not isinstance(npc, dict):
        return {}
    return {
        "id": npc.get("id") or npc.get("npc_id") or "npc",
        "name": npc.get("name") or npc.get("npc_name") or "NPC",
        "email_id": npc.get("email_id")
        or npc.get("related_email_ids", [""])[0]
        or "email",
        "position": _fix_vector(npc.get("position")),
        "opening_line": npc.get("opening_line") or npc.get("dialogue") or "...",
        "choices": npc.get("choices", []),
        "related_email_ids": npc.get("related_email_ids", []),
    }


def _fix_scene(scene: Any) -> dict[str, Any]:
    if not isinstance(scene, dict):
        return {}
    env = scene.get("environment") or {}
    spawn = _fix_vector(env.get("spawn") or env.get("spawn_position") or {})
    return {
        "scene_id": scene.get("scene_id") or scene.get("id") or "scene",
        "npc_id": scene.get("npc_id") or "npc",
        "npc_name": scene.get("npc_name") or "NPC",
        "dialogue": scene.get("dialogue") or "...",
        "choices": scene.get("choices", []),
        "is_terminal": scene.get("is_terminal", False),
        "related_email_ids": scene.get("related_email_ids", []),
        "choice_transitions": scene.get("choice_transitions", {}),
        "npcs": [_fix_npc(n) for n in scene.get("npcs", [])],
        "environment": {"theme": env.get("theme", "inboxPlaza"), "spawn": spawn},
    }


def _fix_location(loc: Any) -> dict[str, Any]:
    if not isinstance(loc, dict):
        return {}
    loc_id = loc.get("id") or loc.get("location_id") or "loc"
    bounds = loc.get("bounds") or {"minX": -14, "maxX": 14, "minZ": -14, "maxZ": 14}
    return {
        "id": loc_id,
        "scene": _fix_scene(loc.get("scene") or {}),
        "bounds": bounds,
    }


def _normalise_plan(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "world_id": raw.get("world_id") or f"world-{uuid4().hex[:8]}",
        "entry_location_id": raw.get("entry_location_id")
        or raw.get("entry_location")
        or "loc",
        "locations": [_fix_location(loc) for loc in raw.get("locations", [])],
        "transitions": raw.get("transitions", {}),
    }


def _build_with_cloud_agent(payload: dict[str, Any]) -> WorldPlan | None:
    if agent_ask is None:
        return None
    prompt = (
        "Return only JSON matching this exact schema shape:\n"
        '{"world_id": "string", "entry_location_id": "string", '
        '"locations": [{"id": "string", "scene": {"scene_id": "string", "npc_id": "string", '
        '"npc_name": "string", "dialogue": "string", "choices": [{"slug": "string", "label": "string", "intent": "string"}], '
        '"is_terminal": false, "related_email_ids": ["string"], "choice_transitions": {"slug": "location_id"}, '
        '"npcs": [{"id": "string", "name": "string", "email_id": "string", '
        '"position": {"x": 0, "y": 0, "z": 0}, "opening_line": "string", "choices": [], "related_email_ids": []}], '
        '"environment": {"theme": "inboxPlaza", "spawn": {"x": 0, "y": 0, "z": 8}}}, '
        '"bounds": {"minX": -14, "maxX": 14, "minZ": -14, "maxZ": 14}}], '
        '"transitions": {"location_id": {"choice_slug": "next_location_id"}}}\n\n'
        f"Input:\n{json.dumps(payload, ensure_ascii=True)}"
    )
    text = agent_ask(prompt, system=WORLD_SYSTEM_PROMPT, model=OPENAI_MODEL).strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    return WorldPlan.model_validate(_normalise_plan(json.loads(text)))


def build_world_plan(
    emails: list[EmailItem],
    user_id: str,
    max_locations: int = 5,
    run_seed: int | None = None,
) -> WorldPlanBuild:
    effective_seed = (
        run_seed if run_seed is not None else int(uuid4().int % 1_000_000_000)
    )
    if not emails:
        return WorldPlanBuild(
            plan=_fallback_world_plan([], run_seed=effective_seed),
            source="fallback",
            run_seed=effective_seed,
        )
    effective_location_limit = min(max(1, max_locations), min(len(emails), 5))
    payload = {
        "user_id": user_id,
        "max_locations": effective_location_limit,
        "emails": [email.model_dump() for email in emails],
        "run_seed": effective_seed,
    }
    api_key = os.getenv("OPENAI_API_KEY")
    provider = os.getenv("WORLD_PLANNER_PROVIDER", "openai_structured").strip().lower()
    if not api_key:
        return WorldPlanBuild(
            plan=_fallback_world_plan(emails, run_seed=effective_seed),
            source="fallback",
            run_seed=effective_seed,
        )
    body = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": WORLD_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=True)},
        ],
        "response_format": {"type": "json_schema", "json_schema": WORLD_PLAN_SCHEMA},
        "temperature": 0.5,
    }
    cache_key = _cache_key(f"world-plan:{provider}", body)
    if _cache_enabled():
        cached = get_json(cache_key)
        if isinstance(cached, dict):
            try:
                return WorldPlanBuild(
                    plan=WorldPlan.model_validate(cached),
                    source=f"{provider}_cache",
                    run_seed=effective_seed,
                )
            except Exception:
                log.warning("world_plan_cache_invalid")
    if provider == "cloud_agent":
        try:
            plan = _build_with_cloud_agent(payload)
            if plan is not None:
                if _cache_enabled():
                    set_json(
                        cache_key,
                        plan.model_dump(mode="json"),
                        ttl_seconds=openai_cache_ttl_seconds(),
                    )
                return WorldPlanBuild(
                    plan=plan, source="cloud_agent", run_seed=effective_seed
                )
        except Exception:
            log.warning("world_plan_cloud_agent_failed_fallback", exc_info=True)
    try:
        raw = _openai_post(api_key, body)
        content = json.loads(raw["choices"][0]["message"]["content"])
        plan = WorldPlan.model_validate(content)
        if _cache_enabled():
            set_json(
                cache_key,
                plan.model_dump(mode="json"),
                ttl_seconds=openai_cache_ttl_seconds(),
            )
        return WorldPlanBuild(
            plan=plan, source="openai_structured", run_seed=effective_seed
        )
    except Exception:
        log.warning("world_plan_generation_failed_fallback", exc_info=True)
        return WorldPlanBuild(
            plan=_fallback_world_plan(emails, run_seed=effective_seed),
            source="fallback",
            run_seed=effective_seed,
        )
