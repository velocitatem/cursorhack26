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


def _pick_choice(scene: dict[str, Any], auto: str) -> str:
    choices = scene.get("choices") or []
    if not choices:
        raise RuntimeError("No choices available for non-terminal scene.")
    if auto == "first":
        return choices[0]["slug"]
    if auto == "random":
        return random.choice(choices)["slug"]
    while True:
        raw = input("Pick choice number (or slug): ").strip()
        if not raw:
            continue
        if raw.isdigit():
            idx = int(raw)
            if 1 <= idx <= len(choices):
                return choices[idx - 1]["slug"]
        if any(choice["slug"] == raw for choice in choices):
            return raw
        print("Invalid input, try again.")


def _load_inbox(path: str | None) -> list[dict[str, Any]] | None:
    if path is None:
        return None
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise RuntimeError("inbox JSON must be a list of email objects.")
    return payload


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
    args = parser.parse_args()

    inbox_override = _load_inbox(args.inbox_json)
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
        choice_slug = _pick_choice(scene, args.auto)
        print(f"Chosen: {choice_slug}")
        advance_url = f"{args.base_url.rstrip('/')}/story/scene/{session_id}/advance"
        advanced = _request_json("POST", advance_url, {"choice_slug": choice_slug})
        scene = advanced["scene"]
        done = bool(advanced["done"])
        trace = advanced.get("trace", [])
        steps += 1
        if steps >= args.max_steps:
            raise RuntimeError(f"Reached max steps ({args.max_steps}) before terminal scene.")

    print("\nReached terminal scene.")
    _print_scene(scene)
    print(f"Trace length: {len(trace)}")

    resolve_url = f"{args.base_url.rstrip('/')}/story/scene/{session_id}/resolve"
    resolved = _request_json("POST", resolve_url, None)
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
