from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any

import requests

from models.story import EmailDraft, EmailItem, Scene, TraceStep
from services.cache import get_json, openai_cache_ttl_seconds, set_json

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
- The NPC must speak as a person in-world, not as an email summary. Write the dialogue as if the
  sender is standing in front of the player introducing themselves and explaining what they need.
  Good pattern: "Hi, I'm Paul. I'm applying for the front-end engineering role and my strongest
  work is in React..." or "I'm Maya from Ops, and I need your approval on this payment today."
- For application or recruiting emails, have the NPC introduce themselves as the candidate and
  briefly mention 2-4 concrete resume facts if present, such as school, GPA/grade, strongest
  project, internship impact, or technical stack.
- Example target style: "Hi, I'm Daniel. I'm applying for the front-end developer role. I studied
  at X, graduated with Y, and my standout project was Z."
- Dialogue must stay clear and readable:
  1) First sentence must be a first-person introduction that identifies who they are and why they
     are talking to the player.
  2) Second sentence must explain the concrete ask, urgency, or constraint in plain modern language.
  Do not use archaic or theatrical wording like "hail, traveler, quest, sundown's last light".
- Never describe the message as "this email", "this thread", "my subject line", "my inbox", or
  anything else that exposes the raw email format. Convert the email contents into spoken intent.
- Always preserve concrete context from the email (request, urgency, timeline, pricing, etc.).
- related_email_ids must list every email id this scene covers.
- Each choice must include an `intent` field: a short snake_case keyword that captures how
  the player would reply to the real email (e.g. "agree_immediately", "polite_decline",
  "ask_for_more_time", "deflect_to_colleague", "enthusiastic_yes", "rude_dismissal").
  The label should be direct and action-first (e.g. "Send update now", "Ask for more time").
- Do not generate a generic "Ask for context" option. Assume the player already sees the full
  context from the inbox and NPC dialogue. Choices should be actual reply strategies, not
  requests to restate information.
- Avoid repetitive wording across scenes; vary phrasing and sentence openings.
- One choice per scene should always be a wildcard / comedic option.
- If constraints.should_end_now is true, produce a terminal scene wrapping up the story.
  Terminal scenes have empty choices and is_terminal=true.
- Keep dialogue to 2-3 short sentences. Keep choice labels under 6 words.
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


def _cache_enabled() -> bool:
    return os.getenv("OPENAI_CACHE_ENABLED", "true").lower() in {"1", "true", "yes", "on"}


def _cache_key(prefix: str, payload: dict[str, Any]) -> str:
    serialized = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return f"openai:{prefix}:{hashlib.sha256(serialized.encode('utf-8')).hexdigest()}"


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
    body = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": SCENE_SYSTEM_PROMPT},
            {"role": "user", "content": _build_scene_prompt(emails, trace, max_scenes)},
        ],
        "response_format": {"type": "json_schema", "json_schema": SCENE_JSON_SCHEMA},
        "temperature": 0.6,
    }
    cache_key = _cache_key(prefix="scene", payload=body)
    if _cache_enabled():
        cached_scene = get_json(cache_key)
        if isinstance(cached_scene, dict):
            scene = Scene.model_validate(cached_scene)
            log.info("openai_scene_cache_hit scene_id=%s", scene.scene_id)
            return scene
    data = _openai_post(api_key, body)
    scene = _parse_scene(json.loads(data["choices"][0]["message"]["content"]))
    if _cache_enabled():
        set_json(cache_key, scene.model_dump(), ttl_seconds=openai_cache_ttl_seconds())
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
    payload_obj = {
        "emails": [e.model_dump() for e in emails],
        "trace": [t.model_dump() for t in trace],
        "user_context": user_context,
        "email_context_by_id": email_context_by_id,
    }
    payload = json.dumps(
        payload_obj,
        ensure_ascii=True,
    )
    body = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": RESOLVE_SYSTEM_PROMPT},
            {"role": "user", "content": payload},
        ],
        "response_format": {"type": "json_schema", "json_schema": RESOLVE_JSON_SCHEMA},
        "temperature": 0.4,
    }
    cache_key = _cache_key(prefix="resolve", payload=body)
    if _cache_enabled():
        cached_result = get_json(cache_key)
        if isinstance(cached_result, dict) and isinstance(cached_result.get("drafts"), list):
            drafts = [EmailDraft.model_validate(d) for d in cached_result["drafts"]]
            log.info("resolve_emails_cache_hit draft_count=%s", len(drafts))
            return drafts
    data = _openai_post(api_key, body)
    result = json.loads(data["choices"][0]["message"]["content"])
    if _cache_enabled():
        set_json(cache_key, result, ttl_seconds=openai_cache_ttl_seconds())
    resolved_by_email_id: dict[str, EmailDraft] = {}
    for raw_draft in result.get("drafts", []):
        try:
            draft = EmailDraft.model_validate(raw_draft)
        except Exception:
            continue
        if draft.email_id and draft.email_id not in resolved_by_email_id:
            resolved_by_email_id[draft.email_id] = draft
    fallback_note = (
        "Thanks for your email. I received this and will follow up shortly with the right next steps."
    )
    complete_drafts = [
        resolved_by_email_id.get(email.id)
        or EmailDraft(
            email_id=email.id,
            to=email.sender,
            subject=f"Re: {email.subject}",
            body=email_context_by_id.get(email.id) or fallback_note,
        )
        for email in emails
    ]
    log.info(
        "resolve_emails_ok draft_count=%s requested_emails=%s missing_filled=%s",
        len(complete_drafts),
        len(emails),
        sum(1 for email in emails if email.id not in resolved_by_email_id),
    )
    return complete_drafts
