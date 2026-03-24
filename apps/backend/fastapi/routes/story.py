from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, status

from models.story import (
    AdvanceSceneRequest,
    AdvanceSceneResponse,
    EmailItem,
    ResolveSceneRequest,
    ResolveResponse,
    Scene,
    StartSceneRequest,
    StartSceneResponse,
    TraceStep,
)
from services.scene_builder import build_scene, resolve_emails

router = APIRouter(prefix="/story/scene", tags=["story"])
log = logging.getLogger(__name__)


@dataclass
class StorySession:
    emails: list[EmailItem]
    trace: list[TraceStep] = field(default_factory=list)
    current_scene: Scene | None = None
    preloaded_by_choice: dict[str, Scene] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


SESSIONS: dict[str, StorySession] = {}


def _fetch_todays_emails(request: StartSceneRequest) -> list[EmailItem]:
    if request.inbox_override:
        return request.inbox_override
    return [
        EmailItem(
            id="email-1",
            sender="manager@company.com",
            subject="Need status update by EOD",
            snippet="Can you send a short status update before 5pm?",
            body="Hi, just checking in — could you send me a brief status update on the project before end of day? Thanks.",
        ),
        EmailItem(
            id="email-2",
            sender="client@startup.io",
            subject="Follow-up on proposal",
            snippet="Could you clarify timeline and pricing details?",
            body="Hey, following up on the proposal we discussed. Could you clarify the expected timeline and break down the pricing a bit more? We're keen to move forward.",
        ),
    ]


async def _build_scene_async(emails: list[EmailItem], trace: list[TraceStep]) -> Scene:
    return await asyncio.to_thread(build_scene, emails, trace)


async def _preload_next(session: StorySession, scene: Scene) -> None:
    if scene.is_terminal or not scene.choices:
        return
    preload_results: dict[str, Scene] = {}
    for choice in scene.choices:
        trace = [*session.trace, TraceStep(
            scene_id=scene.scene_id,
            npc_id=scene.npc_id,
            choice_slug=choice.slug,
            choice_intent=choice.intent,
            choice_context="",
            related_email_ids=scene.related_email_ids,
        )]
        try:
            preload_results[choice.slug] = await _build_scene_async(session.emails, trace)
        except Exception:
            log.warning(
                "preload_scene_failed scene_id=%s choice_slug=%s",
                scene.scene_id, choice.slug, exc_info=True,
            )
    async with session.lock:
        session.preloaded_by_choice = preload_results


@router.post("/start", response_model=StartSceneResponse)
async def start_scene(request: StartSceneRequest) -> StartSceneResponse:
    emails = _fetch_todays_emails(request)
    if not emails:
        log.warning("start_scene_rejected reason=no_emails user_id=%s", request.user_id)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No emails found for today's inbox.",
        )
    try:
        first_scene = await _build_scene_async(emails, [])
    except Exception as exc:
        log.exception("start_scene_openai_failed email_count=%s", len(emails))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to generate first scene: {exc}",
        ) from exc
    session_id = str(uuid4())
    session = StorySession(emails=emails, current_scene=first_scene)
    SESSIONS[session_id] = session
    log.info(
        "start_scene session_id=%s email_count=%s scene_id=%s terminal=%s",
        session_id, len(emails), first_scene.scene_id, first_scene.is_terminal,
    )
    asyncio.create_task(_preload_next(session, first_scene))
    return StartSceneResponse(session_id=session_id, scene=first_scene, trace=[], done=first_scene.is_terminal)


@router.post("/{session_id}/advance", response_model=AdvanceSceneResponse)
async def advance_scene(session_id: str, request: AdvanceSceneRequest) -> AdvanceSceneResponse:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    current_scene = session.current_scene
    if current_scene is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Current scene is missing from session.")
    if current_scene.is_terminal:
        return AdvanceSceneResponse(scene=current_scene, trace=session.trace, done=True)

    allowed = {c.slug: c for c in current_scene.choices}
    if request.choice_slug not in allowed:
        log.warning(
            "advance_scene_bad_slug session_id=%s slug=%s allowed=%s",
            session_id, request.choice_slug, sorted(allowed),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": "Invalid choice slug.", "allowed_choices": sorted(allowed)},
        )

    chosen = allowed[request.choice_slug]
    step = TraceStep(
        scene_id=current_scene.scene_id,
        npc_id=current_scene.npc_id,
        choice_slug=chosen.slug,
        choice_intent=chosen.intent,
        choice_context=request.choice_context.strip(),
        related_email_ids=current_scene.related_email_ids,
    )
    next_trace = [*session.trace, step]

    next_scene = session.preloaded_by_choice.get(request.choice_slug)
    if next_scene is None:
        log.info("advance_scene_cache_miss session_id=%s", session_id)
        try:
            next_scene = await _build_scene_async(session.emails, next_trace)
        except Exception as exc:
            log.exception("advance_scene_openai_failed session_id=%s", session_id)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to generate next scene: {exc}",
            ) from exc
    else:
        log.info("advance_scene_cache_hit session_id=%s", session_id)

    async with session.lock:
        session.trace = next_trace
        session.current_scene = next_scene
        session.preloaded_by_choice = {}

    asyncio.create_task(_preload_next(session, next_scene))
    log.info(
        "advance_scene session_id=%s scene_id=%s done=%s trace_len=%s",
        session_id, next_scene.scene_id, next_scene.is_terminal, len(next_trace),
    )
    return AdvanceSceneResponse(scene=next_scene, trace=next_trace, done=next_scene.is_terminal)


@router.post("/{session_id}/resolve", response_model=ResolveResponse)
async def resolve_scene(session_id: str, request: ResolveSceneRequest | None = None) -> ResolveResponse:
    """After the story ends, turn the full trace into actual email reply drafts."""
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    if not session.trace:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No choices recorded yet — play through the story first.",
        )
    try:
        drafts = await asyncio.to_thread(
            resolve_emails,
            session.emails,
            session.trace,
            request.user_context if request else "",
            request.email_context_by_id if request else None,
        )
    except Exception as exc:
        log.exception("resolve_scene_failed session_id=%s", session_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to resolve emails: {exc}",
        ) from exc
    log.info("resolve_scene_ok session_id=%s drafts=%s", session_id, len(drafts))
    return ResolveResponse(session_id=session_id, drafts=drafts)
