FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app:/app/apps/backend/fastapi

RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY alveslib/ ./alveslib/
RUN touch README.md \
    && pip install --no-cache-dir . \
    && rm -f README.md

COPY apps/backend/fastapi/ ./apps/backend/fastapi/

RUN useradd --create-home --shell /bin/bash app \
    && chown -R app:app /app
USER app
WORKDIR /app/apps/backend/fastapi

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import os,sys,urllib.request; port=os.getenv('BACKEND_PORT', os.getenv('PORT', '5000')); r=urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=3); sys.exit(0 if r.getcode() == 200 else 1)" || exit 1

CMD ["python", "-c", "import os, uvicorn; uvicorn.run('server:app', host='0.0.0.0', port=int(os.getenv('BACKEND_PORT') or os.getenv('PORT') or '5000'), access_log=False)"]
