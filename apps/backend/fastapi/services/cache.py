from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import json
import logging
import os
from threading import Lock
from typing import Any

try:
    from redis import Redis
    from redis.exceptions import RedisError
except ModuleNotFoundError:
    Redis = None  # type: ignore[assignment]

    class RedisError(Exception):
        pass

log = logging.getLogger(__name__)

DEFAULT_TTL_SECONDS = 3600


@dataclass
class _MemEntry:
    value: bytes
    expires_at: datetime


_MEM_CACHE: dict[str, _MemEntry] = {}
_MEM_LOCK = Lock()
_REDIS_CLIENT: Redis | None = None


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _ttl_from_env(var_name: str, default: int = DEFAULT_TTL_SECONDS) -> int:
    raw = os.getenv(var_name, str(default))
    try:
        return max(60, int(raw))
    except ValueError:
        return default


def _use_redis() -> bool:
    return os.getenv("CACHE_USE_REDIS", "true").lower() in {"1", "true", "yes", "on"}


def get_redis_client() -> Redis | None:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    if not _use_redis():
        return None
    redis_url = os.getenv("REDIS_URL", "").strip()
    if not redis_url:
        return None
    if Redis is None:
        log.warning("redis_package_missing_fallback_to_memory")
        return None
    try:
        client = Redis.from_url(redis_url, decode_responses=False)
        client.ping()
        _REDIS_CLIENT = client
        return _REDIS_CLIENT
    except RedisError:
        log.warning("redis_unavailable url=%s", redis_url, exc_info=True)
        return None


def _mem_get(key: str) -> bytes | None:
    with _MEM_LOCK:
        entry = _MEM_CACHE.get(key)
        if entry is None:
            return None
        if entry.expires_at <= _now_utc():
            del _MEM_CACHE[key]
            return None
        return entry.value


def _mem_set(key: str, value: bytes, ttl_seconds: int) -> None:
    with _MEM_LOCK:
        _MEM_CACHE[key] = _MemEntry(value=value, expires_at=_now_utc() + timedelta(seconds=ttl_seconds))


def get_bytes(key: str) -> bytes | None:
    client = get_redis_client()
    if client is not None:
        try:
            data = client.get(key)
            if data is not None:
                return bytes(data)
        except RedisError:
            log.warning("redis_get_failed key=%s", key, exc_info=True)
    return _mem_get(key)


def set_bytes(key: str, value: bytes, ttl_seconds: int) -> None:
    client = get_redis_client()
    if client is not None:
        try:
            client.setex(key, ttl_seconds, value)
            return
        except RedisError:
            log.warning("redis_set_failed key=%s", key, exc_info=True)
    _mem_set(key, value=value, ttl_seconds=ttl_seconds)


def get_json(key: str) -> dict[str, Any] | list[Any] | None:
    raw = get_bytes(key)
    if raw is None:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        log.warning("cache_json_decode_failed key=%s", key, exc_info=True)
        return None


def set_json(key: str, value: dict[str, Any] | list[Any], ttl_seconds: int) -> None:
    payload = json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    set_bytes(key=key, value=payload, ttl_seconds=ttl_seconds)


def delete_keys(*keys: str) -> None:
    client = get_redis_client()
    if client is not None:
        try:
            client.delete(*keys)
        except RedisError:
            log.warning("redis_delete_failed keys=%s", keys, exc_info=True)
    with _MEM_LOCK:
        for key in keys:
            _MEM_CACHE.pop(key, None)


def openai_cache_ttl_seconds() -> int:
    return _ttl_from_env("OPENAI_CACHE_TTL_SECONDS", default=900)


def tts_cache_ttl_seconds() -> int:
    return _ttl_from_env("TTS_CACHE_TTL_SECONDS", default=DEFAULT_TTL_SECONDS)
