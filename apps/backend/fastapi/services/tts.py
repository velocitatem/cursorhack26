from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
import hashlib
import logging
import os
import random
import time
from threading import Lock
from typing import Any

import requests

from services.cache import delete_keys, get_bytes, get_json, set_bytes, set_json, tts_cache_ttl_seconds

log = logging.getLogger(__name__)

ELEVENLABS_URL_TEMPLATE = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
ELEVENLABS_VOICES_URL = "https://api.elevenlabs.io/v1/voices?show_legacy=true"
DEFAULT_MODEL_ID = "eleven_multilingual_v2"
DEFAULT_MAX_TEXT_CHARS = 1400
VOICE_CATALOG_TTL_SECONDS = 300


@dataclass
class SceneTTSCacheEntry:
    status: str = "pending"
    voice_id: str | None = None
    audio_bytes: bytes | None = None
    error: str | None = None
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))


_CACHE: dict[tuple[str, str], SceneTTSCacheEntry] = {}
_LOCK = Lock()
_VOICE_POOL_LOCK = Lock()
_FREE_TIER_VOICE_POOL: list[str] | None = None
_FREE_TIER_VOICE_POOL_EXPIRES_AT = 0.0
_VOICE_DENYLIST: set[str] = set()


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


def _is_free_tier_voice(voice: dict[str, Any]) -> bool:
    if str(voice.get("category", "")).lower() != "premade":
        return False
    tiers = [str(tier).lower() for tier in voice.get("available_for_tiers") or []]
    return not tiers or any("free" in tier for tier in tiers)


def _refresh_free_tier_voice_pool() -> list[str]:
    configured = list(dict.fromkeys(_parse_voice_pool()))
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        return configured
    response = requests.get(
        ELEVENLABS_VOICES_URL,
        headers={"xi-api-key": api_key},
        timeout=15,
    )
    response.raise_for_status()
    payload = response.json()
    voices = payload.get("voices", []) if isinstance(payload, dict) else []
    if not isinstance(voices, list):
        return configured
    voices_by_id = {
        str(voice.get("voice_id")): voice
        for voice in voices
        if isinstance(voice, dict) and voice.get("voice_id")
    }
    filtered = [
        voice_id
        for voice_id in configured
        if _is_free_tier_voice(voices_by_id.get(voice_id, {}))
    ]
    if filtered:
        return filtered
    return list(
        dict.fromkeys(
            str(voice.get("voice_id"))
            for voice in voices
            if isinstance(voice, dict) and voice.get("voice_id") and _is_free_tier_voice(voice)
        )
    )


def _free_tier_voice_pool() -> list[str]:
    global _FREE_TIER_VOICE_POOL, _FREE_TIER_VOICE_POOL_EXPIRES_AT
    now = time.monotonic()
    with _VOICE_POOL_LOCK:
        if _FREE_TIER_VOICE_POOL is not None and now < _FREE_TIER_VOICE_POOL_EXPIRES_AT:
            return [voice_id for voice_id in _FREE_TIER_VOICE_POOL if voice_id not in _VOICE_DENYLIST]
    try:
        voice_pool = _refresh_free_tier_voice_pool()
    except requests.RequestException:
        log.warning("elevenlabs_voice_catalog_request_failed", exc_info=True)
        voice_pool = _parse_voice_pool()
    except Exception:
        log.warning("elevenlabs_voice_catalog_failed", exc_info=True)
        voice_pool = _parse_voice_pool()
    cached = list(dict.fromkeys(voice_pool))
    with _VOICE_POOL_LOCK:
        _FREE_TIER_VOICE_POOL = cached
        _FREE_TIER_VOICE_POOL_EXPIRES_AT = now + VOICE_CATALOG_TTL_SECONDS
    return [voice_id for voice_id in cached if voice_id not in _VOICE_DENYLIST]


def _mark_voice_unavailable(voice_id: str) -> None:
    _VOICE_DENYLIST.add(voice_id)
    with _VOICE_POOL_LOCK:
        if _FREE_TIER_VOICE_POOL is not None:
            _FREE_TIER_VOICE_POOL[:] = [cached_id for cached_id in _FREE_TIER_VOICE_POOL if cached_id != voice_id]


def _voice_candidates(exclude: set[str] | None = None) -> list[str]:
    blocked = _VOICE_DENYLIST | (exclude or set())
    voices = [voice_id for voice_id in _free_tier_voice_pool() if voice_id not in blocked]
    if not voices:
        voices = [voice_id for voice_id in _parse_voice_pool() if voice_id not in blocked]
    if not voices:
        raise RuntimeError("No ElevenLabs voice configured. Set ELEVENLABS_VOICE_IDS or ELEVENLABS_VOICE_ID.")
    return voices


