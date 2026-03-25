from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass, field
from datetime import datetime
from io import BytesIO
import logging
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from models.story import (
    AdvanceSceneRequest,
    AdvanceSceneResponse,
    DraftSendResult,
    EmailDraft,
    EmailItem,
    InboxPreviewResponse,
    ResolveSceneRequest,
    ResolveResponse,
    Scene,
    SceneChoice,
    SceneNpc,
    SceneVector,
    SceneWorldState,
    SendResponse,
    StartSceneRequest,
    StartSceneResponse,
    TraceStep,
)
from models.world import WorldPlanBuild
from services.auth.user_repository import AuthRepository
from services.gmail import GmailServiceError, list_todays_emails, send_draft_replies
from services.scene_builder import build_scene, resolve_emails
from services.world_planner import _simple_layout
from services.tts import (
    SceneTTSCacheEntry,
    ensure_scene_entry,
    generate_and_cache_scene_tts,
    get_scene_entry,
    scene_tts_url,
)
from services.world_planner import build_world_plan

router = APIRouter(prefix="/story/scene", tags=["story"])
log = logging.getLogger(__name__)
PENDING_TTS_WAIT_SECONDS = 0.5
PENDING_TTS_POLL_SECONDS = 0.05


@dataclass
class StorySession:
    emails: list[EmailItem]
    trace: list[TraceStep] = field(default_factory=list)
    current_scene: Scene | None = None
    preloaded_by_choice: dict[str, Scene] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    user_id: str = "demo-user"
    resolved_drafts: list[EmailDraft] = field(default_factory=list)
    world_id: str = ""
    current_location_id: str = ""
    visited_location_ids: set[str] = field(default_factory=set)
    world_locations: dict[str, Scene] = field(default_factory=dict)
    world_transitions: dict[str, dict[str, str]] = field(default_factory=dict)
    planner_source: str = "fallback"
    run_seed: int = 0


SESSIONS: dict[str, StorySession] = {}


def _mock_emails() -> list[EmailItem]:
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


async def _load_emails_with_source(
    body: StartSceneRequest,
    repo: AuthRepository | None,
) -> tuple[list[EmailItem], str]:
    if body.inbox_override is not None:
        return body.inbox_override, "override"

    token = None
    if repo is not None:
        try:
            token = await asyncio.to_thread(repo.get_google_credentials_for_user, body.user_id)
        except Exception:
            log.info("gmail_inbox_token_lookup_failed user_id=%s", body.user_id)

    if token:
        try:
            emails, _ = await list_todays_emails(token)
            if emails:
                log.info("gmail_inbox_loaded user_id=%s count=%s", body.user_id, len(emails))
                return emails, "gmail"
        except GmailServiceError:
            log.warning("gmail_inbox_load_failed user_id=%s", body.user_id, exc_info=True)

    log.info("gmail_inbox_fallback_mock user_id=%s", body.user_id)
    return _mock_emails(), "mock"


async def _load_emails(body: StartSceneRequest, repo: AuthRepository | None) -> list[EmailItem]:
    emails, _ = await _load_emails_with_source(body, repo)
    return emails


async def _build_scene_async(emails: list[EmailItem], trace: list[TraceStep]) -> Scene:
    return await asyncio.to_thread(build_scene, emails, trace)


async def _build_world_plan_async(emails: list[EmailItem], user_id: str) -> WorldPlanBuild:
    run_seed = int(uuid4().int % 1_000_000_000)
    return await asyncio.to_thread(build_world_plan, emails, user_id, 5, run_seed)


