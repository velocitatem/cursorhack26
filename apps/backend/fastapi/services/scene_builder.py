from __future__ import annotations

import json
import logging
import os
from typing import Any

import requests

from models.story import EmailItem, Scene, TraceStep

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
                    },
                    "required": ["slug", "label"],
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


def _build_prompt(
    emails: list[EmailItem],
    trace: list[TraceStep],
    max_scenes: int,
) -> str:
    trace_payload = [step.model_dump() for step in trace]
    email_payload = [email.model_dump() for email in emails]
    should_end = len(trace) >= max_scenes - 1
    constraints = {
        "max_scenes": max_scenes,
        "current_depth": len(trace),
        "should_end_now": should_end,
        "choice_count": 3 if not should_end else 0,
    }
    return json.dumps(
        {"emails": email_payload, "trace": trace_payload, "constraints": constraints},
        ensure_ascii=True,
    )


def _parse_scene(payload: dict[str, Any]) -> Scene:
    choices = payload.get("choices", [])
    if payload.get("is_terminal"):
        choices = []
    payload["choices"] = choices
    return Scene.model_validate(payload)


def build_scene(
    emails: list[EmailItem],
    trace: list[TraceStep],
    max_scenes: int = 3,
) -> Scene:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        log.error("openai_missing_key")
        raise RuntimeError("OPENAI_API_KEY is not set")
    system_prompt = (
        "You write short RPG-style email handling scenes. "
        "Generate exactly one scene as strict JSON. "
        "Keep responses concise for a fast demo. "
        "If constraints.should_end_now is true, return a terminal scene."
    )
    body = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": _build_prompt(emails, trace, max_scenes)},
        ],
        "response_format": {"type": "json_schema", "json_schema": SCENE_JSON_SCHEMA},
        "temperature": 0.7,
    }
    log.debug(
        "openai_request model=%s trace_depth=%s email_count=%s",
        OPENAI_MODEL,
        len(trace),
        len(emails),
    )
    response = requests.post(
        OPENAI_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=body,
        timeout=60,
    )
    if response.status_code >= 400:
        log.error(
            "openai_http_error status=%s body_preview=%s",
            response.status_code,
            response.text[:500],
        )
        raise RuntimeError(f"OpenAI API error ({response.status_code}): {response.text}")
    data = response.json()
    content = data["choices"][0]["message"]["content"]
    parsed = json.loads(content)
    scene = _parse_scene(parsed)
    log.info(
        "openai_scene_ok scene_id=%s terminal=%s choices=%s",
        scene.scene_id,
        scene.is_terminal,
        len(scene.choices),
    )
    return scene
