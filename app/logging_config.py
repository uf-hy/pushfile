import json
import logging
import os
import time
from datetime import datetime, timezone, timedelta

_BJT = timezone(timedelta(hours=8))

_SKIP_PATHS = {"/health", "/robots.txt"}
_SKIP_PREFIXES = ("/static/",)


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "time": datetime.now(_BJT).strftime("%Y-%m-%d %H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0]:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


class DevFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.now(_BJT).strftime("%H:%M:%S")
        msg = f"{ts} {record.levelname:<5} [{record.name}] {record.getMessage()}"
        if record.exc_info and record.exc_info[0]:
            msg += "\n" + self.formatException(record.exc_info)
        return msg


def setup_logging() -> None:
    log_format = os.environ.get("LOG_FORMAT", "dev").lower()
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()

    formatter = JSONFormatter() if log_format == "json" else DevFormatter()
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(getattr(logging, log_level, logging.INFO))

    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def _should_skip(path: str) -> bool:
    if path in _SKIP_PATHS:
        return True
    return any(path.startswith(p) for p in _SKIP_PREFIXES)


async def access_log_middleware(request, call_next):
    path = request.url.path
    if _should_skip(path):
        return await call_next(request)

    start = time.monotonic()
    response = await call_next(request)
    duration_ms = round((time.monotonic() - start) * 1000)

    logger = logging.getLogger("app.access")
    logger.info(
        "%s %s → %s (%dms)",
        request.method,
        path,
        response.status_code,
        duration_ms,
    )
    return response
