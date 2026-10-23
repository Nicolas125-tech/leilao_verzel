from datetime import datetime, timedelta, timezone

from sqlalchemy import DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

_last_utc_ts: datetime | None = None


def utc_now() -> datetime:
    global _last_utc_ts
    now = datetime.now(timezone.utc)
    if _last_utc_ts is not None and now <= _last_utc_ts:
        now = _last_utc_ts + timedelta(microseconds=1)
    _last_utc_ts = now
    return now


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )
