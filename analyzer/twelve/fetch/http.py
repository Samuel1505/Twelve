"""Minimal HTTP with retries (exponential backoff + jitter on 429/5xx/timeouts). No third-party deps."""

from __future__ import annotations

import json
import random
import time
import urllib.error
import urllib.request
from typing import Any

USER_AGENT = "twelve-analyzer/0.1"


class HttpError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


def request_json(url: str, body: Any | None = None, *, timeout: int = 30, retries: int = 5) -> Any:
    data = None if body is None else json.dumps(body).encode()
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    delay = 0.5
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            retryable = e.code == 429 or e.code >= 500
            if not retryable or attempt == retries:
                raise HttpError(e.code, e.read()[:300].decode(errors="replace")) from e
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == retries:
                raise HttpError(0, str(e)) from e
        time.sleep(delay + random.uniform(0, delay))
        delay *= 2
    raise AssertionError("unreachable")
