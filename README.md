# Inbox Quest

Turn your inbox into a short 3D RPG run where every NPC interaction becomes a real, reviewable email reply.

This repository is a hackathon project focused on one thing only: fully functional Gmail triage through gameplay. There is no demo bypass mode in the runtime flow.

## What it does

- Authenticates the user with Google OAuth.
- Reads only today's inbox messages from Gmail.
- Builds a story/scene graph where emails become NPC dialogue and branching choices.
- Lets the player resolve each thread in a Three.js Minecraft-style world.
- Flattens the chosen route into drafted replies.
- Sends replies only after explicit user review and confirmation.

## Quick start

1. Copy environment variables and fill required secrets:

```bash
cp .env.example .env
```

2. Configure Google OAuth in GCP:

- Add `http://localhost:9812/auth/google/callback` as an authorized redirect URI.
- Add the deployed backend callback URL as well for production.
- Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.

3. Set required API keys in `.env`:

- `OPENAI_API_KEY` (required for scene + draft generation)
- `ELEVENLABS_API_KEY` (required for TTS)

4. Install dependencies and run local services:

```bash
make init
make up
make dev
```

- Web app: `http://localhost:5173`
- Backend API: `http://localhost:9812`

## Main stack

- Frontend: Vite + React 19 + Three.js
- Backend: FastAPI (Python)
- Auth + Mail: Google OAuth + Gmail API
- AI: OpenAI chat completions + structured outputs
- Voice: ElevenLabs
- Infra: Docker Compose locally, Railway for deployment

## Repository layout

- `apps/webapp/` - 3D gameplay client and review/send UI
- `apps/backend/fastapi/` - auth, story generation, draft resolution, send endpoints
- `apps/worker/` - background worker scaffold
- `alveslib/` - shared Python utilities

## Core API routes

- `GET /auth/google/login`
- `GET /auth/google/callback`
- `GET /auth/session`
- `POST /story/scene/preview`
- `POST /story/scene/start`
- `POST /story/scene/{session_id}/advance`
- `POST /story/scene/{session_id}/resolve`
- `POST /story/scene/{session_id}/send/{email_id}`

## Development notes

- `STORY_WORLD_HUB_MODE=true` keeps gameplay in a single shared hub with multiple NPCs.
- OAuth + Gmail credentials are required for end-to-end runtime behavior.
- Replies are never sent automatically; user confirmation is mandatory.
