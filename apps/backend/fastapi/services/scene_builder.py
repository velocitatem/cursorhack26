from __future__ import annotations

import json
import logging
import os
from typing import Any

import requests

from models.story import EmailDraft, EmailItem, Scene, TraceStep

log = logging.getLogger(__name__)

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

SCENE_JSON_SCHEMA: dict[str, Any] = {
    "name": "scene_schema",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "scene_id": {"type": "string"},
            "npc_id": {"type": "string"},
            "npc_name": {"type": "string"},
            "dialogue": {"type": "string"},
            "choices": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "slug": {"type": "string"},
                        "label": {"type": "string"},
                        "intent": {"type": "string"},
                    },
                    "required": ["slug", "label", "intent"],
                },
            },
            "is_terminal": {"type": "boolean"},
            "related_email_ids": {"type": "array", "items": {"type": "string"}},
        },
        "required": [
            "scene_id",
            "npc_id",
            "npc_name",
            "dialogue",
            "choices",
            "is_terminal",
            "related_email_ids",
        ],
    },
}

RESOLVE_JSON_SCHEMA: dict[str, Any] = {
    "name": "resolve_schema",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "drafts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "email_id": {"type": "string"},
                        "to": {"type": "string"},
                        "subject": {"type": "string"},
                        "body": {"type": "string"},
                    },
                    "required": ["email_id", "to", "subject", "body"],
                },
            }
        },
        "required": ["drafts"],
    },
}

# Instructs the LLM to cast each email sender as a Minecraft NPC and tag
# every choice with a concrete reply intent so resolve_emails can use it.
SCENE_SYSTEM_PROMPT = """You are a game master turning a user's email inbox into a Minecraft office-RPG.

Rules:
- Each NPC *is* one of the email senders. npc_id must equal the email id it covers.
  npc_name should be a fun Minecraft/work re-skin of the sender (e.g. "Manager Steve",
  "Client Builder", "Ops Villager").
- Dialogue must stay clear and readable:
  1) First sentence must be plain context in modern language (no roleplay terms), including
     what the sender wants and by when if timing exists.
  2) Second sentence can add light in-world flavor.
  Do not use archaic or theatrical wording like "hail, traveler, quest, sundown's last light".
- Always preserve concrete context from the email (request, urgency, timeline, pricing, etc.).
- related_email_ids must list every email id this scene covers.
- Each choice must include an `intent` field: a short snake_case keyword that captures how
  the player would reply to the real email (e.g. "agree_immediately", "polite_decline",
  "ask_for_more_time", "deflect_to_colleague", "enthusiastic_yes", "rude_dismissal").
  The label should be direct and action-first (e.g. "Send update now", "Ask for more time").
- Avoid repetitive wording across scenes; vary phrasing and sentence openings.
- One choice per scene should always be a wildcard / comedic option.
- If constraints.should_end_now is true, produce a terminal scene wrapping up the story.
  Terminal scenes have empty choices and is_terminal=true.
- Keep dialogue to exactly 2 sentences. Keep choice labels under 6 words.
"""

RESOLVE_SYSTEM_PROMPT = """You are an email assistant. Given a list of original emails and the
choices a user made while playing a Minecraft RPG (each choice has a `choice_intent` that
captures the user's intended reply tone/action), write a professional email reply for every
email in the inbox.

Map each trace step's `related_email_ids` + `choice_intent` to the correct email and compose a
fitting reply. If multiple trace steps cover the same email, combine the intents.
Use `user_context` and `email_context_by_id` as factual constraints whenever present, especially
for concrete numbers like timeline, pricing, discounts, budget caps, and delivery windows.
Never invent hard numbers if context is missing; keep those parts high-level instead.

Return one draft per email. `subject` should be "Re: <original subject>".
Keep replies concise (2-4 sentences). Match the intent faithfully — if intent is
"rude_dismissal" still write a professional but very brief cold reply, not an enthusiastic one.
"""


def _openai_post(api_key: str, body: dict[str, Any]) -> dict[str, Any]:
    response = requests.post(
        OPENAI_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=body,
        timeout=60,
    )
    if response.status_code >= 400:
        log.error("openai_http_error status=%s body_preview=%s", response.status_code, response.text[:500])
        raise RuntimeError(f"OpenAI API error ({response.status_code}): {response.text}")
    return response.json()


def _build_scene_prompt(emails: list[EmailItem], trace: list[TraceStep], max_scenes: int) -> str:
    should_end = len(trace) >= max_scenes - 1
    return json.dumps(
        {
            "emails": [e.model_dump() for e in emails],
            "trace": [t.model_dump() for t in trace],
            "constraints": {
                "max_scenes": max_scenes,
                "current_depth": len(trace),
                "should_end_now": should_end,
                "choice_count": 3 if not should_end else 0,
            },
        },
        ensure_ascii=True,
    )


def _parse_scene(payload: dict[str, Any]) -> Scene:
    if payload.get("is_terminal"):
        payload["choices"] = []
    return Scene.model_validate(payload)


def build_scene(
    emails: list[EmailItem],
    trace: list[TraceStep],
    max_scenes: int = 3,
) -> Scene:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    data = _openai_post(api_key, {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": SCENE_SYSTEM_PROMPT},
            {"role": "user", "content": _build_scene_prompt(emails, trace, max_scenes)},
        ],
        "response_format": {"type": "json_schema", "json_schema": SCENE_JSON_SCHEMA},
        "temperature": 0.6,
    })
    scene = _parse_scene(json.loads(data["choices"][0]["message"]["content"]))
    log.info(
        "openai_scene_ok scene_id=%s terminal=%s choices=%s",
        scene.scene_id, scene.is_terminal, len(scene.choices),
    )
    return scene


def resolve_emails(
    emails: list[EmailItem],
    trace: list[TraceStep],
    user_context: str = "",
    email_context_by_id: dict[str, str] | None = None,
) -> list[EmailDraft]:
    """Turn completed story trace + original emails into actual reply drafts."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    email_context_by_id = email_context_by_id or {}
    payload = json.dumps(
        {
            "emails": [e.model_dump() for e in emails],
            "trace": [t.model_dump() for t in trace],
            "user_context": user_context,
            "email_context_by_id": email_context_by_id,
        },
        ensure_ascii=True,
    )
    data = _openai_post(api_key, {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": RESOLVE_SYSTEM_PROMPT},
            {"role": "user", "content": payload},
        ],
        "response_format": {"type": "json_schema", "json_schema": RESOLVE_JSON_SCHEMA},
        "temperature": 0.4,
    })
    result = json.loads(data["choices"][0]["message"]["content"])
    drafts = [EmailDraft.model_validate(d) for d in result["drafts"]]
    log.info("resolve_emails_ok draft_count=%s", len(drafts))
    return drafts
