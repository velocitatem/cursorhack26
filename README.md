# Ultiplate

Template for any project: SaaS webapp, API server, ML pipeline, scraper, CLI, or background worker. AI-native, platform-agnostic, managed via Makefile + Nx.

## Current Hackathon Idea

Reference inspiration: [cursor-hackathon](https://github.com/javocruz/cursor-hackathon/tree/main)

Problem: **Make one person's hard day easier.**

One-liner: **Turn your inbox into a game you will never want to stop playing.**

### Product Direction

This repo is being adapted from the template into a game-like email triage experience. The current direction is to turn a user's inbox into a short roleplaying world where emails become scenes, NPCs, and branching choices that guide the user toward responding faster with less friction.

The broader brainstorm included ideas like mapping someone's life for optimizations, teaching someone how to make coffee, minimizing waiting in queues or at red lights, a todo list as an agentic 3D simulation, Recycle Flox, and Subway Surfers for coding apps. The scoped direction for this repo is the inbox game.

### High-Level User Flow

1. Connect the user's inbox with Google auth and email permissions.
2. Pull only today's emails.
3. Generate a story that frames the inbox as a game world.
4. Convert each email into structured response opportunities and pass them to an LLM.
5. Present the work as a sequence of scenes with NPC dialogue and player choices.
6. Let the user progress through the inbox by choosing responses in-game.
7. Send the final email outputs through an agent based on the flattened decision path.
8. End with a celebration screen and optionally show all sent emails.

### Example Interaction

One concrete interaction is a "door game" for email replies: each door represents a possible response to an email. The player picks a door, sees the next part of the story, and advances through the inbox while the system keeps track of the selected branch.

### Delivery Notes

- Tighten scope around email first, not a general productivity game.
- The game should not just visualize work; it should help complete the email replies.
- The demo should be fully playable in under 30 seconds.
- Minecraft-style primitives from `minecraft-threejs` are the current visual direction for the world.

### Current TODO

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

### Tentative Tree Schema

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

## Quick Start

```bash
cp .env.example .env        # fill in NAME and any keys you need
make init                   # uv venv + sync + env linking
make dev                    # Next.js webapp at http://localhost:3000
make nx.projects            # list Nx projects in the monorepo
```

For Docker services (redis, ml inference, worker):
```bash
make up
```

## Directory

```
apps/
  webapp/          Next.js 15 + React 19 + Tailwind 4 + Supabase auth (Bun, Turbopack)
  webapp-minimal/  Streamlit quick prototype
  backend/
    fastapi/       FastAPI server (set BACKEND_MODE=fastapi)
    flask/         Flask server  (set BACKEND_MODE=flask)
  worker/          Celery background worker backed by Redis
ml/
  configs/         YAML config for data + training hyperparameters
  models/          arch.py (architecture) + train.py (training loop)
  data/            etl.py + processed artifacts
  inference.py     FastAPI inference server
  notebooks/       Jupyter notebooks
alveslib/          Shared Python utilities (logger, scraper, agent)
src/               Simple scripts / CLI entry points
```

## Make Targets

| Target | Description |
|--------|-------------|
| `make init` | First-time setup |
| `make dev` | Start Next.js webapp |
| `make up` | Start Docker core services |
| `make run.backend` | Start API backend |
| `make run.worker` | Start Celery worker |
| `make nx.graph` | Open Nx project graph |
| `make nx.affected` | Run lint/test/build for affected projects |
| `make lift.minio` | Start MinIO object storage |
| `make lift.logging` | Start Loki + Grafana |
| `make lift.mlflow` | Start optional MLflow server |
| `make lift.database` | Start Postgres / MongoDB |
| `make doctor` | Verify toolchain |

Run `make help` for the full list.

## Nx Workspace

This template now ships with Nx project definitions for:

- `webapp` (`apps/webapp`)
- `webapp-minimal` (`apps/webapp-minimal`)
- `backend-fastapi` (`apps/backend/fastapi`)
- `backend-flask` (`apps/backend/flask`)
- `worker` (`apps/worker`)
- `ml` (`ml`)
- `alveslib` (`alveslib`)

Common commands:

```bash
bun x nx show projects
bun x nx graph
bun x nx run webapp:dev
bun x nx affected -t lint,test,build
```

## AI Agent Capacity

Set `ANTHROPIC_API_KEY` in `.env`. Then use:

```python
from alveslib import ask, stream, Agent

# One-shot
print(ask("Summarize this data: ..."))

# Streaming
for chunk in stream("Write a Celery task that ..."):
    print(chunk, end="", flush=True)

# Multi-turn
agent = Agent(system="You are a senior Python developer.")
agent.chat("Scaffold a FastAPI endpoint for user profiles")
agent.chat("Add input validation and error handling")
```

Claude Code slash commands (type `/` in a Claude Code session):
- `/plan` - implementation plan for an idea within this boilerplate
- `/build` - implement a feature end-to-end
- `/api` - scaffold a new backend endpoint
- `/page` - scaffold a new Next.js page
- `/review` - code review of recent changes
- `/ship` - stage and commit changes

## Logging

```python
from alveslib import get_logger
logger = get_logger("service")
```

Outputs structured JSON to console + `./logs/`. Optional Loki push when `LOKI_PORT` is set and `make lift.logging` is running. View in Grafana at `http://localhost:$GRAFANA_PORT` (add Loki data source: `http://loki:3100`).

## Python Packaging

Python dependencies are managed with `pyproject.toml` and `uv`.

```bash
make deps         # uv sync
make lock         # refresh uv.lock
uv run pytest -v
```

## ML Workflow

High-level ML hyperparameters live in YAML configs:

- `ml/configs/data/default.yaml`
- `ml/configs/train/default.yaml`

Run with Nx targets (cacheable with explicit inputs/outputs):

```bash
bun x nx run ml:etl
bun x nx run ml:train
```

`ml:train` depends on `ml:etl`, and both targets cache artifacts in `ml/data/processed`, `ml/models/weights`, and `ml/tensorboard`.

## Services (docker compose profiles)

| Profile | Services | Command |
|---------|----------|---------|
| _(default)_ | redis, ml-inference, worker | `make up` |
| `minio` | + MinIO object storage | `make lift.minio` |
| `tensorboard` | + TensorBoard | `make lift.tensorboard` |
| `mlflow` | + MLflow tracking server (optional) | `make lift.mlflow` |
| `logging` | + Loki + Grafana | `make lift.logging` |
| `database` | + Postgres + MongoDB | `make lift.database` |

## Webapp Auth

Auth is off by default (`NEXT_PUBLIC_REQUIRE_AUTH=false`). Set it to `true` and configure Supabase keys to enable session-based auth gating across all routes.
