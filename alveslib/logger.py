import logging
import os

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


def get_logger(service_name: str, level: str = "INFO") -> logging.Logger:
    log = logging.getLogger(service_name)
    log.setLevel(getattr(logging, os.getenv("LOG_LEVEL", level).upper()))
    return log
