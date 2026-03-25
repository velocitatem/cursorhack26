FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app:/app/apps/backend/fastapi

# System deps - layer rarely changes
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies with the real shared library source present.
COPY pyproject.toml ./
COPY alveslib/ ./alveslib/
RUN touch README.md \
    && pip install --no-cache-dir . \
    && rm -f README.md

# Copy application source last - most frequently changed
COPY apps/backend/fastapi/ ./apps/backend/fastapi/

RUN useradd --create-home --shell /bin/bash app \
    && chown -R app:app /app
USER app
WORKDIR /app/apps/backend/fastapi

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import os,sys,urllib.request; port=os.getenv('BACKEND_PORT', os.getenv('PORT', '5000')); r=urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=3); sys.exit(0 if r.getcode() == 200 else 1)" || exit 1

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${BACKEND_PORT:-${PORT:-5000}} --no-access-log"]
