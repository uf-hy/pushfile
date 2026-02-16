from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from threading import Lock


@dataclass(slots=True)
class SlidingWindowRateLimiter:
    """Simple in-memory sliding window rate limiter.

    Stores timestamps per key and allows up to `limit` events within `window_s`.
    """

    limit: int
    window_s: float
    _events: dict[str, deque[float]] = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock)

    def allow(self, key: str, now: float | None = None) -> bool:
        if not key:
            return True
        if now is None:
            now = time.time()

        cutoff = now - self.window_s
        with self._lock:
            q = self._events.get(key)
            if q is None:
                q = deque()
                self._events[key] = q

            while q and q[0] <= cutoff:
                q.popleft()

            if len(q) >= self.limit:
                return False

            q.append(now)
            return True

