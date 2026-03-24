FROM python:3.12-slim

WORKDIR /app

# System deps - layer rarely changes
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install external dependencies only - layer cached until pyproject.toml changes
COPY pyproject.toml ./
RUN touch README.md \
    && mkdir -p alveslib && touch alveslib/__init__.py \
    && pip install --no-cache-dir . \
    && rm -rf alveslib README.md

# Copy local library and reinstall it without re-downloading external deps
COPY alveslib/ ./alveslib/
RUN pip install --no-cache-dir --no-deps .

# Copy application source last - most frequently changed
COPY apps/backend/fastapi/ ./apps/backend/fastapi/

RUN useradd --create-home --shell /bin/bash app \
    && chown -R app:app /app
USER app
WORKDIR /app/apps/backend/fastapi

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import sys,urllib.request; r=urllib.request.urlopen('http://127.0.0.1:5000/health', timeout=3); sys.exit(0 if r.getcode() == 200 else 1)" || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "5000"]
