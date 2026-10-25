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

const calculateBackoffWithJitter = (retryCount: number): number => {
  const base = Math.min(1000 * Math.pow(1.5, retryCount), 8000);
  const jitter = Math.floor(Math.random() * 350);
  return base + jitter;
};

export function useLotWebSocket(lotId: string | undefined): UseLotWebSocketResult {
  const { refreshWallet } = useWallet();

  const [lotData, setLotData] = useState<Lot | null>(null);
  const [bidsHistory, setBidsHistory] = useState<Bid[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<WsConnectionStatus>("CONNECTING");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  const reloadLot = useCallback(async () => {
    if (!lotId) return;
    try {
      const fresh = await lotsApi.getById(lotId);
      if (!isMountedRef.current) return;
      setLotData(fresh);
      const sortedBids = [...(fresh.bids || [])].sort(
        (a, b) => b.sequence_number - a.sequence_number,
      );
      setBidsHistory(sortedBids);
      setError(null);
    } catch (err) {
      if (!isMountedRef.current) return;
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
    isMountedRef.current = true;

    const establishConnection = () => {
      if (!isMountedRef.current) return;

      const customWsUrl = (import.meta.env.VITE_WS_URL as string | undefined)?.replace(/\/+$/, "");
      let endpoint: string;
      if (customWsUrl) {
        const normalizedWs = customWsUrl.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
        endpoint = `${normalizedWs}/api/v1/ws/lots/${lotId}`;
      } else {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        endpoint = `${protocol}//${window.location.host}/api/v1/ws/lots/${lotId}`;
      }

      setConnectionStatus(
        retryCountRef.current === 0 ? "CONNECTING" : "RECONNECTING",
      );

      const socket = new WebSocket(endpoint);
      wsRef.current = socket;

      socket.onopen = () => {
        if (!isMountedRef.current) return;
        retryCountRef.current = 0;
        setConnectionStatus("CONNECTED");
      };

      socket.onmessage = (event: MessageEvent) => {
        if (!isMountedRef.current) return;
        try {
          const payload = JSON.parse(event.data) as WsEventPayload;

          switch (payload.event) {
            case "NEW_BID": {
              const incomingBid = payload.bid;
              if (incomingBid) {
                setBidsHistory((prev) => {
                  const alreadyRegistered = prev.some((b) => b.id === incomingBid.id);
                  if (alreadyRegistered) return prev;
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
              break;
            }

            case "LOT_SETTLED": {
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
              break;
            }

            case "LOT_CANCELLED": {
              setLotData((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  status: "CANCELLED",
                  cancelled_at: new Date().toISOString(),
                };
              });
              void refreshWallet();
              break;
            }
          }
        } catch (parseError) {
          console.warn("Falha ao decodificar frame do pregão:", parseError);
        }
      };

      socket.onclose = () => {
        if (!isMountedRef.current) return;
        setConnectionStatus("DISCONNECTED");
        retryCountRef.current += 1;
        const delay = calculateBackoffWithJitter(retryCountRef.current);
        reconnectTimerRef.current = window.setTimeout(() => {
          establishConnection();
        }, delay);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    establishConnection();

    return () => {
      isMountedRef.current = false;
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
