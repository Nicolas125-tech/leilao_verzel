import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AuctionNotification } from "../context/NotificationContext.tsx";
import { formatBrlCents } from "../utils/formatters.ts";

describe("Sistema de Notificações em Tempo Real", () => {
  it("monta o payload correto de notificação para evento OUTBID", () => {
    const rawWsEvent = {
      type: "NOTIFICATION",
      event: "OUTBID",
      lot_id: "770e8400-e29b-41d4-a716-446655440000",
      lot_number: 1,
      artwork_title: "Water Lilies",
      new_highest_bid_cents: 15000,
      action_url: "/lots/770e8400-e29b-41d4-a716-446655440000",
    };

    const formattedAmount = formatBrlCents(rawWsEvent.new_highest_bid_cents);
    const notification: AuctionNotification = {
      id: "notif-1",
      type: "OUTBID",
      title: "Cobriram seu lance",
      message: `Lote ${rawWsEvent.lot_number} (${rawWsEvent.artwork_title}) recebeu uma nova oferta de ${formattedAmount}.`,
      lotId: rawWsEvent.lot_id,
      read: false,
      createdAt: new Date(),
      actionUrl: rawWsEvent.action_url,
    };

    assert.equal(notification.title, "Cobriram seu lance");
    assert.equal(
      notification.message,
      "Lote 1 (Water Lilies) recebeu uma nova oferta de R$ 150,00.",
    );
    assert.equal(notification.type, "OUTBID");
    assert.equal(notification.read, false);
    assert.equal(notification.actionUrl, "/lots/770e8400-e29b-41d4-a716-446655440000");
  });

  it("calcula contagem de mensagens não lidas com precisão", () => {
    const items: AuctionNotification[] = [
      {
        id: "1",
        type: "OUTBID",
        title: "Cobriram seu lance",
        message: "Lote 1 recebeu nova oferta.",
        lotId: "lot-1",
        read: false,
        createdAt: new Date(),
        actionUrl: "/lots/lot-1",
      },
      {
        id: "2",
        type: "LOT_EXTENDED",
        title: "Prorrogação de Lote",
        message: "Lote 2 foi estendido.",
        lotId: "lot-2",
        read: true,
        createdAt: new Date(),
        actionUrl: "/lots/lot-2",
      },
      {
        id: "3",
        type: "OUTBID",
        title: "Cobriram seu lance",
        message: "Lote 3 recebeu nova oferta.",
        lotId: "lot-3",
        read: false,
        createdAt: new Date(),
        actionUrl: "/lots/lot-3",
      },
    ];

    const unreadCount = items.filter((n) => !n.read).length;
    assert.equal(unreadCount, 2);

    const allRead = items.map((n) => ({ ...n, read: true }));
    assert.equal(allRead.filter((n) => !n.read).length, 0);
  });
});
