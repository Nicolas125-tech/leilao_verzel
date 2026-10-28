import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useAuth } from "./AuthContext.tsx";
import { getStoredToken } from "../services/api.ts";
import { formatBrlCents } from "../utils/formatters.ts";

export interface AuctionNotification {
  id: string;
  type: "OUTBID" | "LOT_EXTENDED" | "WON";
  title: string;
  message: string;
  lotId: string;
  read: boolean;
  createdAt: Date;
  actionUrl: string;
}

interface NotificationContextValue {
  notifications: AuctionNotification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotification: (id: string) => void;
  toasts: AuctionNotification[];
  dismissToast: (id: string) => void;
  isAudioEnabled: boolean;
  toggleAudio: () => void;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(
  undefined,
);

const NOTIFICATIONS_STORAGE_KEY_PREFIX = "verzel_notifications_";

function playDiscreetChime(): void {
  try {
    if (typeof window === "undefined") return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.08, now);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.12);
    gain2.gain.setValueAtTime(0.06, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.55);

    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 650);
  } catch {
  }
}

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<AuctionNotification[]>([]);
  const [toasts, setToasts] = useState<AuctionNotification[]>([]);
  const [isAudioEnabled, setIsAudioEnabled] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("verzel_audio_notifications");
      return stored !== "false";
    } catch {
      return true;
    }
  });

  const isAudioEnabledRef = useRef<boolean>(isAudioEnabled);
  useEffect(() => {
    isAudioEnabledRef.current = isAudioEnabled;
  }, [isAudioEnabled]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const storageKey = user ? `${NOTIFICATIONS_STORAGE_KEY_PREFIX}${user.id}` : null;

  useEffect(() => {
    if (!storageKey) {
      setNotifications([]);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Array<
          Omit<AuctionNotification, "createdAt"> & { createdAt: string }
        >;
        setNotifications(
          parsed.map((item) => ({
            ...item,
            createdAt: new Date(item.createdAt),
          })),
        );
      }
    } catch {
      setNotifications([]);
    }
  }, [storageKey]);

  const persistNotifications = useCallback(
    (items: AuctionNotification[]) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(items.slice(0, 50)));
      } catch {
      }
    },
    [storageKey],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const markAsRead = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const next = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
        persistNotifications(next);
        return next;
      });
    },
    [persistNotifications],
  );

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      persistNotifications(next);
      return next;
    });
  }, [persistNotifications]);

  const clearNotification = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const next = prev.filter((n) => n.id !== id);
        persistNotifications(next);
        return next;
      });
      dismissToast(id);
    },
    [dismissToast, persistNotifications],
  );

  const toggleAudio = useCallback(() => {
    setIsAudioEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("verzel_audio_notifications", String(next));
      } catch {
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!user || !token) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    let isSubscribed = true;

    const connectWs = () => {
      if (!isSubscribed) return;

      const customWsUrl = (
        import.meta.env.VITE_WS_URL as string | undefined
      )?.replace(/\/+$/, "");
      let endpoint: string;
      if (customWsUrl) {
        const normalized = customWsUrl
          .replace(/^https:\/\//, "wss://")
          .replace(/^http:\/\//, "ws://");
        endpoint = `${normalized}/ws/notifications?token=${encodeURIComponent(token)}`;
      } else {
        const isProd =
          window.location.hostname !== "localhost" &&
          window.location.hostname !== "127.0.0.1";
        const wsBase = isProd
          ? "wss://leilao-verzel.onrender.com"
          : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
        endpoint = `${wsBase}/ws/notifications?token=${encodeURIComponent(token)}`;
      }

      const ws = new WebSocket(endpoint);
      wsRef.current = ws;

      ws.onmessage = (event: MessageEvent) => {
        if (!isSubscribed) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "NOTIFICATION" && data.event === "OUTBID") {
            const formatted = formatBrlCents(data.new_highest_bid_cents);
            const lotNumber = data.lot_number ?? "";
            const artworkTitle = data.artwork_title ?? "";
            const newNotif: AuctionNotification = {
              id:
                typeof crypto !== "undefined" && crypto.randomUUID
                  ? crypto.randomUUID()
                  : `${Date.now()}-${Math.random()}`,
              type: "OUTBID",
              title: "Cobriram seu lance",
              message: `Lote ${lotNumber} (${artworkTitle}) recebeu uma nova oferta de ${formatted}.`,
              lotId: String(data.lot_id),
              read: false,
              createdAt: new Date(),
              actionUrl: data.action_url || `/lots/${data.lot_id}`,
            };

            setNotifications((prev) => {
              const next = [newNotif, ...prev.slice(0, 49)];
              persistNotifications(next);
              return next;
            });

            setToasts((prev) => [newNotif, ...prev]);

            if (isAudioEnabledRef.current) {
              playDiscreetChime();
            }

            window.setTimeout(() => {
              if (isSubscribed) {
                dismissToast(newNotif.id);
              }
            }, 6000);
          } else if (data.event === "LOT_EXTENDED") {
            const newNotif: AuctionNotification = {
              id:
                typeof crypto !== "undefined" && crypto.randomUUID
                  ? crypto.randomUUID()
                  : `${Date.now()}-${Math.random()}`,
              type: "LOT_EXTENDED",
              title: "Prorrogação de Lote",
              message: "Um lote em que você participa recebeu lance nos minutos finais e foi prorrogado (+2 min).",
              lotId: String(data.lot_id),
              read: false,
              createdAt: new Date(),
              actionUrl: `/lots/${data.lot_id}`,
            };

            setNotifications((prev) => {
              const next = [newNotif, ...prev.slice(0, 49)];
              persistNotifications(next);
              return next;
            });
          }
        } catch {
        }
      };

      ws.onclose = () => {
        if (!isSubscribed) return;
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connectWs();
        }, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectWs();

    return () => {
      isSubscribed = false;
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [user, dismissToast, persistNotifications]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const contextValue = useMemo(
    () => ({
      notifications,
      unreadCount,
      markAsRead,
      markAllAsRead,
      clearNotification,
      toasts,
      dismissToast,
      isAudioEnabled,
      toggleAudio,
    }),
    [
      notifications,
      unreadCount,
      markAsRead,
      markAllAsRead,
      clearNotification,
      toasts,
      dismissToast,
      isAudioEnabled,
      toggleAudio,
    ],
  );

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}

      {toasts.length > 0 && (
        <aside
          aria-label="Avisos em tempo real"
          aria-live="polite"
          className="fixed top-4 right-3 left-3 sm:left-auto sm:right-4 z-50 flex sm:w-full sm:max-w-sm flex-col gap-2.5 pointer-events-none"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="alert"
              aria-live="polite"
              className="pointer-events-auto rounded-sm border border-status-outbid border-l-4 border-l-status-outbid bg-paper-surface dark:bg-charcoal-surface p-4 shadow-card text-paper-text dark:text-charcoal-text animate-fade-in"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="pr-1">
                  <span className="font-sans text-xs font-semibold uppercase tracking-wider text-status-outbid">
                    {toast.title}
                  </span>
                  <p className="mt-1 font-sans text-xs text-paper-text dark:text-charcoal-text leading-snug">
                    {toast.message}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  className="rounded-sm p-1 text-paper-subtext hover:text-paper-text dark:text-charcoal-subtext dark:hover:text-charcoal-text transition-colors"
                  aria-label="Fechar aviso"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => {
                    dismissToast(toast.id);
                    markAsRead(toast.id);
                    navigate(toast.actionUrl);
                  }}
                  className="rounded-sm border border-primary bg-primary px-3 py-1 font-sans text-xs font-semibold text-white transition-colors hover:bg-primary-hover dark:border-gold dark:bg-gold dark:text-charcoal-bg dark:hover:bg-gold-hover"
                >
                  Cobrir lance
                </button>
              </div>
            </div>
          ))}
        </aside>
      )}
    </NotificationContext.Provider>
  );
};

export const useNotifications = (): NotificationContextValue => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error(
      "useNotifications deve ser utilizado dentro de um NotificationProvider",
    );
  }
  return context;
};
