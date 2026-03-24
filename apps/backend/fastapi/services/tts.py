from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
import logging
import os
import random
from threading import Lock
from typing import Any

import requests

from services.cache import delete_keys, get_bytes, get_json, set_bytes, set_json, tts_cache_ttl_seconds

log = logging.getLogger(__name__)

ELEVENLABS_URL_TEMPLATE = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
DEFAULT_MODEL_ID = "eleven_multilingual_v2"
DEFAULT_MAX_TEXT_CHARS = 1400


@dataclass
class SceneTTSCacheEntry:
    status: str = "pending"
    voice_id: str | None = None
    audio_bytes: bytes | None = None
    error: str | None = None
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))


_CACHE: dict[tuple[str, str], SceneTTSCacheEntry] = {}
_LOCK = Lock()


def _cache_key(session_id: str, scene_id: str) -> tuple[str, str]:
    return (session_id, scene_id)


def _meta_cache_key(session_id: str, scene_id: str) -> str:
    return f"tts:scene:{session_id}:{scene_id}:meta"


def _max_text_chars() -> int:
    raw = os.getenv("TTS_MAX_TEXT_CHARS", str(DEFAULT_MAX_TEXT_CHARS))
    try:
        return max(int(raw), 200)
    except ValueError:
        return DEFAULT_MAX_TEXT_CHARS


def _audio_cache_key(session_id: str, scene_id: str) -> str:
    return f"tts:scene:{session_id}:{scene_id}:audio"


def _to_entry(payload: dict[str, Any]) -> SceneTTSCacheEntry:
    updated_at_raw = str(payload.get("updated_at", ""))
    updated_at = datetime.now(UTC)
    if updated_at_raw:
        try:
            updated_at = datetime.fromisoformat(updated_at_raw)
        except ValueError:
            pass
    return SceneTTSCacheEntry(
        status=str(payload.get("status", "pending")),
        voice_id=str(payload.get("voice_id", "")) or None,
        audio_bytes=None,
        error=str(payload.get("error", "")) or None,
        updated_at=updated_at,
    )


def _serialize_entry(entry: SceneTTSCacheEntry) -> dict[str, Any]:
    return {
        "status": entry.status,
        "voice_id": entry.voice_id,
        "error": entry.error,
        "updated_at": entry.updated_at.isoformat(),
    }


def _write_entry(session_id: str, scene_id: str, entry: SceneTTSCacheEntry) -> None:
    set_json(
        key=_meta_cache_key(session_id=session_id, scene_id=scene_id),
        value=_serialize_entry(entry),
        ttl_seconds=tts_cache_ttl_seconds(),
    )


def _read_entry(session_id: str, scene_id: str) -> SceneTTSCacheEntry | None:
    payload = get_json(_meta_cache_key(session_id=session_id, scene_id=scene_id))
    if not isinstance(payload, dict):
        return None
    entry = _to_entry(payload)
    audio = get_bytes(_audio_cache_key(session_id=session_id, scene_id=scene_id))
    if audio is not None:
        entry.audio_bytes = audio
    return entry


def _parse_voice_pool() -> list[str]:
    pooled = [v.strip() for v in os.getenv("ELEVENLABS_VOICE_IDS", "").split(",") if v.strip()]
    if pooled:
        return pooled
    fallback = os.getenv("ELEVENLABS_VOICE_ID", "").strip()
    if fallback:
        return [fallback]
    return []


def _pick_voice_id() -> str:
    voices = _parse_voice_pool()
    if not voices:
        raise RuntimeError("No ElevenLabs voice configured. Set ELEVENLABS_VOICE_IDS or ELEVENLABS_VOICE_ID.")
    return random.choice(voices)


def scene_tts_url(session_id: str, scene_id: str) -> str:
    return f"/story/scene/{session_id}/{scene_id}/tts"


def ensure_scene_entry(session_id: str, scene_id: str) -> SceneTTSCacheEntry:
    key = _cache_key(session_id, scene_id)
    with _LOCK:
        existing = _CACHE.get(key)
        if existing is not None:
            if not existing.voice_id:
                existing.voice_id = _pick_voice_id()
                existing.updated_at = datetime.now(UTC)
                _write_entry(session_id=session_id, scene_id=scene_id, entry=existing)
            return existing
        cached = _read_entry(session_id=session_id, scene_id=scene_id)
        if cached is not None:
            if not cached.voice_id:
                cached.voice_id = _pick_voice_id()
                cached.updated_at = datetime.now(UTC)
                _write_entry(session_id=session_id, scene_id=scene_id, entry=cached)
            _CACHE[key] = cached
            return cached
        voice_id = _pick_voice_id()
        created = SceneTTSCacheEntry(status="pending", voice_id=voice_id)
        _CACHE[key] = created
        _write_entry(session_id=session_id, scene_id=scene_id, entry=created)
        return created


