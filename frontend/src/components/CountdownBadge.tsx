import React, { useEffect, useState } from "react";
import { calculateCountdown } from "../utils/formatters.ts";
import type { LotStatus } from "../types/api.ts";

interface CountdownBadgeProps {
  endTimeIso: string;
  startTimeIso?: string;
  status: LotStatus;
  extensionCount?: number;
  onExpire?: () => void;
}

export const CountdownBadge: React.FC<CountdownBadgeProps> = ({
  endTimeIso,
  startTimeIso,
  status,
  extensionCount = 0,
  onExpire,
}) => {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (status === "ENDED" || status === "CANCELLED") {
      return;
    }
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      if (new Date(endTimeIso).getTime() <= current && onExpire) {
        onExpire();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [endTimeIso, status, onExpire]);

  if (status === "CANCELLED") {
    return (
      <span className="font-mono text-xs font-medium text-status-outbid tabular-nums">
        Cancelado
      </span>
    );
  }

  if (status === "ENDED") {
    return (
      <span className="font-mono text-xs font-medium text-paper-subtext dark:text-charcoal-subtext tabular-nums">
        Encerrado
      </span>
    );
  }

  if (status === "SCHEDULED" && startTimeIso) {
    const startState = calculateCountdown(startTimeIso, nowMs);
    return (
      <span className="font-mono text-xs font-medium text-paper-subtext dark:text-charcoal-subtext tabular-nums">
        Inicia em {startState.formatted}
      </span>
    );
  }

  const countdown = calculateCountdown(endTimeIso, nowMs);

  return (
    <div className="inline-flex items-center gap-2">
      <span
        className={`font-mono text-sm font-semibold tabular-nums ${
          countdown.isCritical
            ? "text-status-warning"
            : "text-paper-text dark:text-charcoal-text"
        }`}
      >
        {countdown.formatted}
      </span>
      {extensionCount > 0 && !countdown.isExpired && (
        <span className="border border-gold/60 bg-gold/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-gold tabular-nums">
          +{extensionCount * 2} min
        </span>
      )}
    </div>
  );
};
