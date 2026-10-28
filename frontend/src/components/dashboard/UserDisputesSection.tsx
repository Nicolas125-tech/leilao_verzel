import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { ArtworkFrame } from "../ArtworkFrame.tsx";
import { lotsApi } from "../../services/api.ts";
import type { DisputeItem, MyDisputesResponse } from "../../types/api.ts";
import { formatBrlCents } from "../../utils/formatters.ts";

export type DisputeTabKey = "ALL" | "IN_DISPUTE" | "WON" | "LOST";

interface TabDefinition {
  key: DisputeTabKey;
  label: string;
  getCount: (counts: MyDisputesResponse["counts"], totalItems: number) => number;
}

const TABS: TabDefinition[] = [
  { key: "IN_DISPUTE", label: "Em Disputa", getCount: (c) => c.in_dispute },
  { key: "WON", label: "Arrematados", getCount: (c) => c.won },
  { key: "LOST", label: "Não Arrematados", getCount: (c) => c.lost },
  { key: "ALL", label: "Todos", getCount: (_c, total) => total },
];

interface StatusVisual {
  badgeLabel: string;
  badgeClass: string;
  hasPulse: boolean;
  pulseClass?: string;
  cardBorderClass: string;
  actionLabel: string;
  actionClass: string;
}

const STATUS_VISUALS: Record<string, StatusVisual> = {
  WINNING: {
    badgeLabel: "Liderando",
    badgeClass: "border-status-winning/40 bg-status-winning/10 text-status-winning",
    hasPulse: true,
    pulseClass: "bg-status-winning",
    cardBorderClass: "border-status-winning/50 bg-status-winning/[0.03]",
    actionLabel: "Acompanhar Sala ao Vivo",
    actionClass:
      "border border-primary bg-primary text-white hover:bg-primary-hover dark:border-gold dark:bg-gold dark:text-charcoal-bg",
  },
  OUTBID: {
    badgeLabel: "Superado",
    badgeClass: "border-status-outbid/40 bg-status-outbid/10 text-status-outbid",
    hasPulse: true,
    pulseClass: "bg-status-outbid",
    cardBorderClass: "border-status-outbid/50 bg-status-outbid/[0.03]",
    actionLabel: "Cobrir Lance Imediatamente",
    actionClass: "border border-status-outbid bg-status-outbid text-white hover:bg-status-outbid/90",
  },
  WON: {
    badgeLabel: "Arrematado",
    badgeClass: "border-gold/40 bg-gold/15 text-gold",
    hasPulse: false,
    cardBorderClass: "border-gold/50 bg-gold/[0.04]",
    actionLabel: "Ver Lote Arrematado",
    actionClass: "border border-gold bg-gold/15 text-gold hover:bg-gold/25",
  },
  LOST: {
    badgeLabel: "Não arrematado",
    badgeClass:
      "border-paper-border dark:border-charcoal-border bg-paper-muted dark:bg-charcoal-muted text-paper-subtext dark:text-charcoal-subtext",
    hasPulse: false,
    cardBorderClass: "border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface",
    actionLabel: "Ver Histórico do Lote",
    actionClass:
      "border border-paper-border dark:border-charcoal-border bg-paper-muted/50 dark:bg-charcoal-muted/50 text-paper-text dark:text-charcoal-text hover:bg-paper-muted",
  },
};

const DEFAULT_STATUS_VISUAL: StatusVisual = {
  badgeLabel: "Lote",
  badgeClass:
    "border-paper-border dark:border-charcoal-border bg-paper-muted dark:bg-charcoal-muted text-paper-subtext dark:text-charcoal-subtext",
  hasPulse: false,
  cardBorderClass: "border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface",
  actionLabel: "Ver Lote",
  actionClass:
    "border border-paper-border dark:border-charcoal-border bg-paper-muted/50 dark:bg-charcoal-muted/50 text-paper-text dark:text-charcoal-text hover:bg-paper-muted",
};

interface UserDisputesSectionProps {
  className?: string;
  title?: string;
  subtitle?: string;
  hideIfEmpty?: boolean;
}

export const UserDisputesSection: React.FC<UserDisputesSectionProps> = ({
  className = "",
  title = "Painel de Disputas do Licitante",
  subtitle = "Acompanhe seus lances e veja se alguma oferta sua foi superada.",
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

  return (
    <section
      aria-label="Disputas do Licitante"
      className={`rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5 sm:p-6 ${className}`}
    >
      <div className="flex flex-col gap-4 border-b border-paper-border dark:border-charcoal-border pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm bg-status-winning" />
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
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-b border-paper-border dark:border-charcoal-border pb-3">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const count = tab.getCount(counts, items.length);
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                isActive
                  ? "bg-paper-text text-paper-bg dark:bg-charcoal-text dark:text-charcoal-bg"
                  : "border border-paper-border dark:border-charcoal-border text-paper-subtext dark:text-charcoal-subtext hover:bg-paper-muted dark:hover:bg-charcoal-muted"
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
                  isActive
                    ? "bg-paper-bg/20 text-paper-bg dark:bg-charcoal-bg/30 dark:text-charcoal-bg"
                    : "bg-paper-muted dark:bg-charcoal-muted text-paper-subtext dark:text-charcoal-subtext"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
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
            Você ainda não participou de nenhum lote nesta categoria. Explore a vitrine!
          </p>
          <div className="mt-3">
            <Link
              to="/?status=LIVE"
              className="inline-flex items-center rounded-sm border border-primary bg-primary px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-white hover:bg-primary-hover dark:border-gold dark:bg-gold dark:text-charcoal-bg"
            >
              Ver Lotes ao Vivo
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => {
            const visual = STATUS_VISUALS[item.status] ?? DEFAULT_STATUS_VISUAL;
            return (
              <article
                key={item.lot_id}
                className={`flex flex-col justify-between rounded-sm border p-4 transition-all duration-200 ${visual.cardBorderClass}`}
              >
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold tabular-nums text-paper-subtext dark:text-charcoal-subtext">
                      Lote #{item.lot_number}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${visual.badgeClass}`}
                    >
                      {visual.hasPulse && visual.pulseClass && (
                        <span className={`h-1.5 w-1.5 rounded-sm ${visual.pulseClass}`} />
                      )}
                      {visual.badgeLabel}
                    </span>
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
                        Tempo Restante
                      </span>
                      <span className="font-mono text-[11px] font-semibold tabular-nums text-paper-text dark:text-charcoal-text">
                        {item.time_remaining_formatted}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-paper-border dark:border-charcoal-border pt-3">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[11px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext shrink-0">
                      Líder:
                    </span>
                    <span className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-muted/60 dark:bg-charcoal-muted/60 px-2 py-0.5 font-mono text-[11px] tabular-nums text-paper-text dark:text-charcoal-text truncate">
                      {item.leader_pseudonym}
                    </span>
                  </div>

                  <div className="sm:shrink-0">
                    <Link
                      to={`/lots/${item.lot_id}`}
                      className={`inline-flex w-full sm:w-auto items-center justify-center rounded-sm px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${visual.actionClass}`}
                    >
                      {visual.actionLabel}
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
