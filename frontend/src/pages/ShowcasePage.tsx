import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArtworkFrame } from "../components/ArtworkFrame.tsx";
import { CountdownBadge } from "../components/CountdownBadge.tsx";
import { lotsApi } from "../services/api.ts";
import type { Lot, LotStatus } from "../types/api.ts";
import { formatBrlCents } from "../utils/formatters.ts";

type FilterOption = "ALL" | "LIVE" | "SCHEDULED" | "ENDED";

const FILTER_TABS: { value: FilterOption; label: string }[] = [
  { value: "ALL", label: "TODOS" },
  { value: "LIVE", label: "AO VIVO" },
  { value: "SCHEDULED", label: "AGENDADOS" },
  { value: "ENDED", label: "ENCERRADOS" },
];

export const ShowcasePage: React.FC = () => {
  const [lots, setLots] = useState<Lot[]>([]);
  const [statusFilter, setStatusFilter] = useState<FilterOption>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
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
      // Garante que lotes CANCELLED permaneçam ocultos na vitrine publica
      setLots(data.filter((item) => item.status !== "CANCELLED"));
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Falha ao carregar vitrine de lotes.",
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

  const statusBadge = (status: LotStatus) => {
    switch (status) {
      case "LIVE":
        return (
          <span className="rounded-sm border border-primary bg-primary px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-white">
            AO VIVO
          </span>
        );
      case "SCHEDULED":
        return (
          <span className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-muted dark:bg-charcoal-muted px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wider text-paper-text dark:text-charcoal-text">
            AGENDADO
          </span>
        );
      case "ENDED":
        return (
          <span className="rounded-sm border border-gold/60 bg-gold/10 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wider text-gold">
            ENCERRADO
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
      <div className="border-b border-paper-border dark:border-charcoal-border pb-6">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-paper-text dark:text-charcoal-text sm:text-4xl">
          Catalogo de Lotes em Pregao
        </h1>
        <p className="mt-2 max-w-[68ch] text-sm text-paper-subtext dark:text-charcoal-subtext">
          Obras catalogadas com liquidacao financeira atomica em centavos, reserva imediata de saldo comprometido e encadeamento criptografico verificavel.
        </p>

        {/* Barra de filtros secos e busca textual */}
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
                  className={`rounded-sm border px-3.5 py-2 font-mono text-xs font-medium tracking-wider transition-colors ${
                    active
                      ? "border-paper-text bg-paper-text text-paper-surface dark:border-charcoal-text dark:bg-charcoal-text dark:text-charcoal-bg"
                      : "border-paper-border bg-paper-surface text-paper-subtext hover:border-paper-text hover:text-paper-text dark:border-charcoal-border dark:bg-charcoal-surface dark:text-charcoal-subtext dark:hover:text-charcoal-text"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex w-full items-center gap-2 sm:w-80">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por obra, artista ou tecnica..."
              aria-label="Buscar lotes por obra, artista ou tecnica"
              className="h-[42px] w-full rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-3.5 text-sm text-paper-text dark:text-charcoal-text placeholder:text-paper-subtext dark:placeholder:text-charcoal-subtext"
            />
          </div>
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
              className="h-[440px] rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5 opacity-60"
            />
          ))}
        </div>
      ) : lots.length === 0 ? (
        <div className="mt-8 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-10 text-center">
          <h2 className="font-serif text-xl font-semibold text-paper-text dark:text-charcoal-text">
            Nenhum lote encontrado para este recorte
          </h2>
          <p className="mt-2 text-sm text-paper-subtext dark:text-charcoal-subtext">
            Altere o filtro de status ou limpe o termo de busca para visualizar todo o acervo disponivel.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {lots.map((lot) => {
            const activePriceCents =
              lot.current_bid_cents !== null
                ? lot.current_bid_cents
                : lot.starting_bid_cents;
            const priceLabel =
              lot.current_bid_cents !== null ? "Lance Atual" : "Lance Inicial";

            return (
              <article
                key={lot.id}
                className="flex flex-col justify-between rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5"
              >
                <div>
                  {/* Cabecalho do Card */}
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-medium tracking-wider text-paper-subtext dark:text-charcoal-subtext tabular-nums">
                      LOTE #{lot.lot_number}
                    </span>
                    {statusBadge(lot.status)}
                  </div>

                  {/* Moldura Passe-Partout */}
                  <Link to={`/lots/${lot.id}`} className="block">
                    <ArtworkFrame
                      imageUrl={lot.image_url}
                      title={lot.title}
                      artist={lot.artist}
                      aspectClassName="h-60"
                    />
                  </Link>

                  {/* Metadados Editoriais */}
                  <div className="mt-4">
                    <h2 className="font-serif text-2xl font-semibold leading-snug text-paper-text dark:text-charcoal-text">
                      <Link to={`/lots/${lot.id}`} className="hover:underline">
                        {lot.title}
                      </Link>
                    </h2>
                    <p className="mt-1 text-sm text-paper-subtext dark:text-charcoal-subtext">
                      {lot.artist} ({lot.date_display})
                    </p>
                    <p className="mt-0.5 text-xs text-paper-subtext dark:text-charcoal-subtext">
                      {lot.medium_display}
                    </p>
                  </div>
                </div>

                {/* Rodape Financeiro e Cronometro */}
                <div className="mt-5 border-t border-paper-border dark:border-charcoal-border pt-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <span className="block font-mono text-[11px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                        {priceLabel} ({lot.bid_count} {lot.bid_count === 1 ? "lance" : "lances"})
                      </span>
                      <span className="font-sans text-lg font-bold tabular-nums text-paper-text dark:text-charcoal-text">
                        {formatBrlCents(activePriceCents)}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="block font-mono text-[11px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                        Cronometro
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
                        {lot.status === "ENDED" ? "Vencedor:" : "Lider atual:"}
                      </span>
                      <span className="font-mono font-medium text-paper-text dark:text-charcoal-text">
                        {lot.leader_masked_name}
                      </span>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <Link
                      to={`/lots/${lot.id}`}
                      className="flex-1 rounded-sm border border-primary bg-primary px-3 py-2 text-center text-xs font-semibold text-white transition-colors hover:bg-primary-hover"
                    >
                      {lot.status === "LIVE" ? "Entrar na Sala ao Vivo" : "Inspecionar Lote"}
                    </Link>
                    <Link
                      to={`/lots/${lot.id}/audit`}
                      className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 py-2 font-mono text-xs text-paper-text dark:text-charcoal-text hover:border-paper-text dark:hover:border-charcoal-text"
                    >
                      Auditoria SHA-256
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
};
