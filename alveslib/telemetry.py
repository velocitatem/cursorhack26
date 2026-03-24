from __future__ import annotations

import logging
import os
from typing import Any

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

_LOGGING_INSTRUMENTED = False
_REQUESTS_INSTRUMENTED = False
_FASTAPI_INSTRUMENTED: set[int] = set()


def _sdk_disabled() -> bool:
    return os.getenv("OTEL_SDK_DISABLED", "").lower() in ("true", "1", "yes")


def _ensure_root_logging(level: int = logging.INFO) -> None:
    root = logging.getLogger()
    if not root.handlers:
        logging.basicConfig(
            level=level,
            format="%(levelname)s %(name)s %(message)s",
        )


def _tracer_provider(service_name: str) -> TracerProvider:
    current = trace.get_tracer_provider()
    if isinstance(current, TracerProvider):
        return current
    name = os.getenv("OTEL_SERVICE_NAME", service_name)
    resource = Resource.create({"service.name": name})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter()
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    return provider


def _instrument_logging() -> None:
    global _LOGGING_INSTRUMENTED
    if _LOGGING_INSTRUMENTED:
        return
    LoggingInstrumentor().instrument(set_logging_format=True)
    _LOGGING_INSTRUMENTED = True


def _instrument_requests() -> None:
    global _REQUESTS_INSTRUMENTED
    if _REQUESTS_INSTRUMENTED:
        return
    RequestsInstrumentor().instrument()
    _REQUESTS_INSTRUMENTED = True


def configure_worker_observability(service_name: str = "worker") -> None:
    if _sdk_disabled():
        _ensure_root_logging()
        return
    _ensure_root_logging()
    _tracer_provider(service_name)
    _instrument_logging()


def configure_fastapi_observability(app: Any, service_name: str = "backend-fastapi") -> None:
    if _sdk_disabled():
        _ensure_root_logging()
        return
    _ensure_root_logging()
    _tracer_provider(service_name)
    _instrument_logging()
    _instrument_requests()
    app_id = id(app)
    if app_id in _FASTAPI_INSTRUMENTED:
        return
    FastAPIInstrumentor.instrument_app(app)
    _FASTAPI_INSTRUMENTED.add(app_id)
