from __future__ import annotations

import time
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from threading import Lock


@dataclass(slots=True)
class SlidingWindowRateLimiter:
    """Simple in-memory sliding window rate limiter.

    Stores timestamps per key and allows up to `limit` events within `window_s`.
    """

    limit: int
    window_s: float
    max_keys: int = 10_000
    cleanup_every: int = 256
    _events: "OrderedDict[str, deque[float]]" = field(default_factory=OrderedDict)
    _ops: int = 0
    _lock: Lock = field(default_factory=Lock)

    def allow(self, key: str, now: float | None = None) -> bool:
        key = key or "unknown"
        if now is None:
            now = time.time()

        cutoff = now - self.window_s
        with self._lock:
            self._ops += 1

            q = self._events.get(key)
            if q is None:
                while self.max_keys > 0 and len(self._events) >= self.max_keys:
                    self._events.popitem(last=False)
                q = deque()
                self._events[key] = q
            else:
                self._events.move_to_end(key)

            while q and q[0] <= cutoff:
                q.popleft()

            if len(q) >= self.limit:
                return False

            q.append(now)
            if self.cleanup_every > 0 and (self._ops % self.cleanup_every) == 0:
                self._cleanup(cutoff)
            return True

    def _cleanup(self, cutoff: float) -> None:
        for k in list(self._events.keys()):
            q = self._events.get(k)
            if q is None:
                continue
            while q and q[0] <= cutoff:
                q.popleft()
            if not q:
                del self._events[k]
