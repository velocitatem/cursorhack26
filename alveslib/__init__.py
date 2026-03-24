from .agent import ask, stream, ask_async, stream_async, Agent
from .logger import get_logger

try:
    from .telemetry import configure_fastapi_observability, configure_worker_observability
except ModuleNotFoundError as exc:
    _telemetry_import_error = exc

    def configure_fastapi_observability(*args, **kwargs):  # type: ignore[no-redef]
        raise ModuleNotFoundError(
            "Telemetry dependencies are missing. Install project dependencies to use "
            "`configure_fastapi_observability`."
        ) from _telemetry_import_error

    def configure_worker_observability(*args, **kwargs):  # type: ignore[no-redef]
        raise ModuleNotFoundError(
            "Telemetry dependencies are missing. Install project dependencies to use "
            "`configure_worker_observability`."
        ) from _telemetry_import_error

__all__ = [
    "get_logger",
    "ask",
    "stream",
    "ask_async",
    "stream_async",
    "Agent",
    "configure_fastapi_observability",
    "configure_worker_observability",
]
