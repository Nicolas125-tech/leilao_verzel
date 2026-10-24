import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as formattersModule from "../utils/formatters.ts";
import {
  calculateCountdown,
  formatBrlCents,
  parseBrlToCents,
} from "../utils/formatters.ts";

describe("Utilitários de Formatação Monetária em Centavos (BRL)", () => {
  it("formata valores inteiros em centavos para moeda BRL tabular", () => {
    assert.equal(formatBrlCents(0), "R$ 0,00");
    assert.equal(formatBrlCents(150000), "R$ 1.500,00");
    assert.equal(formatBrlCents(280050), "R$ 2.800,50");
    assert.equal(formatBrlCents(12500000), "R$ 125.000,00");
    assert.equal(formatBrlCents(-4500), "- R$ 45,00");
    assert.equal(formatBrlCents(null), "R$ 0,00");
  });

  it("converte strings monetárias em reais para inteiros em centavos", () => {
    assert.equal(parseBrlToCents("1.500,00"), 150000);
    assert.equal(parseBrlToCents("R$ 2.800,50"), 280050);
    assert.equal(parseBrlToCents("1000"), 100000);
    assert.equal(parseBrlToCents(""), 0);
  });
});

describe("Cálculo do Cronômetro Regressivo e Janela Anti-Sniping", () => {
  it("calcula tempo restante normal acima de 120 segundos", () => {
    const now = Date.parse("2026-10-24T15:00:00Z");
    const end = "2026-10-24T15:10:05Z";
    const state = calculateCountdown(end, now);

    assert.equal(state.totalSeconds, 605);
    assert.equal(state.isExpired, false);
    assert.equal(state.isCritical, false);
    assert.equal(state.formatted, "10:05");
  });

  it("formata horas quando o tempo restante supera 60 minutos", () => {
    const now = Date.parse("2026-10-24T15:00:00Z");
    const end = "2026-10-24T17:05:09Z";
    const state = calculateCountdown(end, now);

    assert.equal(state.totalSeconds, 7509);
    assert.equal(state.isExpired, false);
    assert.equal(state.isCritical, false);
    assert.equal(state.formatted, "02:05:09");
  });

  it("sinaliza janela crítica anti-sniping quando faltam 120 segundos ou menos", () => {
    const now = Date.parse("2026-10-24T15:00:00Z");
    const end = "2026-10-24T15:01:45Z";
    const state = calculateCountdown(end, now);

    assert.equal(state.totalSeconds, 105);
    assert.equal(state.isExpired, false);
    assert.equal(state.isCritical, true);
    assert.equal(state.formatted, "01:45");
  });

  it("retorna ENCERRADO quando o horário final já expirou", () => {
    const now = Date.parse("2026-10-24T15:05:00Z");
    const end = "2026-10-24T15:00:00Z";
    const state = calculateCountdown(end, now);

    assert.equal(state.totalSeconds, 0);
    assert.equal(state.isExpired, true);
    assert.equal(state.formatted, "ENCERRADO");
  });
});

describe("Superfície Pública sem Código Morto", () => {
  it("exporta apenas os utilitários ativos utilizados pela interface", () => {
    assert.deepEqual(Object.keys(formattersModule).sort(), [
      "calculateCountdown",
      "formatBrlCents",
      "parseBrlToCents",
    ]);
  });
});
