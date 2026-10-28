import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArtworkFrame } from "../components/ArtworkFrame.tsx";
import { CountdownBadge } from "../components/CountdownBadge.tsx";
import { UserDisputesSection } from "../components/dashboard/UserDisputesSection.tsx";
import { VerzelEmblem } from "../components/VerzelEmblem.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { lotsApi } from "../services/api.ts";
import type { Lot, LotStatus } from "../types/api.ts";
import { formatBrlCents, parseBrlToCents } from "../utils/formatters.ts";

type FilterOption = "ALL" | "LIVE" | "SCHEDULED" | "ENDED";
type SortOption = "ending_soon" | "highest_price" | "lowest_price" | "most_bids";

const FILTER_TABS: { value: FilterOption; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "LIVE", label: "Ao vivo" },
  { value: "SCHEDULED", label: "Agendados" },
  { value: "ENDED", label: "Encerrados" },
];

export const ShowcasePage: React.FC = () => {
  const { user } = useAuth();
  const [lots, setLots] = useState<Lot[]>([]);
  const [statusFilter, setStatusFilter] = useState<FilterOption>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortOption>("ending_soon");
  const [minPriceInput, setMinPriceInput] = useState<string>("");
  const [maxPriceInput, setMaxPriceInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadLots = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await lotsApi.listPublic(
        statusFilter === "ALL" ? undefined : statusFilter,
        searchQuery,
      );
      setLots(data.filter((item) => item.status !== "CANCELLED"));
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Falha ao carregar os lotes.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLots();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [loadLots]);

  const minPriceCents = minPriceInput.trim() ? parseBrlToCents(minPriceInput) : 0;
  const maxPriceCents = maxPriceInput.trim() ? parseBrlToCents(maxPriceInput) : 0;

  const displayedLots = lots
    .filter((lot) => {
      const activePrice =
        lot.current_bid_cents !== null
          ? lot.current_bid_cents
          : lot.starting_bid_cents;
      if (minPriceCents > 0 && activePrice < minPriceCents) {
        return false;
      }
      if (maxPriceCents > 0 && activePrice > maxPriceCents) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const priceA = a.current_bid_cents ?? a.starting_bid_cents;
      const priceB = b.current_bid_cents ?? b.starting_bid_cents;

      switch (sortBy) {
        case "highest_price":
          return priceB - priceA;
        case "lowest_price":
          return priceA - priceB;
        case "most_bids":
          return b.bid_count - a.bid_count;
        case "ending_soon":
        default:
          return new Date(a.end_time).getTime() - new Date(b.end_time).getTime();
      }
    });

  const statusBadge = (status: LotStatus) => {
    switch (status) {
      case "LIVE":
        return (
          <span className="rounded-full border border-primary bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white shadow-sm dark:border-gold dark:bg-gold dark:text-charcoal-bg">
            Ao vivo
          </span>
        );
      case "SCHEDULED":
        return (
          <span className="rounded-full border border-paper-border dark:border-charcoal-border bg-paper-muted dark:bg-charcoal-muted px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-paper-text dark:text-charcoal-text">
            Agendado
          </span>
        );
      case "ENDED":
        return (
          <span className="rounded-full border border-gold/60 bg-gold/10 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gold">
            Encerrado
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 space-y-8">
      {user && user.role === "BIDDER" && (
        <UserDisputesSection hideIfEmpty />
      )}

      <div>
        <div className="border-b border-paper-border dark:border-charcoal-border pb-6">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
          Lotes em Leilão
        </h1>
        <p className="mt-1 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
          Acompanhe os lotes abertos e participe do pregão.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filtrar lotes por status">
            {FILTER_TABS.map((tab) => {
              const active = statusFilter === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStatusFilter(tab.value)}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-medium uppercase tracking-wider transition-all duration-150 ${
                    active
                      ? "border-primary bg-primary text-white shadow-sm dark:border-gold dark:bg-gold dark:text-charcoal-bg"
                      : "border-paper-border bg-paper-surface text-paper-subtext hover:border-paper-text hover:text-paper-text dark:border-charcoal-border dark:bg-charcoal-surface dark:text-charcoal-subtext dark:hover:text-charcoal-text"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-80">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-paper-subtext dark:text-charcoal-subtext">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por obra, artista ou técnica..."
              aria-label="Buscar lotes por obra, artista ou técnica"
              className="h-[40px] w-full rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface pl-9 pr-3.5 text-xs text-paper-text dark:text-charcoal-text placeholder:text-paper-subtext dark:placeholder:text-charcoal-subtext focus:border-gold focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-paper-border/60 dark:border-charcoal-border/60 pt-4">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext mb-1">
              Ordenar por
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="h-[38px] rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-3 text-xs text-paper-text dark:text-charcoal-text focus:outline-none focus:border-gold"
            >
              <option value="ending_soon">Termina primeiro</option>
              <option value="highest_price">Maior preço</option>
              <option value="lowest_price">Menor preço</option>
              <option value="most_bids">Mais lances</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext mb-1">
              Preço de (R$)
            </label>
            <input
              type="text"
              value={minPriceInput}
              onChange={(e) => setMinPriceInput(e.target.value)}
              placeholder="0,00"
              className="h-[38px] w-28 sm:w-32 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-3 font-mono text-xs text-paper-text dark:text-charcoal-text placeholder:text-paper-subtext dark:placeholder:text-charcoal-subtext focus:outline-none focus:border-gold"
            />
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext mb-1">
              até (R$)
            </label>
            <input
              type="text"
              value={maxPriceInput}
              onChange={(e) => setMaxPriceInput(e.target.value)}
              placeholder="sem limite"
              className="h-[38px] w-28 sm:w-32 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-3 font-mono text-xs text-paper-text dark:text-charcoal-text placeholder:text-paper-subtext dark:placeholder:text-charcoal-subtext focus:outline-none focus:border-gold"
            />
          </div>

          {(minPriceInput || maxPriceInput || sortBy !== "ending_soon") && (
            <button
              type="button"
              onClick={() => {
                setMinPriceInput("");
                setMaxPriceInput("");
                setSortBy("ending_soon");
              }}
              className="h-[38px] px-3 text-xs text-paper-subtext hover:text-paper-text dark:text-charcoal-subtext dark:hover:text-charcoal-text underline"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="mt-6 rounded-sm border border-status-outbid bg-status-outbid/10 px-4 py-3 text-sm text-status-outbid"
        >
          {errorMsg}
        </div>
      )}

      {isLoading ? (
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-[460px] rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5 opacity-60"
            />
          ))}
        </div>
      ) : displayedLots.length === 0 ? (
        <div className="mt-8 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-12 text-center">
          <h2 className="font-serif text-xl font-semibold text-paper-text dark:text-charcoal-text">
            Nenhum lote encontrado
          </h2>
          <p className="mt-2 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
            Altere o filtro de status ou os parâmetros de preço para ver todo o acervo disponível.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {displayedLots.map((lot) => {
            const activePriceCents =
              lot.current_bid_cents !== null
                ? lot.current_bid_cents
                : lot.starting_bid_cents;
            const priceLabel =
              lot.current_bid_cents !== null ? "Lance atual" : "Lance inicial";

            return (
              <article
                key={lot.id}
                className="flex flex-col justify-between rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5 shadow-card transition-shadow hover:shadow-frame"
              >
                <div>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext tabular-nums">
                      Lote #{lot.lot_number}
                    </span>
                    {statusBadge(lot.status)}
                  </div>

                  <Link to={`/lots/${lot.id}`} className="block">
                    <ArtworkFrame
                      imageUrl={lot.image_url}
                      title={lot.title}
                      artist={lot.artist}
                      aspectClassName="h-60"
                    />
                  </Link>

                  <div className="mt-4">
                    <h2 className="font-serif text-lg font-bold tracking-tight text-paper-text dark:text-charcoal-text leading-snug">
                      <Link to={`/lots/${lot.id}`} className="hover:text-primary dark:hover:text-gold transition-colors">
                        {lot.title}
                      </Link>
                    </h2>
                    <p className="mt-1 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
                      {lot.artist} ({lot.date_display})
                    </p>
                    <p className="mt-0.5 text-xs text-paper-subtext dark:text-charcoal-subtext">
                      {lot.medium_display}
                    </p>
                  </div>
                </div>

                <div className="mt-5 border-t border-paper-border dark:border-charcoal-border pt-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                        {priceLabel} ({lot.bid_count} {lot.bid_count === 1 ? "lance" : "lances"})
                      </span>
                      <span className="font-mono text-xl font-bold tabular-nums text-primary dark:text-gold">
                        {formatBrlCents(activePriceCents)}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="block text-[10px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                        Cronômetro
                      </span>
                      <CountdownBadge
                        endTimeIso={lot.end_time}
                        startTimeIso={lot.start_time}
                        status={lot.status}
                        extensionCount={lot.extension_count}
                        onExpire={() => void loadLots()}
                      />
                    </div>
                  </div>

                  {lot.leader_masked_name && (
                    <div className="mt-2.5 flex items-center justify-between border-t border-paper-border/60 dark:border-charcoal-border/60 pt-2 text-xs">
                      <span className="text-paper-subtext dark:text-charcoal-subtext">
                        {lot.status === "ENDED" ? "Vencedor:" : "Líder atual:"}
                      </span>
                      <span className="font-mono font-medium text-paper-text dark:text-charcoal-text">
                        {lot.leader_masked_name}
                      </span>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <Link
                      to={`/lots/${lot.id}`}
                      className="flex-1 rounded-sm border border-primary bg-primary px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-primary-hover dark:border-gold dark:bg-gold dark:text-charcoal-bg dark:hover:bg-gold-hover"
                    >
                      {lot.status === "LIVE" ? "Dar lance →" : "Ver lote →"}
                    </Link>
                    <Link
                      to={`/lots/${lot.id}/audit`}
                      className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 py-2 text-xs font-medium text-paper-text dark:text-charcoal-text hover:border-paper-text dark:hover:border-charcoal-text"
                    >
                      Auditoria
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      </div>
    </main>
  );
};
