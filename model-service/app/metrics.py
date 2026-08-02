from __future__ import annotations

from collections import defaultdict
from threading import Lock


class Metrics:
    def __init__(self) -> None:
        self._lock = Lock()
        self._counters: dict[tuple[str, tuple[tuple[str, str], ...]], float] = defaultdict(float)
        self._gauges: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}

    @staticmethod
    def _key(name: str, labels: dict[str, str] | None) -> tuple[str, tuple[tuple[str, str], ...]]:
        return name, tuple(sorted((labels or {}).items()))

    def increment(self, name: str, labels: dict[str, str] | None = None, value: float = 1.0) -> None:
        with self._lock:
            self._counters[self._key(name, labels)] += value

    def gauge(self, name: str, value: float, labels: dict[str, str] | None = None) -> None:
        with self._lock:
            self._gauges[self._key(name, labels)] = value

    def render(self) -> str:
        def line(key: tuple[str, tuple[tuple[str, str], ...]], value: float) -> str:
            name, labels = key
            if not labels:
                return f"{name} {value}"
            encoded = ",".join(f'{label}="{content}"' for label, content in labels)
            return f"{name}{{{encoded}}} {value}"

        with self._lock:
            values = [line(key, value) for key, value in sorted(self._counters.items())]
            values.extend(line(key, value) for key, value in sorted(self._gauges.items()))
        return "\n".join(values) + "\n"


metrics = Metrics()