def _scene_with_world_state(session: StorySession, scene: Scene, location_id: str) -> Scene:
    hydrated = scene.model_copy(deep=True)
    hydrated.choice_transitions = session.world_transitions.get(location_id, {})
    if not hydrated.is_terminal and not hydrated.choices:
        if hydrated.choice_transitions:
            hydrated.choices = [
                SceneChoice(
                    slug=slug,
                    label=slug.replace("_", " ").replace("-", " ").strip().title() or "Continue",
                    intent="neutral",
                )
                for slug in hydrated.choice_transitions
            ]
        else:
            fallback_target = next((loc for loc in session.world_locations if loc != location_id), location_id)
            fallback_choices = [
                SceneChoice(slug="reply_now", label="Reply now", intent="agree_immediately"),
                SceneChoice(slug="ask_context", label="Ask for context", intent="ask_for_clarification"),
                SceneChoice(slug="defer", label="Defer politely", intent="ask_for_more_time"),
            ]
            hydrated.choices = fallback_choices
            hydrated.choice_transitions = {choice.slug: fallback_target for choice in fallback_choices}
            session.world_transitions[location_id] = hydrated.choice_transitions
    hydrated.world = SceneWorldState(
        world_id=session.world_id or "legacy-world",
        location_id=location_id,
        visited_location_ids=sorted(session.visited_location_ids | {location_id}),
        planner_source=session.planner_source,
        run_seed=session.run_seed,
    )
    if hydrated.environment and hydrated.environment.layout is None:
        loc_idx = list(session.world_locations.keys()).index(location_id) if location_id in session.world_locations else 0
        hydrated.environment.layout = _simple_layout(seed=session.run_seed or 0, location_idx=loc_idx)
    if not hydrated.npcs:
        primary_email_id = hydrated.related_email_ids[0] if hydrated.related_email_ids else (hydrated.npc_id or "email")
        hydrated.npcs = [
            SceneNpc(
                id=hydrated.npc_id or primary_email_id,
                name=hydrated.npc_name or "NPC",
                email_id=primary_email_id,
                position=SceneVector(x=0, y=0, z=2),
                opening_line=hydrated.dialogue,
                choices=hydrated.choices,
                related_email_ids=hydrated.related_email_ids or [primary_email_id],
            )
        ]
    elif not hydrated.npcs[0].choices and hydrated.choices:
        hydrated.npcs[0].choices = hydrated.choices
        if not hydrated.npcs[0].related_email_ids and hydrated.related_email_ids:
            hydrated.npcs[0].related_email_ids = hydrated.related_email_ids
    if hydrated.npcs:
        primary = hydrated.npcs[0]
        hydrated.npc_id = primary.id
        hydrated.npc_name = primary.name
        hydrated.dialogue = primary.opening_line
        hydrated.choices = primary.choices
        hydrated.related_email_ids = primary.related_email_ids
    return hydrated


async def _wait_for_ready_scene_tts(session_id: str, scene_id: str) -> SceneTTSCacheEntry | None:
    deadline = asyncio.get_running_loop().time() + PENDING_TTS_WAIT_SECONDS
    entry = get_scene_entry(session_id=session_id, scene_id=scene_id)
    while entry is not None and entry.status == "pending" and asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(PENDING_TTS_POLL_SECONDS)
        entry = get_scene_entry(session_id=session_id, scene_id=scene_id)
    return entry


def _attach_scene_tts(session_id: str, scene: Scene) -> Scene:
    entry = ensure_scene_entry(session_id=session_id, scene_id=scene.scene_id)
    scene.tts = scene_tts_url(session_id=session_id, scene_id=scene.scene_id)
    scene.voice_id = entry.voice_id
    return scene


async def _generate_scene_tts_task(session_id: str, scene: Scene) -> None:
    try:
        await asyncio.to_thread(
            generate_and_cache_scene_tts,
            session_id,
            scene.scene_id,
            scene.dialogue,
        )
    except Exception:
        log.warning(
            "scene_tts_generation_failed session_id=%s scene_id=%s",
            session_id,
            scene.scene_id,
            exc_info=True,
        )


def _start_scene_tts_generation(session_id: str, scene: Scene) -> None:
    asyncio.create_task(_generate_scene_tts_task(session_id=session_id, scene=scene))


def _find_scene_dialogue(session: StorySession, scene_id: str) -> str | None:
    if session.current_scene and session.current_scene.scene_id == scene_id:
        return session.current_scene.dialogue
    for preloaded in session.preloaded_by_choice.values():
        if preloaded.scene_id == scene_id:
            return preloaded.dialogue
    return None


