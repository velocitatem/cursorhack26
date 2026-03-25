from __future__ import annotations

from pydantic import BaseModel, Field

from models.story import Scene, SceneWorldBounds


class WorldLocation(BaseModel):
    id: str = Field(min_length=1)
    scene: Scene
    bounds: SceneWorldBounds


class WorldPlan(BaseModel):
    world_id: str = Field(min_length=1)
    entry_location_id: str = Field(min_length=1)
    locations: list[WorldLocation] = Field(default_factory=list)
    transitions: dict[str, dict[str, str]] = Field(default_factory=dict)
