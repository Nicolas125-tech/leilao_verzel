import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { DisputeItem, MyDisputesResponse } from "../types/api.ts";
import { formatBrlCents } from "../utils/formatters.ts";

describe("Painel de Disputas do Licitante", () => {
  const sampleDisputes: MyDisputesResponse = {
    counts: {
      in_dispute: 2,
      won: 1,
      lost: 1,
    },
    items: [
      {
        lot_id: "11111111-1111-1111-1111-111111111111",
        lot_number: 1,
        artwork_title: "Nighthawks",
        artwork_artist: "Edward Hopper",
        artwork_image_url: "/artworks/nighthawks.svg",
        user_highest_bid_cents: 250000,
        user_bid_count: 3,
        current_bid_cents: 250000,
        ends_at_iso: "2026-10-28T18:00:00Z",
        time_remaining_formatted: "01:45:00",
        status: "WINNING",
        leader_pseudonym: "LIC-7890 (N***s B.)",
        is_user_winning: true,
      },
      {
        lot_id: "22222222-2222-2222-2222-222222222222",
        lot_number: 2,
        artwork_title: "The Bedroom",
        artwork_artist: "Vincent van Gogh",
        artwork_image_url: "/artworks/the-bedroom.svg",
        user_highest_bid_cents: 300000,
        user_bid_count: 1,
        current_bid_cents: 350000,
        ends_at_iso: "2026-10-28T18:05:00Z",
        time_remaining_formatted: "01:50:00",
        status: "OUTBID",
        leader_pseudonym: "LIC-1234 (M***a S.)",
        is_user_winning: false,
      },
      {
        lot_id: "33333333-3333-3333-3333-333333333333",
        lot_number: 3,
        artwork_title: "Water Lilies",
        artwork_artist: "Claude Monet",
        artwork_image_url: "/artworks/water-lilies.svg",
        user_highest_bid_cents: 500000,
        user_bid_count: 5,
        current_bid_cents: 500000,
        ends_at_iso: "2026-10-28T10:00:00Z",
        time_remaining_formatted: "ENCERRADO",
        status: "WON",
        leader_pseudonym: "LIC-7890 (N***s B.)",
        is_user_winning: true,
      },
      {
        lot_id: "44444444-4444-4444-4444-444444444444",
        lot_number: 4,
        artwork_title: "American Gothic",
        artwork_artist: "Grant Wood",
        artwork_image_url: "/artworks/american-gothic.svg",
        user_highest_bid_cents: 120000,
        user_bid_count: 2,
        current_bid_cents: 180000,
        ends_at_iso: "2026-10-28T09:00:00Z",
        time_remaining_formatted: "ENCERRADO",
        status: "LOST",
        leader_pseudonym: "LIC-5555 (C***s A.)",
        is_user_winning: false,
      },
    ],
  };

  it("filtra lotes em disputa (liderando ou superado)", () => {
    const inDispute = sampleDisputes.items.filter(
      (item) => item.status === "WINNING" || item.status === "OUTBID",
    );
    assert.equal(inDispute.length, 2);
    assert.equal(inDispute[0].lot_number, 1);
    assert.equal(inDispute[0].is_user_winning, true);
    assert.equal(inDispute[1].lot_number, 2);
    assert.equal(inDispute[1].is_user_winning, false);
  });

  it("filtra lotes arrematados e não arrematados", () => {
    const won = sampleDisputes.items.filter((item) => item.status === "WON");
    const lost = sampleDisputes.items.filter((item) => item.status === "LOST");

    assert.equal(won.length, 1);
    assert.equal(won[0].artwork_title, "Water Lilies");

    assert.equal(lost.length, 1);
    assert.equal(lost[0].artwork_title, "American Gothic");
  });

  it("formata valores financeiros e contagem de lances com precisão", () => {
    const winning = sampleDisputes.items[0];
    const outbid = sampleDisputes.items[1];

    assert.equal(formatBrlCents(winning.user_highest_bid_cents), "R$ 2.500,00");
    assert.equal(formatBrlCents(outbid.current_bid_cents), "R$ 3.500,00");
    assert.equal(winning.user_bid_count, 3);
    assert.equal(outbid.user_bid_count, 1);
  });

  it("garante conformidade de pseudônimo mascarado para privacidade", () => {
    for (const item of sampleDisputes.items) {
      assert.match(item.leader_pseudonym, /^LIC-[A-Z0-9]+ \([A-Z]\*{3}[a-z] [A-Z]\.\)$/);
    }
  });
});
