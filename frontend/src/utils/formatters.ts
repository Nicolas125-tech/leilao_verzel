import type { WalletTransaction } from "../types/api.ts";

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

export function maskBidderDisplay(fullName: string, publicCode: string): string {
  const cleaned = fullName.trim().replace(/\s+/g, " ");
  if (!cleaned) {
    return publicCode;
  }

  const parts = cleaned.split(" ");
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : "";

  let maskedFirst: string;
  if (first.length <= 2) {
    maskedFirst = first.length === 2 ? `${first[0]}*` : `${first}*`;
  } else if (first.length === 3) {
    maskedFirst = `${first[0]}*${first[first.length - 1]}`;
  } else {
    maskedFirst = `${first[0]}***${first[first.length - 1]}`;
  }

  if (last) {
    return `${publicCode} (${maskedFirst} ${last[0]}.)`;
  }

  return `${publicCode} (${maskedFirst})`;
}

export interface LedgerReconciliationResult {
  totalBalanceCents: number;
  committedBalanceCents: number;
  availableBalanceCents: number;
  isConsistent: boolean;
}

export function reconcileLedgerBalances(
  transactions: WalletTransaction[],
): LedgerReconciliationResult {
  if (transactions.length === 0) {
    return {
      totalBalanceCents: 0,
      committedBalanceCents: 0,
      availableBalanceCents: 0,
      isConsistent: true,
    };
  }

  // Ordena cronologicamente do mais antigo ao mais recente
  const chronological = [...transactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  let runningTotal = 0;
  let runningCommitted = 0;
  let isConsistent = true;

  for (const tx of chronological) {
    switch (tx.type) {
      case "DEPOSIT":
      case "SETTLEMENT_CREDIT":
        runningTotal += tx.amount_cents;
        break;
      case "BID_HOLD":
        runningCommitted += tx.amount_cents;
        break;
      case "BID_RELEASE":
      case "CANCEL_REFUND":
        runningCommitted = Math.max(0, runningCommitted - tx.amount_cents);
        break;
      case "SETTLEMENT_DEBIT":
        runningTotal = Math.max(0, runningTotal - tx.amount_cents);
        runningCommitted = Math.max(0, runningCommitted - tx.amount_cents);
        break;
    }

    if (
      tx.balance_after_cents !== runningTotal ||
      tx.committed_after_cents !== runningCommitted
    ) {
      isConsistent = false;
    }
  }

  const latest = chronological[chronological.length - 1];
  const totalBalanceCents = latest.balance_after_cents;
  const committedBalanceCents = latest.committed_after_cents;
  const availableBalanceCents = Math.max(0, totalBalanceCents - committedBalanceCents);

  return {
    totalBalanceCents,
    committedBalanceCents,
    availableBalanceCents,
    isConsistent: isConsistent && totalBalanceCents >= committedBalanceCents,
  };
}
