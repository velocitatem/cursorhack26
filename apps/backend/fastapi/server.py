from contextlib import asynccontextmanager
import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from alveslib.telemetry import configure_fastapi_observability
from routes.story import router as story_router

load_dotenv()

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("backend_fastapi_start")
    yield
    log.info("backend_fastapi_shutdown")


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "healthy"}


app.include_router(story_router)

configure_fastapi_observability(app, service_name="backend-fastapi")

if __name__ == "__main__":
    PORT = int(os.getenv("BACKEND_PORT", 5000))
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=PORT,
        reload=True,
        access_log=False,
    )
