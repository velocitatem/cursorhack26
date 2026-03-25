from __future__ import annotations

import json
import os
import sys
from pathlib import Path

base_dir = Path(__file__).resolve().parents[1]
repo_root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(base_dir))
sys.path.insert(0, str(repo_root))

from models.story import EmailItem, TraceStep  # noqa: E402
from services.scene_builder import resolve_emails  # noqa: E402


def test_resolve_emails_fills_missing_drafts(monkeypatch):
    emails = [
        EmailItem(id="email-1", sender="manager@company.com", subject="Need status update", snippet="", body=""),
        EmailItem(id="email-2", sender="client@startup.io", subject="Proposal follow-up", snippet="", body=""),
    ]
    trace = [
        TraceStep(
            scene_id="scene-1",
            npc_id="email-1",
            choice_slug="reply_now",
            choice_intent="agree_immediately",
            related_email_ids=["email-1"],
        )
    ]

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_CACHE_ENABLED", "false")

    def fake_openai_post(api_key, body):
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "drafts": [
                                    {
                                        "email_id": "email-1",
                                        "to": "manager@company.com",
                                        "subject": "Re: Need status update",
                                        "body": "Thanks for the note. I will send the update shortly.",
                                    }
                                ]
                            }
                        )
                    }
                }
            ]
        }

    monkeypatch.setattr("services.scene_builder._openai_post", fake_openai_post)

    drafts = resolve_emails(
        emails=emails,
        trace=trace,
        user_context="",
        email_context_by_id={"email-2": "Context says timeline is 6 weeks."},
    )

    assert len(drafts) == 2
    assert drafts[0].email_id == "email-1"
    assert drafts[1].email_id == "email-2"
    assert drafts[1].subject == "Re: Proposal follow-up"
    assert "timeline is 6 weeks" in drafts[1].body
