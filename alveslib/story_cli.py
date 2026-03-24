from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Any

import requests


def _print_scene(scene: dict[str, Any]) -> None:
    print("\n" + "=" * 72)
    print(f"Scene: {scene.get('scene_id')} | NPC: {scene.get('npc_name')} ({scene.get('npc_id')})")
    related = scene.get("related_email_ids") or []
    if related:
        print(f"Related emails: {', '.join(related)}")
    print("-" * 72)
    print(scene.get("dialogue", ""))
    print("-" * 72)
    for idx, choice in enumerate(scene.get("choices", []), start=1):
        label = choice.get("label", "")
        slug = choice.get("slug", "")
        intent = choice.get("intent", "")
        print(f"{idx}. {label} [{slug}] intent={intent}")
    print("=" * 72)


def _request_json(
    method: str,
    url: str,
    json_payload: dict[str, Any] | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    response = requests.request(method=method, url=url, json=json_payload, timeout=timeout)
    if response.status_code >= 400:
        try:
            detail = response.json()
        except ValueError:
            detail = response.text
        raise RuntimeError(f"{method} {url} failed ({response.status_code}): {detail}")
    return response.json()


def _pick_choice(scene: dict[str, Any], auto: str) -> dict[str, Any]:
    choices = scene.get("choices") or []
    if not choices:
        raise RuntimeError("No choices available for non-terminal scene.")
    if auto == "first":
        return choices[0]
    if auto == "random":
        return random.choice(choices)
    while True:
        raw = input("Pick choice number (or slug): ").strip()
        if not raw:
            continue
        if raw.isdigit():
            idx = int(raw)
            if 1 <= idx <= len(choices):
                return choices[idx - 1]
        for choice in choices:
            if choice["slug"] == raw:
                return choice
        print("Invalid input, try again.")


def _load_inbox(path: str | None) -> list[dict[str, Any]] | None:
    if path is None:
        return None
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise RuntimeError("inbox JSON must be a list of email objects.")
    return payload


def _load_email_context(path: str | None) -> dict[str, str]:
    if path is None:
        return {}
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("email context JSON must be an object keyed by email_id.")
    return {str(k): str(v) for k, v in payload.items()}


def _choice_needs_context(choice: dict[str, Any]) -> bool:
    text = f"{choice.get('label', '')} {choice.get('intent', '')}".lower()
    keywords = (
        "timeline",
        "pricing",
        "price",
        "budget",
        "cost",
        "quote",
        "details",
        "clarify",
        "explain",
        "proposal",
    )
    return any(keyword in text for keyword in keywords)


def run() -> int:
    parser = argparse.ArgumentParser(
        description="CLI client for story scene backend flow (start -> advance -> resolve)."
    )
    parser.add_argument("--base-url", default="http://localhost:5000", help="Backend base URL.")
    parser.add_argument("--user-id", default="cli-user", help="User id sent to /start.")
    parser.add_argument(
        "--inbox-json",
        default=None,
        help="Path to JSON file with inbox_override payload (list[EmailItem]).",
    )
    parser.add_argument(
        "--auto",
        choices=["off", "first", "random"],
        default="off",
        help="Choice strategy while advancing scenes.",
    )
    parser.add_argument(
        "--max-steps",
        type=int,
        default=8,
        help="Safety cap for number of advance calls.",
    )
    parser.add_argument(
        "--user-context",
        default="",
        help="Optional global context for drafting (pricing, timeline, constraints).",
    )
    parser.add_argument(
        "--email-context-json",
        default=None,
        help="Path to JSON object mapping email_id -> extra drafting context.",
    )
    parser.add_argument(
        "--prompt-context",
        action="store_true",
        help="Prompt for additional global context before resolve.",
    )
    args = parser.parse_args()

    inbox_override = _load_inbox(args.inbox_json)
    email_context_by_id = _load_email_context(args.email_context_json)
    start_payload: dict[str, Any] = {"user_id": args.user_id}
    if inbox_override is not None:
        start_payload["inbox_override"] = inbox_override

    start_url = f"{args.base_url.rstrip('/')}/story/scene/start"
    print(f"Starting story session via {start_url}")
    start = _request_json("POST", start_url, start_payload)

    session_id = start["session_id"]
    scene = start["scene"]
    done = bool(start["done"])
    trace = start.get("trace", [])
    print(f"Session: {session_id}")

    steps = 0
    while not done:
        _print_scene(scene)
        chosen = _pick_choice(scene, args.auto)
        choice_slug = chosen["slug"]
        print(f"Chosen: {choice_slug}")
        choice_context = ""
        if _choice_needs_context(chosen):
            choice_context = input(
                "Optional extra context for this choice (pricing/timeline/details): "
            ).strip()
        advance_url = f"{args.base_url.rstrip('/')}/story/scene/{session_id}/advance"
        advanced = _request_json(
            "POST",
            advance_url,
            {"choice_slug": choice_slug, "choice_context": choice_context},
        )
        scene = advanced["scene"]
        done = bool(advanced["done"])
        trace = advanced.get("trace", [])
        steps += 1
        if steps >= args.max_steps:
            raise RuntimeError(f"Reached max steps ({args.max_steps}) before terminal scene.")

    print("\nReached terminal scene.")
    _print_scene(scene)
    print(f"Trace length: {len(trace)}")

    user_context = args.user_context.strip()
    if args.prompt_context:
        entered = input("Extra context for drafting (pricing/timeline/etc, empty to skip): ").strip()
        if entered:
            user_context = entered

    resolve_url = f"{args.base_url.rstrip('/')}/story/scene/{session_id}/resolve"
    resolve_payload = {
        "user_context": user_context,
        "email_context_by_id": email_context_by_id,
    }
    resolved = _request_json("POST", resolve_url, resolve_payload)
    drafts = resolved.get("drafts", [])
    print(f"\nResolved drafts: {len(drafts)}")
    for idx, draft in enumerate(drafts, start=1):
        print("\n" + "-" * 72)
        print(f"{idx}. email_id={draft.get('email_id')} to={draft.get('to')}")
        print(f"subject: {draft.get('subject')}")
        print(f"body:\n{draft.get('body')}")
    print("-" * 72)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(run())
    except KeyboardInterrupt:
        print("\nCancelled by user.", file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
