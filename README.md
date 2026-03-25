# Inbox RPG
Turn your daily email triage into a 3D roleplaying game you will actually want to play.

## What it does
Inbox RPG reimagines email triage by turning your inbox into an interactive 3D world. Instead of grinding through a standard email client, you connect your Gmail and step into a game where today's emails are presented as NPCs. 

You progress through your inbox by talking to characters and selecting dialogue choices. Every choice translates to an actual email reply sent by an AI agent. 

## Why it matters
Email is a chore. By framing your inbox as a short, structured game with concrete scenes and branching choices, we remove the friction of staring at an empty reply box. It turns one person's hard day into a 30-second playable loop that actually gets work done.

## Quick start
Get the local environment and web app running:

```bash
cp .env.example .env        # Add your ANTHROPIC_API_KEY and other vars
make init                   # Create uv venv, sync dependencies, and link envs
make up                     # Start local backend services (Redis, Postgres)
make dev                    # Start the Next.js webapp at http://localhost:3000
```

## How it works
The system fetches your unread emails for the day and uses an LLM to generate a story. It structures this data into a decision tree where each email represents an interaction node:

1. **Generation:** Emails are converted into structured NPC dialogue and player response choices.
2. **Gameplay:** The frontend renders a 3D environment using Minecraft-style primitives (`minecraft-threejs`). You interact with the world to choose your responses.
3. **Execution:** The chosen route is flattened at the end of the run and an agent dispatches the final email replies.

## Repository layout
This is an Nx-managed monorepo with dedicated apps for the frontend, backend, and background workers:

| Path | Purpose |
|------|---------|
| `apps/webapp/` | Next.js 15, React 19, Tailwind 4 frontend with Three.js |
| `apps/backend/fastapi/` | FastAPI server for handling story generation and email dispatch |
| `apps/worker/` | Celery background worker backed by Redis |
| `alveslib/` | Shared Python utilities (logger, agent SDK) |
| `ml/` | AI pipelines and inference servers |

## Configuration
Essential environment variables for the core game loop:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Required to power the AI agent and scene generation |
| `NEXT_PUBLIC_REQUIRE_AUTH` | Set to `true` to enable session-based auth gating |
| `BACKEND_MODE` | Set to `fastapi` to route requests correctly |