def _pick_voice_id(exclude: set[str] | None = None, stable_key: str | None = None) -> str:
    voices = _voice_candidates(exclude=exclude)
    if stable_key:
        digest = hashlib.sha256(stable_key.encode("utf-8")).digest()
        index = int.from_bytes(digest[:8], "big") % len(voices)
        return voices[index]
    return random.choice(voices)


def _is_paid_plan_voice_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "paid_plan_required" in message or "free users cannot use library voices via the api" in message


def _is_quota_exhausted(exc: Exception) -> bool:
    message = str(exc).lower()
    return "quota_exceeded" in message or "api error (401)" in message or "api error (402)" in message


def scene_tts_url(session_id: str, scene_id: str) -> str:
    return f"/story/scene/{session_id}/{scene_id}/tts"


def _ensure_entry(session_id: str, scene_id: str, voice_key: str | None = None) -> SceneTTSCacheEntry:
    key = _cache_key(session_id, scene_id)
    with _LOCK:
        existing = _CACHE.get(key)
        if existing is not None:
            if not existing.voice_id:
                existing.voice_id = _pick_voice_id(stable_key=voice_key)
                existing.updated_at = datetime.now(UTC)
                _write_entry(session_id=session_id, scene_id=scene_id, entry=existing)
            return existing
        cached = _read_entry(session_id=session_id, scene_id=scene_id)
        if cached is not None:
            if not cached.voice_id:
                cached.voice_id = _pick_voice_id(stable_key=voice_key)
                cached.updated_at = datetime.now(UTC)
                _write_entry(session_id=session_id, scene_id=scene_id, entry=cached)
            _CACHE[key] = cached
            return cached
        voice_id = _pick_voice_id(stable_key=voice_key)
        created = SceneTTSCacheEntry(status="pending", voice_id=voice_id)
        _CACHE[key] = created
        _write_entry(session_id=session_id, scene_id=scene_id, entry=created)
        return created


def ensure_scene_entry(session_id: str, scene_id: str) -> SceneTTSCacheEntry:
    return _ensure_entry(session_id=session_id, scene_id=scene_id)


def ensure_speaker_entry(session_id: str, scene_id: str, voice_key: str) -> SceneTTSCacheEntry:
    return _ensure_entry(session_id=session_id, scene_id=scene_id, voice_key=voice_key)


def set_scene_pending(session_id: str, scene_id: str, voice_key: str | None = None) -> SceneTTSCacheEntry:
    entry = _ensure_entry(session_id=session_id, scene_id=scene_id, voice_key=voice_key)
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


def generate_and_cache_scene_tts(
    session_id: str,
    scene_id: str,
    text: str,
    voice_key: str | None = None,
) -> None:
    existing = get_scene_entry(session_id=session_id, scene_id=scene_id)
    if existing is not None and existing.status == "ready":
        return
    entry = set_scene_pending(session_id, scene_id, voice_key=voice_key)
    attempted_voice_ids: set[str] = set()
    voice_id = entry.voice_id or _pick_voice_id(stable_key=voice_key)
    while True:
        attempted_voice_ids.add(voice_id)
        try:
            audio = synthesize_tts_stream(text=text, voice_id=voice_id)
            set_scene_ready(session_id=session_id, scene_id=scene_id, voice_id=voice_id, audio_bytes=audio)
            log.info("tts_scene_ready session_id=%s scene_id=%s voice_id=%s", session_id, scene_id, voice_id)
            return
        except Exception as exc:
            if _is_paid_plan_voice_error(exc):
                _mark_voice_unavailable(voice_id)
                try:
                    next_voice_id = _pick_voice_id(exclude=attempted_voice_ids, stable_key=voice_key)
                except RuntimeError:
                    next_voice_id = ""
                if next_voice_id:
                    log.warning(
                        "tts_scene_retrying_free_tier_voice session_id=%s scene_id=%s voice_id=%s next_voice_id=%s",
                        session_id,
                        scene_id,
                        voice_id,
                        next_voice_id,
                    )
                    voice_id = next_voice_id
                    continue
            set_scene_failed(session_id=session_id, scene_id=scene_id, voice_id=voice_id, error=str(exc))
            if _is_quota_exhausted(exc):
                log.warning("tts_scene_quota_exhausted_skipped session_id=%s scene_id=%s", session_id, scene_id)
                return
            log.exception("tts_scene_failed session_id=%s scene_id=%s", session_id, scene_id)
            raise