async def _preload_next(session_id: str, session: StorySession, scene: Scene) -> None:
    if scene.is_terminal or not scene.choices:
        return
    preload_results: dict[str, Scene] = {}
    for choice in scene.choices:
        target_location_id = session.world_transitions.get(session.current_location_id, {}).get(choice.slug, "")
        trace = [*session.trace, TraceStep(
            scene_id=scene.scene_id,
            npc_id=scene.npc_id,
            choice_slug=choice.slug,
            choice_intent=choice.intent,
            choice_context="",
            related_email_ids=scene.related_email_ids,
            from_location_id=session.current_location_id,
            to_location_id=target_location_id,
        )]
        try:
            if target_location_id and target_location_id in session.world_locations:
                preload_scene = _scene_with_world_state(
                    session=session,
                    scene=session.world_locations[target_location_id],
                    location_id=target_location_id,
                )
            else:
                preload_scene = await _build_scene_async(session.emails, trace)
            _attach_scene_tts(session_id=session_id, scene=preload_scene)
            _start_scene_tts_generation(session_id=session_id, scene=preload_scene)
            preload_results[choice.slug] = preload_scene
        except Exception:
            log.warning(
                "preload_scene_failed scene_id=%s choice_slug=%s",
                scene.scene_id, choice.slug, exc_info=True,
            )
    async with session.lock:
        session.preloaded_by_choice = preload_results


@router.post("/preview", response_model=InboxPreviewResponse)
async def preview_scene(body: StartSceneRequest, request: Request) -> InboxPreviewResponse:
    repo = getattr(request.app.state, "auth_repository", None)
    emails, source = await _load_emails_with_source(body, repo)
    return InboxPreviewResponse(emails=emails, source=source)


@router.post("/start", response_model=StartSceneResponse)
async def start_scene(body: StartSceneRequest, request: Request) -> StartSceneResponse:
    repo = getattr(request.app.state, "auth_repository", None)
    emails = await _load_emails(body, repo)
    if not emails:
        log.warning("start_scene_rejected reason=no_emails user_id=%s", body.user_id)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No emails found for today's inbox.",
        )
    world_build: WorldPlanBuild | None = None
    try:
        world_build = await _build_world_plan_async(emails, body.user_id)
    except Exception:
        log.warning("world_plan_build_failed user_id=%s", body.user_id, exc_info=True)
    first_scene: Scene
    world_id = ""
    current_location_id = ""
    world_locations: dict[str, Scene] = {}
    world_transitions: dict[str, dict[str, str]] = {}
    planner_source = "fallback"
    run_seed = 0
    if world_build and world_build.plan.locations:
        planner_source = world_build.source
        run_seed = world_build.run_seed
        world_id = world_build.plan.world_id
        current_location_id = world_build.plan.entry_location_id
        world_locations = {location.id: location.scene for location in world_build.plan.locations}
        world_transitions = world_build.plan.transitions
        first_scene = (world_locations.get(current_location_id) or world_build.plan.locations[0].scene).model_copy(deep=True)
    else:
        try:
            first_scene = await _build_scene_async(emails, [])
        except Exception as exc:
            log.exception("start_scene_openai_failed email_count=%s", len(emails))
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to generate first scene: {exc}",
            ) from exc
    session_id = str(uuid4())
    session = StorySession(
        emails=emails,
        current_scene=first_scene,
        user_id=body.user_id,
        world_id=world_id,
        current_location_id=current_location_id,
        visited_location_ids={current_location_id} if current_location_id else set(),
        world_locations=world_locations,
        world_transitions=world_transitions,
        planner_source=planner_source,
        run_seed=run_seed,
    )
    if current_location_id:
        first_scene = _scene_with_world_state(session=session, scene=first_scene, location_id=current_location_id)
        session.current_scene = first_scene
    _attach_scene_tts(session_id=session_id, scene=first_scene)
    SESSIONS[session_id] = session
    log.info(
        "start_scene session_id=%s email_count=%s scene_id=%s terminal=%s",
        session_id, len(emails), first_scene.scene_id, first_scene.is_terminal,
    )
    await _generate_scene_tts_task(session_id=session_id, scene=first_scene)
    asyncio.create_task(_preload_next(session_id, session, first_scene))
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
    next_location_id = session.world_transitions.get(session.current_location_id, {}).get(request.choice_slug, "")
    step = TraceStep(
        scene_id=current_scene.scene_id,
        npc_id=current_scene.npc_id,
        choice_slug=chosen.slug,
        choice_intent=chosen.intent,
        choice_context=request.choice_context.strip(),
        related_email_ids=current_scene.related_email_ids,
        from_location_id=session.current_location_id,
        to_location_id=next_location_id,
    )
    next_trace = [*session.trace, step]

    next_scene = session.preloaded_by_choice.get(request.choice_slug)
    if next_scene is None:
        log.info("advance_scene_cache_miss session_id=%s", session_id)
        try:
            if next_location_id and next_location_id in session.world_locations:
                next_scene = _scene_with_world_state(
                    session=session,
                    scene=session.world_locations[next_location_id],
                    location_id=next_location_id,
                )
            else:
                next_scene = await _build_scene_async(session.emails, next_trace)
        except Exception as exc:
            log.exception("advance_scene_openai_failed session_id=%s", session_id)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to generate next scene: {exc}",
            ) from exc
    else:
        log.info("advance_scene_cache_hit session_id=%s", session_id)

    _attach_scene_tts(session_id=session_id, scene=next_scene)

    async with session.lock:
        session.trace = next_trace
        session.current_scene = next_scene
        session.preloaded_by_choice = {}
        if next_location_id:
            session.current_location_id = next_location_id
            session.visited_location_ids.add(next_location_id)

    _start_scene_tts_generation(session_id=session_id, scene=next_scene)
    asyncio.create_task(_preload_next(session_id, session, next_scene))
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
    session.resolved_drafts = drafts
    log.info("resolve_scene_ok session_id=%s drafts=%s", session_id, len(drafts))
    return ResolveResponse(session_id=session_id, drafts=drafts)


