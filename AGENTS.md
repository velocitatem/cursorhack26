# UltiPlate - Agent Instructions

Scaffold for any project: webapp, API, ML pipeline, scraper, worker, CLI, or SDK. Deployable via Makefile and Docker Compose.

## Current Hackathon Context

Reference inspiration: [cursor-hackathon](https://github.com/javocruz/cursor-hackathon/tree/main)

Problem: **Make one person's hard day easier.**

One-liner: **Turn your inbox into a game you will never want to stop playing.**

This repo is currently being turned from a generic template into a hackathon project focused on email triage as a game. The active scope is not a general productivity simulator. The target experience is a short, highly demoable 3D roleplaying flow where a user connects their inbox, the system looks only at today's emails, generates a story, turns those emails into NPC scenes and branching choices, and then uses an agent to help send the final replies.

### Product Direction

- The user connects their inbox with Google auth and email permissions.
- The system fetches only today's inbox.
- An LLM builds a story around the inbox and produces structured scenes.
- Emails become NPC dialogue, choices, and a decision tree.
- The frontend renders a game world, currently leaning toward Minecraft-style primitives.
- The user picks responses through the world instead of replying in a normal inbox UI.
- The chosen route is flattened at the end and used to send the final emails.
- The run ends with a celebration screen and optionally a recap of sent emails.

### Scope Notes For Agents

- Keep the project tightly scoped to inbox gameplay.
- Favor work that makes the demo playable end to end over broad platformization.
- Optimize for a full demo under 30 seconds.
- Prefer implementation paths that support hardcoded or partially mocked scenes first, then structured generation.
- The game must actually help complete email work, not only visualize it.

### Current Build Plan

- [x] Cleanup template repo (@Daniel Alves Rosel)
- [ ] Implement Google auth with permission scope to email (@Alberto Puliga)
- [ ] Get all emails from the inbox for today (@Alberto Puliga)
- [ ] Use Minecraft as the set of primitives from `https://github.com/vyse12138/minecraft-threejs` (@Daniel Kumlin)
- [ ] First create a hardcoded world where we init the specific NPCs with the dialogue from the story generated from the LLM (@Daniel Kumlin)
- [ ] Make the speech bubbles stream while speaking with an NPC (@Daniel Kumlin)
- [ ] Make the decision UI show which option to pick (@Daniel Kumlin)
- [ ] Add logic to go through the story when speaking with an NPC (@Daniel Kumlin)
- [ ] The story needs to include the possible decision tree, the NPC dialogue, and all possible user responses based on the generated choices (@Daniel Kumlin)
- [ ] Have the ability to have multiple scenes one after the other and spawn multiple NPCs based on the prompt (@Alberto Puliga)
  - [ ] Build the builder for the structured output under route `/story/scene/` as a set of multiple requests where each request returns a scene and that scene then has a result. The frontend will send the result to the backend, which will preload the next scene.
- [ ] Have two or three services, likely email, AI, and maybe voice, even if they live under one API route set.
  - [ ] Define a tree structure where each email has options as nodes and each option can lead to subsequent ways to present the next email or next idea step. Flatten the entire route trace at the end.
- [ ] Make an agent send all emails based on the flattened structure of the decision tree (@Daniel Alves Rosel)
- [ ] Show all emails sent at the end of the game with agent support (Paulo)
- [ ] Add voice TTS to narrate NPC dialogue (@Daniel Alves Rosel)
- [ ] Make sure the product is fully demoable, iterate through the game multiple times, and keep the demo under 30 seconds. Cut time if needed. (Paulo)
- [ ] Build the intro for the city (Paulo)
- [ ] Prompt engineering (Paulo)
- [ ] Deploy on Railway (@Daniel Alves Rosel)

### Tentative Story Tree Schema

```graphql
Prompt {
  question: str
  source: dict
  response: [Response]
  id: int
}

Response {
  options: {
    slug: str
    slug: str
  }
  next: [Prompt]
}

root = [Prompt]
```

## Project Layout

```
apps/webapp/          Next.js 15 + React 19 + Tailwind 4 (Bun, Turbopack, auth optional)
apps/webapp-minimal/  Streamlit prototype
apps/backend/fastapi/ FastAPI server
apps/backend/flask/   Flask server
apps/worker/          Celery worker (Redis broker)
ml/                   PyTorch ML pipeline (arch, train, inference, etl)
alveslib/             Shared Python library: logger, scraper, agent
src/                  Simple scripts / CLI
```

## Rules for Agents

- Use `make init` to bootstrap. Use `make dev` to run webapp. Use `make help` for all targets.
- Python deps: use root `pyproject.toml` + `uv.lock`; `make envlink` propagates `.env` to sub-apps.
- JS/TS: Bun is the package manager for `apps/webapp`. Use `bun add` / `bun install` / `bun dev`.
- Do not create rogue files or test scripts outside the established structure.
- All shared Python utilities go in `alveslib/`. Import from there, never duplicate logic.
- No emojis in code, comments, or logs.

## AI / Agent SDK

`OPENAI_API_KEY` is required for AI features. `alveslib.agent` provides:

```python
from alveslib import ask, stream, Agent

ask("prompt")            # blocking one-shot
stream("prompt")         # iterator of text chunks
Agent(system="...").chat("prompt")  # multi-turn
```

For full agentic loops with file/bash tools, use the Claude Agent SDK:
```bash
pip install claude-agent-sdk
```
```python
from claude_agent_sdk import query, ClaudeAgentOptions
async for msg in query(prompt="...", options=ClaudeAgentOptions(allowed_tools=["Read","Bash"])):
    print(msg)
```

## Slash Commands (.claude/commands/)

Use in Claude Code sessions (type `/`):
- `/plan` - plan an implementation within this boilerplate
- `/build` - implement a feature end-to-end
- `/api` - scaffold a backend endpoint
- `/page` - scaffold a Next.js page
- `/review` - review recent changes
- `/ship` - commit staged changes
