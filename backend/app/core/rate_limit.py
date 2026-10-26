from collections import defaultdict
import time

from fastapi import HTTPException, Request, status


class RateLimiter:
    def __init__(self):
        self._events: dict[str, list[float]] = defaultdict(list)

    def _clean_and_get(self, key: str, window_seconds: int) -> list[float]:
        now = time.monotonic()
        cutoff = now - window_seconds
        valid = [t for t in self._events.get(key, []) if t > cutoff]
        if valid:
            self._events[key] = valid
        else:
            self._events.pop(key, None)
        return valid

    def check(self, key: str, max_requests: int, window_seconds: int, detail: str) -> None:
        now = time.monotonic()
        valid = self._clean_and_get(key, window_seconds)
        if len(valid) >= max_requests:
            oldest = valid[0]
            retry_after = max(1, int(window_seconds - (now - oldest)))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=detail,
                headers={"Retry-After": str(retry_after)},
            )
        valid.append(now)
        self._events[key] = valid

    def check_limit_exceeded(self, key: str, max_requests: int, window_seconds: int, detail: str) -> None:
        now = time.monotonic()
        valid = self._clean_and_get(key, window_seconds)
        if len(valid) >= max_requests:
            oldest = valid[0]
            retry_after = max(1, int(window_seconds - (now - oldest)))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=detail,
                headers={"Retry-After": str(retry_after)},
            )

    def record(self, key: str, window_seconds: int) -> None:
        now = time.monotonic()
        valid = self._clean_and_get(key, window_seconds)
        valid.append(now)
        self._events[key] = valid

    def reset(self, key: str) -> None:
        self._events.pop(key, None)

    def clear_all(self) -> None:
        self._events.clear()


rate_limiter = RateLimiter()


def get_client_ip(request: Request) -> str:
    cf_ip = request.headers.get("CF-Connecting-IP")
    if cf_ip:
        return cf_ip.strip()
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "127.0.0.1"
