from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class EmailItem(BaseModel):
    id: str
    sender: str
    subject: str
    snippet: str = ""
    thread_id: str | None = None


class SceneChoice(BaseModel):
    slug: str = Field(min_length=1)
    label: str = Field(min_length=1)


class Scene(BaseModel):
    scene_id: str = Field(min_length=1)
    npc_id: str = Field(min_length=1)
    npc_name: str = Field(min_length=1)
    dialogue: str = Field(min_length=1)
    choices: list[SceneChoice] = Field(default_factory=list)
    is_terminal: bool = False
    related_email_ids: list[str] = Field(default_factory=list)

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
    choice_slug: str = Field(min_length=1)


class TraceStep(BaseModel):
    scene_id: str
    choice_slug: str


class StartSceneResponse(BaseModel):
    session_id: str
    scene: Scene
    trace: list[TraceStep]
    done: bool


class AdvanceSceneResponse(BaseModel):
    scene: Scene
    trace: list[TraceStep]
    done: bool
