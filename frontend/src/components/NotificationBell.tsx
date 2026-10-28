import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, Volume2, VolumeX } from "lucide-react";
import { useNotifications } from "../context/NotificationContext.tsx";

function formatRelativeTime(date: Date): string {
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 60) return "Agora";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `Há ${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `Há ${diffHours}h`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export const NotificationBell: React.FC = () => {
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    isAudioEnabled,
    toggleAudio,
  } = useNotifications();

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bellButtonRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        bellButtonRef.current?.focus();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleSelectNotification = (actionUrl: string, id: string) => {
    markAsRead(id);
    setIsOpen(false);
    navigate(actionUrl);
  };

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        ref={bellButtonRef}
        id="notification-bell-button"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-controls="notification-dropdown-menu"
        aria-expanded={isOpen}
        aria-label={
          unreadCount > 0
            ? `${unreadCount} notificações não lidas`
            : "Abrir notificações"
        }
        className="relative rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-1.5 text-paper-text dark:text-charcoal-text hover:border-paper-text dark:hover:border-charcoal-text transition-colors"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span
            aria-label={`${unreadCount} avisos pendentes`}
            className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-status-outbid px-1 font-mono text-[10px] font-bold text-white tabular-nums shadow-sm"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id="notification-dropdown-menu"
          role="region"
          aria-labelledby="notification-bell-button"
          className="absolute right-0 top-full mt-2 z-50 flex w-80 sm:w-96 flex-col overflow-hidden rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface text-paper-text dark:text-charcoal-text shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-paper-border dark:border-charcoal-border bg-paper-muted/60 dark:bg-charcoal-muted/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-sans text-xs font-semibold uppercase tracking-wider text-paper-text dark:text-charcoal-text">
                Notificações
              </span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-status-outbid/10 border border-status-outbid/30 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-status-outbid dark:text-red-400 tabular-nums">
                  {unreadCount} nova{unreadCount > 1 ? "s" : ""}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleAudio}
                title={isAudioEnabled ? "Desativar alerta sonoro" : "Ativar alerta sonoro"}
                aria-label={isAudioEnabled ? "Desativar alerta sonoro" : "Ativar alerta sonoro"}
                className="text-paper-subtext hover:text-paper-text dark:text-charcoal-subtext dark:hover:text-charcoal-text p-1 transition-colors"
              >
                {isAudioEnabled ? (
                  <Volume2 className="h-3.5 w-3.5 text-status-winning" />
                ) : (
                  <VolumeX className="h-3.5 w-3.5" />
                )}
              </button>

              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="flex items-center gap-1 font-sans text-[11px] text-paper-subtext hover:text-paper-text dark:text-charcoal-subtext dark:hover:text-charcoal-text underline transition-colors"
                >
                  <CheckCheck className="h-3 w-3" />
                  Marcar todas como lidas
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[380px] overflow-y-auto divide-y divide-paper-border/50 dark:divide-charcoal-border/50">
            {notifications.length === 0 ? (
              <div className="py-10 text-center font-sans text-xs text-paper-subtext dark:text-charcoal-subtext">
                Nenhuma notificação por enquanto.
              </div>
            ) : (
              notifications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectNotification(item.actionUrl, item.id)}
                  className={`w-full text-left p-3.5 transition-colors flex items-start gap-3 ${
                    !item.read
                      ? "bg-paper-muted/50 hover:bg-paper-muted dark:bg-charcoal-muted/70 dark:hover:bg-charcoal-muted border-l-2 border-l-status-outbid"
                      : "hover:bg-paper-muted/30 dark:hover:bg-charcoal-muted/30 opacity-80 hover:opacity-100"
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {!item.read ? (
                      <span className="block h-2 w-2 rounded-full bg-status-outbid" />
                    ) : (
                      <span className="block h-2 w-2 rounded-full bg-transparent" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-sans text-xs font-semibold ${
                          item.type === "OUTBID"
                            ? "text-status-outbid dark:text-red-400"
                            : "text-paper-text dark:text-charcoal-text"
                        }`}
                      >
                        {item.title}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-paper-subtext dark:text-charcoal-subtext tabular-nums">
                        {formatRelativeTime(item.createdAt)}
                      </span>
                    </div>

                    <p className="mt-1 font-sans text-xs text-paper-text dark:text-charcoal-text leading-snug">
                      {item.message}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
