import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "../context/WalletContext.tsx";
import { lotsApi } from "../services/api.ts";
import type { Bid, CertificateSummary, Lot } from "../types/api.ts";

export type WsConnectionStatus =
  | "CONNECTING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "RECONNECTING";

interface WsNewBidMessage {
  event: "NEW_BID";
  lot_id: string;
  lot_number?: number;
  title?: string;
  current_bid_cents?: number;
  bid_count?: number;
  leader_user_id?: string | null;
  leader_masked_name?: string | null;
  lot_end_time?: string;
  extension_count?: number;
  current_hash?: string;
  bid?: Bid;
}

interface WsLotSettledMessage {
  event: "LOT_SETTLED";
  lot_id: string;
  certificate: CertificateSummary | null;
}

interface WsLotCancelledMessage {
  event: "LOT_CANCELLED";
  lot_id: string;
}

type WsEventPayload =
  | WsNewBidMessage
  | WsLotSettledMessage
  | WsLotCancelledMessage;

export interface UseLotWebSocketResult {
  lotData: Lot | null;
  bidsHistory: Bid[];
  connectionStatus: WsConnectionStatus;
  error: string | null;
  reloadLot: () => Promise<void>;
}

export function useLotWebSocket(lotId: string | undefined): UseLotWebSocketResult {
  const { refreshWallet } = useWallet();

  const [lotData, setLotData] = useState<Lot | null>(null);
  const [bidsHistory, setBidsHistory] = useState<Bid[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<WsConnectionStatus>("CONNECTING");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptRef = useRef<number>(0);
  const unmountedRef = useRef<boolean>(false);

  const reloadLot = useCallback(async () => {
    if (!lotId) return;
    try {
      const fresh = await lotsApi.getById(lotId);
      setLotData(fresh);
      const sortedBids = [...(fresh.bids || [])].sort(
        (a, b) => b.sequence_number - a.sequence_number,
      );
      setBidsHistory(sortedBids);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Falha ao carregar dados do lote.",
      );
    }
  }, [lotId]);

  useEffect(() => {
    void reloadLot();
  }, [reloadLot]);

  useEffect(() => {
    if (!lotId) return;
    unmountedRef.current = false;

    const connectWs = () => {
      if (unmountedRef.current) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/v1/ws/lots/${lotId}`;

      setConnectionStatus(
        attemptRef.current === 0 ? "CONNECTING" : "RECONNECTING",
      );

      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (unmountedRef.current) return;
        attemptRef.current = 0;
        setConnectionStatus("CONNECTED");
      };

      socket.onmessage = (event) => {
        if (unmountedRef.current) return;
        try {
          const payload = JSON.parse(event.data) as WsEventPayload;

          if (payload.event === "NEW_BID") {
            const incomingBid = payload.bid;
            if (incomingBid) {
              setBidsHistory((prev) => {
                const exists = prev.some((b) => b.id === incomingBid.id);
                if (exists) return prev;
                return [incomingBid, ...prev].sort(
                  (a, b) => b.sequence_number - a.sequence_number,
                );
              });
            }

            setLotData((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                status: "LIVE",
                current_bid_cents:
                  payload.current_bid_cents ??
                  incomingBid?.amount_cents ??
                  prev.current_bid_cents,
                bid_count:
                  payload.bid_count ??
                  incomingBid?.sequence_number ??
                  prev.bid_count + 1,
                leader_user_id:
                  payload.leader_user_id ??
                  incomingBid?.user_id ??
                  prev.leader_user_id,
                leader_masked_name:
                  payload.leader_masked_name ??
                  incomingBid?.bidder_masked_name ??
                  prev.leader_masked_name,
                end_time: payload.lot_end_time ?? prev.end_time,
                extension_count:
                  payload.extension_count ?? prev.extension_count,
                head_hash:
                  payload.current_hash ??
                  incomingBid?.current_hash ??
                  prev.head_hash,
              };
            });

            void refreshWallet();
          } else if (payload.event === "LOT_SETTLED") {
            setLotData((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                status: "ENDED",
                settled_at:
                  payload.certificate?.settled_at ?? new Date().toISOString(),
                certificate: payload.certificate ?? prev.certificate,
              };
            });
            void refreshWallet();
          } else if (payload.event === "LOT_CANCELLED") {
            setLotData((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                status: "CANCELLED",
                cancelled_at: new Date().toISOString(),
              };
            });
            void refreshWallet();
          }
        } catch (err) {
          console.warn("Falha ao processar evento WebSocket do lote:", err);
        }
      };

      socket.onclose = () => {
        if (unmountedRef.current) return;
        setConnectionStatus("DISCONNECTED");
        attemptRef.current += 1;
        const backoffMs = Math.min(1000 * 2 ** (attemptRef.current - 1), 10000);
        reconnectTimerRef.current = window.setTimeout(() => {
          connectWs();
        }, backoffMs);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connectWs();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [lotId, refreshWallet]);

  return {
    lotData,
    bidsHistory,
    connectionStatus,
    error,
    reloadLot,
  };
}
