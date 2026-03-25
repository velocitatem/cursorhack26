"""
Thin async + sync wrappers over the OpenAI SDK for quick scripting and agent
patterns. Use this when you want direct API access with streaming; for full
agentic loops with file tools use `claude-agent-sdk` (pip install claude-agent-sdk).

Usage:
    from alveslib.agent import ask, stream, Agent

    # One-shot
    reply = ask("Summarize this data: ...")

    # Streaming to stdout
    stream("Write a FastAPI endpoint that ...")

    # Multi-turn agent
    agent = Agent(system="You are an expert Python dev.")
    reply = agent.chat("Generate a Celery task that processes CSV files")
    follow = agent.chat("Now add error handling and retries")
"""

import os
import asyncio
from typing import Iterator, AsyncIterator

try:
    import openai

    _client: openai.OpenAI | None = openai.OpenAI(
        api_key=os.environ.get("OPENAI_API_KEY")
    )
    _async_client: openai.AsyncOpenAI | None = openai.AsyncOpenAI(
        api_key=os.environ.get("OPENAI_API_KEY")
    )
except ImportError:
    _client = None
    _async_client = None


DEFAULT_MODEL = "gpt-4o"


def _require_client() -> "openai.OpenAI":
    if _client is None:
        raise ImportError("pip install openai")
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY not set")
    return _client


def ask(prompt: str, system: str = "", model: str = DEFAULT_MODEL) -> str:
    """One-shot blocking request; returns full text."""
    client = _require_client()
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    msg = client.chat.completions.create(
        model=model,
        messages=messages,
    )
    return msg.choices[0].message.content or ""


def stream(prompt: str, system: str = "", model: str = DEFAULT_MODEL) -> Iterator[str]:
    """Streaming generator; yields text deltas. Print as they arrive."""
    client = _require_client()
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    stream_resp = client.chat.completions.create(
        model=model,
        messages=messages,
        stream=True,
    )
    for chunk in stream_resp:
        content = chunk.choices[0].delta.content
        if content is not None:
            yield content


async def ask_async(prompt: str, system: str = "", model: str = DEFAULT_MODEL) -> str:
    """Async one-shot request."""
    if _async_client is None:
        raise ImportError("pip install openai")
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    msg = await _async_client.chat.completions.create(
        model=model,
        messages=messages,
    )
    return msg.choices[0].message.content or ""


async def stream_async(
    prompt: str, system: str = "", model: str = DEFAULT_MODEL
) -> AsyncIterator[str]:
    """Async streaming generator."""
    if _async_client is None:
        raise ImportError("pip install openai")
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    stream_resp = await _async_client.chat.completions.create(
        model=model,
        messages=messages,
        stream=True,
    )
    async for chunk in stream_resp:
        content = chunk.choices[0].delta.content
        if content is not None:
            yield content


class Agent:
    """Stateful multi-turn conversation agent with optional system prompt."""

    def __init__(self, system: str = "", model: str = DEFAULT_MODEL):
        self.system = system
        self.model = model
        self.history: list[dict] = []
        if self.system:
            self.history.append({"role": "system", "content": self.system})

    def chat(self, prompt: str) -> str:
        client = _require_client()
        self.history.append({"role": "user", "content": prompt})
        msg = client.chat.completions.create(
            model=self.model,
            messages=self.history,
        )
        reply = msg.choices[0].message.content or ""
        self.history.append({"role": "assistant", "content": reply})
        return reply

    async def chat_async(self, prompt: str) -> str:
        if _async_client is None:
            raise ImportError("pip install openai")
        self.history.append({"role": "user", "content": prompt})
        msg = await _async_client.chat.completions.create(
            model=self.model,
            messages=self.history,
        )
        reply = msg.choices[0].message.content or ""
        self.history.append({"role": "assistant", "content": reply})
        return reply

    def reset(self) -> None:
        self.history.clear()
        if self.system:
            self.history.append({"role": "system", "content": self.system})
