import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WalletTransaction } from "../types/api.ts";
import {
  calculateCountdown,
  formatBrlCents,
  maskBidderDisplay,
  parseBrlToCents,
  reconcileLedgerBalances,
} from "../utils/formatters.ts";

describe("Utilitarios de Formatacao Monetaria em Centavos (BRL)", () => {
  it("formata valores inteiros em centavos para moeda BRL tabular", () => {
    assert.equal(formatBrlCents(0), "R$ 0,00");
    assert.equal(formatBrlCents(150000), "R$ 1.500,00");
    assert.equal(formatBrlCents(280050), "R$ 2.800,50");
    assert.equal(formatBrlCents(12500000), "R$ 125.000,00");
  });

  it("converte strings monetarias em reais para inteiros em centavos", () => {
    assert.equal(parseBrlToCents("1.500,00"), 150000);
    assert.equal(parseBrlToCents("R$ 2.800,50"), 280050);
    assert.equal(parseBrlToCents("1000"), 100000);
    assert.equal(parseBrlToCents(""), 0);
  });
});

describe("Calculo do Cronometro Regressivo e Janela Anti-Sniping", () => {
  it("calcula tempo restante normal acima de 120 segundos", () => {
    const now = Date.parse("2026-10-24T15:00:00Z");
    const end = "2026-10-24T15:10:05Z";
    const state = calculateCountdown(end, now);

    assert.equal(state.totalSeconds, 605);
    assert.equal(state.isExpired, false);
    assert.equal(state.isCritical, false);
    assert.equal(state.formatted, "10:05");
  });

  it("sinaliza janela critica anti-sniping quando faltam 120 segundos ou menos", () => {
    const now = Date.parse("2026-10-24T15:00:00Z");
    const end = "2026-10-24T15:01:45Z";
    const state = calculateCountdown(end, now);

    assert.equal(state.totalSeconds, 105);
    assert.equal(state.isExpired, false);
    assert.equal(state.isCritical, true);
    assert.equal(state.formatted, "01:45");
  });

  it("retorna ENCERRADO quando o horario final ja expirou", () => {
    const now = Date.parse("2026-10-24T15:05:00Z");
    const end = "2026-10-24T15:00:00Z";
    const state = calculateCountdown(end, now);

    assert.equal(state.totalSeconds, 0);
    assert.equal(state.isExpired, true);
    assert.equal(state.formatted, "ENCERRADO");
  });
});

describe("Mascaramento de Identidade Publica de Licitantes", () => {
  it("mascara nome completo preservando codigo publico LIC-XXXX e iniciais", () => {
    const masked = maskBidderDisplay("Nicolas Brito", "LIC-48F9");
    assert.equal(masked, "LIC-48F9 (N***s B.)");
    assert.equal(masked.includes("Nicolas"), false);
    assert.equal(masked.includes("Brito"), false);
  });

  it("mascara nomes curtos sem expor sobrenome completo", () => {
    const masked = maskBidderDisplay("Ana Silva", "LIC-91A2");
    assert.equal(masked, "LIC-91A2 (A*a S.)");
  });
});

describe("Sincronizacao e Reconciliacao do Livro-Razao da Carteira", () => {
  it("reconcilia sequencia de deposito, retencao, superacao e liquidacao", () => {
    const ledger: WalletTransaction[] = [
      {
        id: "tx-1",
        wallet_id: "w-1",
        user_id: "u-1",
        lot_id: null,
        type: "DEPOSIT",
        amount_cents: 500000,
        balance_after_cents: 500000,
        committed_after_cents: 0,
        description: "Deposito inicial",
        created_at: "2026-10-24T12:00:00Z",
      },
      {
        id: "tx-2",
        wallet_id: "w-1",
        user_id: "u-1",
        lot_id: "lot-102",
        type: "BID_HOLD",
        amount_cents: 150000,
        balance_after_cents: 500000,
        committed_after_cents: 150000,
        description: "Reserva de saldo por lideranca no Lote #102",
        created_at: "2026-10-24T12:05:00Z",
      },
      {
        id: "tx-3",
        wallet_id: "w-1",
        user_id: "u-1",
        lot_id: "lot-102",
        type: "BID_RELEASE",
        amount_cents: 150000,
        balance_after_cents: 500000,
        committed_after_cents: 0,
        description: "Desbloqueio imediato por lance superado no Lote #102",
        created_at: "2026-10-24T12:08:00Z",
      },
      {
        id: "tx-4",
        wallet_id: "w-1",
        user_id: "u-1",
        lot_id: "lot-103",
        type: "BID_HOLD",
        amount_cents: 220000,
        balance_after_cents: 500000,
        committed_after_cents: 220000,
        description: "Reserva de saldo por lideranca no Lote #103",
        created_at: "2026-10-24T12:10:00Z",
      },
      {
        id: "tx-5",
        wallet_id: "w-1",
        user_id: "u-1",
        lot_id: "lot-103",
        type: "SETTLEMENT_DEBIT",
        amount_cents: 220000,
        balance_after_cents: 280000,
        committed_after_cents: 0,
        description: "Liquidacao definitiva de arremate do Lote #103",
        created_at: "2026-10-24T12:30:00Z",
      },
    ];

    const summary = reconcileLedgerBalances(ledger);
    assert.equal(summary.isConsistent, true);
    assert.equal(summary.totalBalanceCents, 280000);
    assert.equal(summary.committedBalanceCents, 0);
    assert.equal(summary.availableBalanceCents, 280000);
  });
});
