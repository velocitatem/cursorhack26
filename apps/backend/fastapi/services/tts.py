from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
import logging
import os
import random
from threading import Lock

import requests

log = logging.getLogger(__name__)

ELEVENLABS_URL_TEMPLATE = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
DEFAULT_MODEL_ID = "eleven_multilingual_v2"
DEFAULT_MAX_TEXT_CHARS = 1400
DEFAULT_CACHE_TTL_SECONDS = 3600


@dataclass
class SceneTTSCacheEntry:
    status: str = "pending"
    voice_id: str | None = None
    audio_bytes: bytes | None = None
    error: str | None = None
    updated_at: datetime = field(default_factory=datetime.utcnow)


_CACHE: dict[tuple[str, str], SceneTTSCacheEntry] = {}
_LOCK = Lock()


def _cache_key(session_id: str, scene_id: str) -> tuple[str, str]:
    return (session_id, scene_id)


def _cache_ttl_seconds() -> int:
    raw = os.getenv("TTS_CACHE_TTL_SECONDS", str(DEFAULT_CACHE_TTL_SECONDS))
    try:
        return max(int(raw), 60)
    except ValueError:
        return DEFAULT_CACHE_TTL_SECONDS


def _max_text_chars() -> int:
    raw = os.getenv("TTS_MAX_TEXT_CHARS", str(DEFAULT_MAX_TEXT_CHARS))
    try:
        return max(int(raw), 200)
    except ValueError:
        return DEFAULT_MAX_TEXT_CHARS


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


def _prune_cache() -> None:
    ttl = timedelta(seconds=_cache_ttl_seconds())
    cutoff = datetime.utcnow() - ttl
    with _LOCK:
        stale = [k for k, v in _CACHE.items() if v.updated_at < cutoff]
        for key in stale:
            del _CACHE[key]


def scene_tts_url(session_id: str, scene_id: str) -> str:
    return f"/story/scene/{session_id}/{scene_id}/tts"


def ensure_scene_entry(session_id: str, scene_id: str) -> SceneTTSCacheEntry:
    _prune_cache()
    key = _cache_key(session_id, scene_id)
    with _LOCK:
        existing = _CACHE.get(key)
        if existing is not None:
            if not existing.voice_id:
                existing.voice_id = _pick_voice_id()
                existing.updated_at = datetime.utcnow()
            return existing
        voice_id = _pick_voice_id()
        created = SceneTTSCacheEntry(status="pending", voice_id=voice_id)
        _CACHE[key] = created
        return created


def set_scene_pending(session_id: str, scene_id: str) -> SceneTTSCacheEntry:
    entry = ensure_scene_entry(session_id, scene_id)
    with _LOCK:
        entry.status = "pending"
        entry.error = None
        entry.audio_bytes = None
        entry.updated_at = datetime.utcnow()
    return entry


def get_scene_entry(session_id: str, scene_id: str) -> SceneTTSCacheEntry | None:
    _prune_cache()
    key = _cache_key(session_id, scene_id)
    with _LOCK:
        return _CACHE.get(key)


def set_scene_ready(session_id: str, scene_id: str, voice_id: str, audio_bytes: bytes) -> None:
    key = _cache_key(session_id, scene_id)
    with _LOCK:
        entry = _CACHE.get(key) or SceneTTSCacheEntry()
        entry.status = "ready"
        entry.voice_id = voice_id
        entry.audio_bytes = audio_bytes
        entry.error = None
        entry.updated_at = datetime.utcnow()
        _CACHE[key] = entry


def set_scene_failed(session_id: str, scene_id: str, voice_id: str, error: str) -> None:
    key = _cache_key(session_id, scene_id)
    with _LOCK:
        entry = _CACHE.get(key) or SceneTTSCacheEntry()
        entry.status = "failed"
        entry.voice_id = voice_id
        entry.audio_bytes = None
        entry.error = error
        entry.updated_at = datetime.utcnow()
        _CACHE[key] = entry


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

