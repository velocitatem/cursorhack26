from contextlib import asynccontextmanager
import os
from pathlib import Path

from alveslib import configure_fastapi_observability, get_logger
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
import uvicorn

from config import get_settings
from routes.auth import router as auth_router
from routes.story import router as story_router
from services.auth.google_client import GoogleOAuthClient
from services.auth.user_repository import AuthRepository

load_dotenv()

log = get_logger("backend-fastapi")
WEBAPP_DIST_DIR = Path(__file__).resolve().parents[2] / "webapp-dist"


def create_app(
    *,
    settings=None,
    auth_repository=None,
    google_client=None,
    bootstrap_db: bool = True,
) -> FastAPI:
    settings = settings or get_settings()
    auth_repository = auth_repository or AuthRepository(settings)
    google_client = google_client or GoogleOAuthClient(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        log.info("backend_fastapi_start")
        if bootstrap_db:
            auth_repository.bootstrap_schema()
        yield
        log.info("backend_fastapi_shutdown")

    app = FastAPI(lifespan=lifespan)
    app.state.settings = settings
    app.state.auth_repository = auth_repository
    app.state.google_client = google_client

    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.app_secret_key,
        session_cookie="oauth_state",
        same_site=settings.session_cookie_same_site,
        https_only=settings.session_cookie_secure,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.webapp_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health():
        return {"status": "healthy"}

    app.include_router(auth_router)
    app.include_router(story_router)

    if WEBAPP_DIST_DIR.exists():
        assets_dir = WEBAPP_DIST_DIR / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="webapp-assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_webapp(full_path: str):
            if full_path.startswith(("auth/", "story/", "health")):
                return FileResponse(WEBAPP_DIST_DIR / "index.html")

            candidate = (WEBAPP_DIST_DIR / full_path).resolve()
            if full_path and candidate.is_file() and WEBAPP_DIST_DIR in candidate.parents:
                return FileResponse(candidate)

            return FileResponse(WEBAPP_DIST_DIR / "index.html")

    configure_fastapi_observability(app, service_name="backend-fastapi")
    return app


app = create_app()

if __name__ == "__main__":
    PORT = int(os.getenv("BACKEND_PORT", os.getenv("PORT", 5000)))
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=PORT,
        reload=True,
        access_log=False,
    )