@router.post("/{session_id}/send", response_model=SendResponse)
async def send_scene_emails(session_id: str, request: Request) -> SendResponse:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    if not session.resolved_drafts:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No resolved drafts — call /resolve first.",
        )
    repo: AuthRepository = request.app.state.auth_repository
    user_token = await asyncio.to_thread(
        repo.get_google_credentials_for_user, session.user_id
    )
    if user_token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No Google credentials for this user. Authenticate first.",
        )
    try:
        results, _ = await send_draft_replies(user_token, session.resolved_drafts)
    except Exception as exc:
        log.exception("send_scene_emails_failed session_id=%s", session_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to send emails: {exc}",
        ) from exc
    log.info(
        "send_scene_emails_ok session_id=%s sent=%s failed=%s",
        session_id,
        sum(1 for r in results if r.status == "sent"),
        sum(1 for r in results if r.status == "failed"),
    )
    return SendResponse(
        session_id=session_id,
        results=[DraftSendResult(**asdict(r)) for r in results],
    )


@router.post("/{session_id}/send/{email_id}", response_model=DraftSendResult)
async def send_single_draft(session_id: str, email_id: str, request: Request) -> DraftSendResult:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    draft = next((d for d in session.resolved_drafts if d.email_id == email_id), None)
    if draft is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No resolved draft for email_id={email_id}. Call /resolve first.",
        )
    repo: AuthRepository = request.app.state.auth_repository
    user_token = await asyncio.to_thread(repo.get_google_credentials_for_user, session.user_id)
    if user_token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No Google credentials for this user. Authenticate first.",
        )
    try:
        results, _ = await send_draft_replies(user_token, [draft])
    except Exception as exc:
        log.exception("send_single_draft_failed session_id=%s email_id=%s", session_id, email_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to send email: {exc}",
        ) from exc
    result = results[0]
    log.info("send_single_draft_ok session_id=%s email_id=%s status=%s", session_id, email_id, result.status)
    return DraftSendResult(**asdict(result))


@router.get("/{session_id}/{scene_id}/tts")
async def stream_scene_tts(session_id: str, scene_id: str):
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    entry = get_scene_entry(session_id=session_id, scene_id=scene_id)
    if entry is None:
        dialogue = _find_scene_dialogue(session=session, scene_id=scene_id)
        if dialogue is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scene not found for this session.")
        try:
            await asyncio.to_thread(generate_and_cache_scene_tts, session_id, scene_id, dialogue)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to generate scene audio: {exc}",
            ) from exc
        entry = get_scene_entry(session_id=session_id, scene_id=scene_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="TTS cache unavailable.")
    if entry.status == "pending":
        entry = await _wait_for_ready_scene_tts(session_id=session_id, scene_id=scene_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="TTS cache unavailable.")
    if entry.status == "ready" and entry.audio_bytes:
        return StreamingResponse(BytesIO(entry.audio_bytes), media_type="audio/mpeg")
    if entry.status == "failed":
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"TTS generation failed: {entry.error or 'provider_error'}",
        )
    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={"status": "pending"},
        headers={"Retry-After": "1"},
    )
