export function formatBrlCents(cents: number | null | undefined): string {
  const safeCents = typeof cents === "number" && Number.isFinite(cents) ? Math.round(cents) : 0;
  const isNegative = safeCents < 0;
  const absCents = Math.abs(safeCents);
  const integerPart = Math.floor(absCents / 100);
  const decimalPart = String(absCents % 100).padStart(2, "0");

  const formattedInteger = integerPart
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  return `${isNegative ? "- " : ""}R$ ${formattedInteger},${decimalPart}`;
}

export function parseBrlToCents(rawInput: string): number {
  const cleaned = rawInput.replace(/[^\d,.-]/g, "").trim();
  if (!cleaned) {
    return 0;
  }

  if (cleaned.includes(",")) {
    const normalized = cleaned.replace(/\./g, "").replace(",", ".");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
  }

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
}

export interface CountdownState {
  totalSeconds: number;
  isExpired: boolean;
  isCritical: boolean;
  formatted: string;
}

export function calculateCountdown(
  endTimeIso: string,
  nowMs: number = Date.now(),
): CountdownState {
  const endMs = new Date(endTimeIso).getTime();
  if (Number.isNaN(endMs)) {
    return {
      totalSeconds: 0,
      isExpired: true,
      isCritical: false,
      formatted: "00:00",
    };
  }

  const diffSeconds = Math.max(0, Math.floor((endMs - nowMs) / 1000));
  if (diffSeconds <= 0) {
    return {
      totalSeconds: 0,
      isExpired: true,
      isCritical: false,
      formatted: "ENCERRADO",
    };
  }

  const hours = Math.floor(diffSeconds / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const formatted =
    hours > 0 ? `${String(hours).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;

  return {
    totalSeconds: diffSeconds,
    isExpired: false,
    isCritical: diffSeconds <= 120,
    formatted,
  };
}
