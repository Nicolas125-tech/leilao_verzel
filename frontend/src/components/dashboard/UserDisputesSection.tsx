import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArtworkFrame } from "../ArtworkFrame.tsx";
import { lotsApi } from "../../services/api.ts";
import type { DisputeItem, MyDisputesResponse } from "../../types/api.ts";
import { formatBrlCents } from "../../utils/formatters.ts";

export type DisputeTabKey = "ALL" | "IN_DISPUTE" | "WON" | "LOST";

interface UserDisputesSectionProps {
  className?: string;
  title?: string;
  subtitle?: string;
  hideIfEmpty?: boolean;
}

export const UserDisputesSection: React.FC<UserDisputesSectionProps> = ({
  className = "",
  title = "Painel de Disputas do Licitante",
  subtitle = "Monitore a liderança de seus lances e reaja imediatamente caso seja superado.",
  hideIfEmpty = false,
}) => {
  const [data, setData] = useState<MyDisputesResponse | null>(null);
  const [activeTab, setActiveTab] = useState<DisputeTabKey>("IN_DISPUTE");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadDisputes = useCallback(async (quiet = false) => {
    if (!quiet) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setErrorMsg(null);
    try {
      const response = await lotsApi.getMyDisputes();
      setData(response);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Falha ao carregar o painel de disputas.",
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDisputes(false);
    const interval = window.setInterval(() => {
      void loadDisputes(true);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [loadDisputes]);

  if (hideIfEmpty && !isLoading && (!data || data.items.length === 0)) {
    return null;
  }

  const items = data?.items ?? [];
  const counts = data?.counts ?? { in_dispute: 0, won: 0, lost: 0 };

  const filteredItems = items.filter((item) => {
    switch (activeTab) {
      case "IN_DISPUTE":
        return item.status === "WINNING" || item.status === "OUTBID";
      case "WON":
        return item.status === "WON";
      case "LOST":
        return item.status === "LOST";
      case "ALL":
      default:
        return true;
    }
  });

  const renderStatusBadge = (item: DisputeItem) => {
    switch (item.status) {
      case "WINNING":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-status-winning/40 bg-status-winning/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-status-winning">
            <span className="h-1.5 w-1.5 rounded-full bg-status-winning animate-pulse" />
            Liderando
          </span>
        );
      case "OUTBID":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-status-outbid/40 bg-status-outbid/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-status-outbid">
            <span className="h-1.5 w-1.5 rounded-full bg-status-outbid" />
            Superado
          </span>
        );
      case "WON":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-gold">
            Arrematado
          </span>
        );
      case "LOST":
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-paper-border dark:border-charcoal-border bg-paper-muted dark:bg-charcoal-muted px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
            Não arrematado
          </span>
        );
    }
  };

  const renderActionButton = (item: DisputeItem) => {
    switch (item.status) {
      case "OUTBID":
        return (
          <Link
            to={`/lots/${item.lot_id}`}
            className="inline-flex w-full items-center justify-center rounded-sm border border-status-outbid bg-status-outbid px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-status-outbid/90 focus:outline-none"
          >
            Cobrir Lance Imediatamente
          </Link>
        );
      case "WINNING":
        return (
          <Link
            to={`/lots/${item.lot_id}`}
            className="inline-flex w-full items-center justify-center rounded-sm border border-primary bg-primary px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-primary-hover dark:border-gold dark:bg-gold dark:text-charcoal-bg focus:outline-none"
          >
            Acompanhar Sala ao Vivo
          </Link>
        );
      case "WON":
        return (
          <Link
            to={`/lots/${item.lot_id}`}
            className="inline-flex w-full items-center justify-center rounded-sm border border-gold bg-gold/15 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gold transition-colors hover:bg-gold/25 focus:outline-none"
          >
            Ver Lote Arrematado
          </Link>
        );
      case "LOST":
      default:
        return (
          <Link
            to={`/lots/${item.lot_id}`}
            className="inline-flex w-full items-center justify-center rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-muted/50 dark:bg-charcoal-muted/50 px-3 py-2 text-xs font-medium uppercase tracking-wider text-paper-text dark:text-charcoal-text transition-colors hover:bg-paper-muted focus:outline-none"
          >
            Ver Histórico do Lote
          </Link>
        );
    }
  };

  return (
    <section
      aria-label="Disputas do Licitante"
      className={`rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5 sm:p-6 shadow-card ${className}`}
    >
      <div className="flex flex-col gap-4 border-b border-paper-border dark:border-charcoal-border pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-status-winning" />
            <h2 className="font-serif text-xl sm:text-2xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
              {title}
            </h2>
          </div>
          <p className="mt-1 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
            {subtitle}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadDisputes(false)}
          disabled={isLoading || isRefreshing}
          className="inline-flex self-start sm:self-auto items-center gap-1.5 rounded-sm border border-paper-border dark:border-charcoal-border px-3 py-1.5 font-sans text-xs font-medium uppercase tracking-wider text-paper-text dark:text-charcoal-text hover:bg-paper-muted dark:hover:bg-charcoal-muted transition-colors disabled:opacity-50"
          title="Atualizar disputas"
        >
          <span className={`inline-block ${isRefreshing ? "animate-spin" : ""}`}>
            ↻
          </span>
          Atualizar
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-b border-paper-border dark:border-charcoal-border pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("IN_DISPUTE")}
          className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            activeTab === "IN_DISPUTE"
              ? "bg-primary text-white dark:bg-gold dark:text-charcoal-bg"
              : "border border-paper-border dark:border-charcoal-border text-paper-subtext dark:text-charcoal-subtext hover:bg-paper-muted dark:hover:bg-charcoal-muted"
          }`}
        >
          <span>Em Disputa</span>
          <span className="rounded-full bg-black/20 dark:bg-black/30 px-1.5 py-0.2 text-[10px] font-mono tabular-nums">
            {counts.in_dispute}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("WON")}
          className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            activeTab === "WON"
              ? "bg-primary text-white dark:bg-gold dark:text-charcoal-bg"
              : "border border-paper-border dark:border-charcoal-border text-paper-subtext dark:text-charcoal-subtext hover:bg-paper-muted dark:hover:bg-charcoal-muted"
          }`}
        >
          <span>Arrematados</span>
          <span className="rounded-full bg-black/20 dark:bg-black/30 px-1.5 py-0.2 text-[10px] font-mono tabular-nums">
            {counts.won}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("LOST")}
          className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            activeTab === "LOST"
              ? "bg-primary text-white dark:bg-gold dark:text-charcoal-bg"
              : "border border-paper-border dark:border-charcoal-border text-paper-subtext dark:text-charcoal-subtext hover:bg-paper-muted dark:hover:bg-charcoal-muted"
          }`}
        >
          <span>Não Arrematados</span>
          <span className="rounded-full bg-black/20 dark:bg-black/30 px-1.5 py-0.2 text-[10px] font-mono tabular-nums">
            {counts.lost}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("ALL")}
          className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            activeTab === "ALL"
              ? "bg-primary text-white dark:bg-gold dark:text-charcoal-bg"
              : "border border-paper-border dark:border-charcoal-border text-paper-subtext dark:text-charcoal-subtext hover:bg-paper-muted dark:hover:bg-charcoal-muted"
          }`}
        >
          <span>Todos</span>
          <span className="rounded-full bg-black/20 dark:bg-black/30 px-1.5 py-0.2 text-[10px] font-mono tabular-nums">
            {items.length}
          </span>
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="mt-4 rounded-sm border border-status-outbid/50 bg-status-outbid/10 p-4 text-xs font-medium text-status-outbid"
        >
          {errorMsg}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
          Carregando disputas ativas...
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="mt-4 rounded-sm border border-dashed border-paper-border dark:border-charcoal-border p-8 text-center">
          <p className="font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
            {items.length === 0
              ? "Você ainda não participou de disputas neste pregão."
              : "Nenhum lote nesta categoria."}
          </p>
          {items.length === 0 && (
            <div className="mt-3">
              <Link
                to="/"
                className="inline-flex items-center rounded-sm border border-primary bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-white hover:bg-primary-hover dark:border-gold dark:bg-gold dark:text-charcoal-bg"
              >
                Explorar Vitrine de Lotes
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => (
            <article
              key={item.lot_id}
              className={`flex flex-col justify-between rounded-sm border p-4 transition-all duration-200 ${
                item.status === "OUTBID"
                  ? "border-status-outbid/50 bg-status-outbid/[0.03] shadow-sm"
                  : item.status === "WINNING"
                  ? "border-status-winning/50 bg-status-winning/[0.03] shadow-sm"
                  : item.status === "WON"
                  ? "border-gold/50 bg-gold/[0.04] shadow-sm"
                  : "border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold tabular-nums text-paper-subtext dark:text-charcoal-subtext">
                    Lote #{item.lot_number}
                  </span>
                  {renderStatusBadge(item)}
                </div>

                <div className="mt-3">
                  <ArtworkFrame
                    imageUrl={item.artwork_image_url}
                    title={item.artwork_title}
                    artist={item.artwork_artist}
                    aspectClassName="h-36"
                  />
                </div>

                <h3 className="mt-3 font-serif text-base font-bold leading-snug text-paper-text dark:text-charcoal-text line-clamp-1">
                  <Link
                    to={`/lots/${item.lot_id}`}
                    className="hover:text-primary dark:hover:text-gold transition-colors"
                  >
                    {item.artwork_title}
                  </Link>
                </h3>
                <p className="font-serif italic text-xs text-paper-subtext dark:text-charcoal-subtext truncate">
                  {item.artwork_artist}
                </p>

                <div className="mt-4 space-y-2 border-t border-paper-border dark:border-charcoal-border pt-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                      Sua Maior Oferta
                    </span>
                    <span className="font-mono font-bold tabular-nums text-paper-text dark:text-charcoal-text">
                      {formatBrlCents(item.user_highest_bid_cents)}
                      <span className="ml-1 text-[10px] font-normal text-paper-subtext dark:text-charcoal-subtext">
                        ({item.user_bid_count} {item.user_bid_count === 1 ? "lance" : "lances"})
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                      Maior Lance Atual
                    </span>
                    <span className="font-mono font-bold tabular-nums text-primary dark:text-gold">
                      {formatBrlCents(item.current_bid_cents)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                      Líder Atual
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-paper-subtext dark:text-charcoal-subtext">
                      {item.leader_pseudonym}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                      Tempo Restante
                    </span>
                    <span className="font-mono text-[11px] font-semibold tabular-nums text-paper-text dark:text-charcoal-text">
                      {item.time_remaining_formatted}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-2">
                {renderActionButton(item)}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
