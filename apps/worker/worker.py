import logging
import os
import time

from celery import Celery
from dotenv import load_dotenv

from alveslib.telemetry import configure_worker_observability

load_dotenv()
configure_worker_observability("worker")

log = logging.getLogger(__name__)
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
app = Celery("worker", broker=redis_url, backend=redis_url)


@app.task
def simple_task(message):
    log.info("task_simple_task_start message_len=%s", len(str(message)))
    time.sleep(2)
    out = f"Processed: {message}"
    log.info("task_simple_task_done")
    return out


@app.task
def add_numbers(x, y):
    log.info("task_add_numbers x=%s y=%s", x, y)
    return x + y

if __name__ == '__main__':
    app.start()
