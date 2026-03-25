from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class SceneVector(BaseModel):
    x: float
    y: float
    z: float


class SceneWorldBounds(BaseModel):
    minX: int
    maxX: int
    minZ: int
    maxZ: int


class SceneBlock(BaseModel):
    x: int
    y: int
    z: int
    type: str = Field(min_length=1)


class SceneLayout(BaseModel):
    seed: int = 0
    bounds: SceneWorldBounds
    blocks: list[SceneBlock] = Field(default_factory=list)


class SceneEnvironment(BaseModel):
    theme: str = "inboxPlaza"
    spawn: SceneVector = Field(default_factory=lambda: SceneVector(x=0, y=0, z=8))
    layout: SceneLayout | None = None


class SceneWorldState(BaseModel):
    world_id: str = Field(min_length=1)
    location_id: str = Field(min_length=1)
    visited_location_ids: list[str] = Field(default_factory=list)
    planner_source: str = "fallback"
    run_seed: int = 0


class EmailItem(BaseModel):
    id: str
    sender: str
    subject: str
    snippet: str = ""
    body: str = ""
    thread_id: str | None = None


class SceneChoice(BaseModel):
    slug: str = Field(min_length=1)
    label: str = Field(min_length=1)
    # short keyword surfaced to the email-drafting LLM (e.g. "polite_decline", "agree", "defer")
    intent: str = Field(min_length=1, default="neutral")


class SceneNpc(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    email_id: str = Field(min_length=1)
    position: SceneVector
    opening_line: str = Field(min_length=1)
    tts: str = ""
    voice_id: str | None = None
    choices: list[SceneChoice] = Field(default_factory=list)
    related_email_ids: list[str] = Field(default_factory=list)


class Scene(BaseModel):
    scene_id: str = Field(min_length=1)
    npc_id: str = Field(min_length=1)
    npc_name: str = Field(min_length=1)
    dialogue: str = Field(min_length=1)
    tts: str = ""
    voice_id: str | None = None
    choices: list[SceneChoice] = Field(default_factory=list)
    is_terminal: bool = False
    related_email_ids: list[str] = Field(default_factory=list)
    environment: SceneEnvironment = Field(default_factory=SceneEnvironment)
    world: SceneWorldState | None = None
    npcs: list[SceneNpc] = Field(default_factory=list)
    choice_transitions: dict[str, str] = Field(default_factory=dict)

    @field_validator("choices")
    @classmethod
    def validate_choices(cls, choices: list[SceneChoice]) -> list[SceneChoice]:
        seen: set[str] = set()
        for choice in choices:
            if choice.slug in seen:
                raise ValueError(f"Duplicate choice slug: {choice.slug}")
            seen.add(choice.slug)
        return choices


class StartSceneRequest(BaseModel):
    user_id: str = "demo-user"
    inbox_override: list[EmailItem] | None = None


class AdvanceSceneRequest(BaseModel):
    npc_id: str = ""
    choice_slug: str = Field(min_length=1)
    choice_context: str = ""


class TraceStep(BaseModel):
    scene_id: str
    npc_id: str = ""
    choice_slug: str
    choice_intent: str = "neutral"
    choice_context: str = ""
    related_email_ids: list[str] = Field(default_factory=list)
    from_location_id: str = ""
    to_location_id: str = ""


class StartSceneResponse(BaseModel):
    session_id: str
    scene: Scene
    trace: list[TraceStep]
    done: bool


class InboxPreviewResponse(BaseModel):
    emails: list[EmailItem]
    source: Literal["gmail", "mock", "override"]


class AdvanceSceneResponse(BaseModel):
    scene: Scene
    trace: list[TraceStep]
    done: bool


class EmailDraft(BaseModel):
    email_id: str
    to: str
    subject: str
    body: str


class ResolveResponse(BaseModel):
    session_id: str
    drafts: list[EmailDraft]


class ResolveSceneRequest(BaseModel):
    # Global context applied to all drafted replies (e.g. "timeline is 6 weeks, budget cap is 20k")
    user_context: str = ""
    # Per-email context keyed by email id for precise facts (pricing, constraints, owners, etc.)
    email_context_by_id: dict[str, str] = Field(default_factory=dict)


class DraftSendResult(BaseModel):
    email_id: str
    thread_id: str | None
    gmail_message_id: str | None
    status: Literal["sent", "failed"]
    error: str | None = None


class SendResponse(BaseModel):
    session_id: str
    results: list[DraftSendResult]