def set_scene_pending(session_id: str, scene_id: str) -> SceneTTSCacheEntry:
    entry = ensure_scene_entry(session_id, scene_id)
    with _LOCK:
        entry.status = "pending"
        entry.error = None
        entry.audio_bytes = None
        entry.updated_at = datetime.now(UTC)
        _write_entry(session_id=session_id, scene_id=scene_id, entry=entry)
    delete_keys(_audio_cache_key(session_id=session_id, scene_id=scene_id))
    return entry


def get_scene_entry(session_id: str, scene_id: str) -> SceneTTSCacheEntry | None:
    key = _cache_key(session_id, scene_id)
    with _LOCK:
        entry = _CACHE.get(key)
        if entry is not None:
            if entry.audio_bytes is None:
                entry.audio_bytes = get_bytes(_audio_cache_key(session_id=session_id, scene_id=scene_id))
            return entry
        cached = _read_entry(session_id=session_id, scene_id=scene_id)
        if cached is not None:
            _CACHE[key] = cached
        return cached


def set_scene_ready(session_id: str, scene_id: str, voice_id: str, audio_bytes: bytes) -> None:
    key = _cache_key(session_id, scene_id)
    with _LOCK:
        entry = _CACHE.get(key) or SceneTTSCacheEntry()
        entry.status = "ready"
        entry.voice_id = voice_id
        entry.audio_bytes = audio_bytes
        entry.error = None
        entry.updated_at = datetime.now(UTC)
        _CACHE[key] = entry
        _write_entry(session_id=session_id, scene_id=scene_id, entry=entry)
    set_bytes(
        key=_audio_cache_key(session_id=session_id, scene_id=scene_id),
        value=audio_bytes,
        ttl_seconds=tts_cache_ttl_seconds(),
    )


def set_scene_failed(session_id: str, scene_id: str, voice_id: str, error: str) -> None:
    key = _cache_key(session_id, scene_id)
    with _LOCK:
        entry = _CACHE.get(key) or SceneTTSCacheEntry()
        entry.status = "failed"
        entry.voice_id = voice_id
        entry.audio_bytes = None
        entry.error = error
        entry.updated_at = datetime.now(UTC)
        _CACHE[key] = entry
        _write_entry(session_id=session_id, scene_id=scene_id, entry=entry)


def synthesize_tts_stream(text: str, voice_id: str) -> bytes:
    text = text.strip()
    if not text:
        raise ValueError("Cannot synthesize TTS for empty text.")
    if len(text) > _max_text_chars():
        raise ValueError(f"TTS text exceeds maximum allowed length ({_max_text_chars()} chars).")
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not set")
    response = requests.post(
        ELEVENLABS_URL_TEMPLATE.format(voice_id=voice_id),
        headers={
            "xi-api-key": api_key,
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
        },
        json={
            "text": text,
            "model_id": os.getenv("ELEVENLABS_MODEL_ID", DEFAULT_MODEL_ID),
        },
        timeout=60,
    )
    if response.status_code >= 400:
        body_preview = response.text[:500]
        log.error(
            "elevenlabs_http_error status=%s voice_id=%s body_preview=%s",
            response.status_code,
            voice_id,
            body_preview,
        )
        raise RuntimeError(f"ElevenLabs API error ({response.status_code}): {body_preview}")
    if not response.content:
        raise RuntimeError("ElevenLabs returned empty audio.")
    return response.content


def generate_and_cache_scene_tts(session_id: str, scene_id: str, text: str) -> None:
    entry = set_scene_pending(session_id, scene_id)
    voice_id = entry.voice_id or _pick_voice_id()
    try:
        audio = synthesize_tts_stream(text=text, voice_id=voice_id)
        set_scene_ready(session_id=session_id, scene_id=scene_id, voice_id=voice_id, audio_bytes=audio)
        log.info("tts_scene_ready session_id=%s scene_id=%s voice_id=%s", session_id, scene_id, voice_id)
    except Exception as exc:
        set_scene_failed(session_id=session_id, scene_id=scene_id, voice_id=voice_id, error=str(exc))
        log.exception("tts_scene_failed session_id=%s scene_id=%s", session_id, scene_id)
        raise

