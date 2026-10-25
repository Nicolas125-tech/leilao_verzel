import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArtworkFrame } from "../components/ArtworkFrame.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { catalogApi, lotsApi, settlementApi } from "../services/api.ts";
import type {
  AuctioneerDashboard,
  CatalogItem,
  LotStatus,
} from "../types/api.ts";
import { formatBrlCents, parseBrlToCents } from "../utils/formatters.ts";

type AuctioneerTab = "management" | "catalog";

function formatStatusPt(status: LotStatus): string {
  switch (status) {
    case "LIVE":
      return "Ao vivo";
    case "SCHEDULED":
      return "Agendado";
    case "ENDED":
      return "Encerrado";
    case "CANCELLED":
      return "Cancelado";
    default:
      return status;
  }
}

export const AuctioneerDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AuctioneerTab>("management");

  const [dashboard, setDashboard] = useState<AuctioneerDashboard | null>(null);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState<boolean>(false);

  const [catalogQuery, setCatalogQuery] = useState<string>("");
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState<boolean>(false);
  const [selectedArtwork, setSelectedArtwork] = useState<CatalogItem | null>(null);

  const [startingBidInput, setStartingBidInput] = useState<string>("1800,00");
  const [minIncrementInput, setMinIncrementInput] = useState<string>("150,00");
  const [windowPreset, setWindowPreset] = useState<"live_30m" | "live_2m" | "scheduled_1h">("live_30m");
  const [isSubmittingLot, setIsSubmittingLot] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!user || user.role !== "AUCTIONEER") return;
    setIsLoadingDashboard(true);
    try {
      const data = await settlementApi.getAuctioneerDashboard();
      setDashboard(data);
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Falha ao carregar o painel do leiloeiro.",
      });
    } finally {
      setIsLoadingDashboard(false);
    }
  }, [user]);

  const loadCatalog = useCallback(
    async (q?: string) => {
      setIsLoadingCatalog(true);
      try {
        const items = await catalogApi.search(q);
        setCatalogItems(items);
        if (items.length > 0 && !selectedArtwork) {
          setSelectedArtwork(items[0]);
        }
      } catch (err) {
        setFeedback({
          type: "error",
          message:
            err instanceof Error ? err.message : "Erro ao consultar catálogo.",
        });
      } finally {
        setIsLoadingCatalog(false);
      }
    },
    [selectedArtwork],
  );

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (activeTab === "catalog" && catalogItems.length === 0) {
      void loadCatalog();
    }
  }, [activeTab, catalogItems.length, loadCatalog]);

  if (!user || user.role !== "AUCTIONEER") {
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6">
        <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-8">
          <h1 className="font-sans text-xl font-semibold text-paper-text dark:text-charcoal-text">
            Acesso exclusivo ao leiloeiro
          </h1>
          <p className="mt-2 text-sm text-paper-subtext dark:text-charcoal-subtext">
            Selecione o perfil de leiloeira (Helena Curadora) na barra superior para gerenciar lotes e publicar obras.
          </p>
        </div>
      </main>
    );
  }

  const handleCancelLot = async (lotId: string, lotNumber: number) => {
    setFeedback(null);
    try {
      await lotsApi.cancel(lotId);
      setFeedback({
        type: "success",
        message: `Lote #${lotNumber} cancelado. O saldo comprometido do líder foi estornado.`,
      });
      await loadDashboard();
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Falha ao cancelar lote.",
      });
    }
  };

  const handlePublishLot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedArtwork) return;

    const startingBidCents = parseBrlToCents(startingBidInput);
    const minIncrementCents = parseBrlToCents(minIncrementInput);
    if (startingBidCents <= 0 || minIncrementCents <= 0) {
      setFeedback({
        type: "error",
        message: "Lance inicial e incremento mínimo devem ser maiores que zero.",
      });
      return;
    }

    const now = new Date();
    let startTime: Date;
    let endTime: Date;
    if (windowPreset === "live_30m") {
      startTime = new Date(now.getTime() - 60 * 1000);
      endTime = new Date(now.getTime() + 30 * 60 * 1000);
    } else if (windowPreset === "live_2m") {
      startTime = new Date(now.getTime() - 60 * 1000);
      endTime = new Date(now.getTime() + 105 * 1000);
    } else {
      startTime = new Date(now.getTime() + 60 * 60 * 1000);
      endTime = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    }

    setIsSubmittingLot(true);
    setFeedback(null);
    try {
      const created = await lotsApi.create({
        external_artwork_id: selectedArtwork.external_id,
        title: selectedArtwork.title,
        artist: selectedArtwork.artist,
        date_display: selectedArtwork.date_display,
        medium_display: selectedArtwork.medium_display,
        image_url: selectedArtwork.image_url,
        attributes_json: selectedArtwork.attributes,
        starting_bid_cents: startingBidCents,
        min_increment_cents: minIncrementCents,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
      });
      setFeedback({
        type: "success",
        message: `Lote #${created.lot_number} (${created.title}) publicado com sucesso.`,
      });
      await loadDashboard();
      setActiveTab("management");
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Erro ao publicar lote.",
      });
    } finally {
      setIsSubmittingLot(false);
    }
  };

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-paper-border dark:border-charcoal-border pb-6">
        <div>
          <h1 className="font-sans text-2xl font-semibold tracking-tight text-paper-text dark:text-charcoal-text sm:text-3xl">
            Painel do Leiloeiro
          </h1>
          <p className="mt-1.5 text-sm text-paper-subtext dark:text-charcoal-subtext">
            Acompanhe os lotes publicados, o faturamento recebido e cadastre novas obras.
          </p>
        </div>

        <div className="flex items-center gap-2" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "management"}
            onClick={() => setActiveTab("management")}
            className={`rounded-sm border px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === "management"
                ? "border-paper-text bg-paper-text text-paper-surface dark:border-charcoal-text dark:bg-charcoal-text dark:text-charcoal-bg"
                : "border-paper-border bg-paper-surface text-paper-subtext dark:border-charcoal-border dark:bg-charcoal-surface dark:text-charcoal-subtext"
            }`}
          >
            Lotes e Faturamento
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "catalog"}
            onClick={() => setActiveTab("catalog")}
            className={`rounded-sm border px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === "catalog"
                ? "border-primary bg-primary text-white"
                : "border-paper-border bg-paper-surface text-paper-subtext dark:border-charcoal-border dark:bg-charcoal-surface dark:text-charcoal-subtext"
            }`}
          >
            Catalogar Nova Obra
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="alert"
          className={`mt-6 rounded-sm border px-4 py-3 text-sm ${
            feedback.type === "success"
              ? "border-status-winning bg-status-winning/10 text-status-winning"
              : "border-status-outbid bg-status-outbid/10 text-status-outbid"
          }`}
        >
          {feedback.message}
        </div>
      )}

      {activeTab === "management" ? (
        <div className="mt-6">
          {dashboard && (
            <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5">
                <span className="text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
                  Faturamento total recebido
                </span>
                <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-status-winning">
                  {formatBrlCents(dashboard.total_revenue_cents)}
                </p>
              </div>

              <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5">
                <span className="text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
                  Lotes liquidados com vencedor
                </span>
                <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-paper-text dark:text-charcoal-text">
                  {dashboard.settled_with_winner_count}
                </p>
              </div>

              <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5">
                <span className="text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
                  Lotes ativos (ao vivo ou agendados)
                </span>
                <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-paper-text dark:text-charcoal-text">
                  {dashboard.active_lots_count}
                </p>
              </div>
            </section>
          )}

          <section className="mt-6 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface">
            <div className="border-b border-paper-border dark:border-charcoal-border px-6 py-4">
              <h2 className="font-sans text-lg font-semibold text-paper-text dark:text-charcoal-text">
                Lotes publicados
              </h2>
            </div>

            {isLoadingDashboard ? (
              <div className="p-6 text-sm text-paper-subtext dark:text-charcoal-subtext">
                Carregando lotes...
              </div>
            ) : !dashboard || dashboard.lots.length === 0 ? (
              <div className="p-6 text-sm text-paper-subtext dark:text-charcoal-subtext">
                Nenhum lote publicado ainda. Use a aba Catalogar Nova Obra.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-paper-border dark:border-charcoal-border bg-paper-muted/50 dark:bg-charcoal-muted/50 text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
                      <th className="px-5 py-3">Lote</th>
                      <th className="px-5 py-3">Obra / Artista</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3 text-right">Lances</th>
                      <th className="px-5 py-3 text-right">Maior oferta / Inicial</th>
                      <th className="px-5 py-3">Líder / Vencedor</th>
                      <th className="px-5 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.lots.map((lot) => (
                      <tr
                        key={lot.id}
                        className="border-b border-paper-border dark:border-charcoal-border last:border-b-0"
                      >
                        <td className="px-5 py-3.5 font-mono text-xs font-semibold tabular-nums">
                          #{lot.lot_number}
                        </td>
                        <td className="px-5 py-3.5">
                          <Link
                            to={`/lots/${lot.id}`}
                            className="font-sans text-sm font-semibold hover:underline"
                          >
                            {lot.title}
                          </Link>
                          <span className="block text-xs text-paper-subtext dark:text-charcoal-subtext">
                            {lot.artist}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-xs font-medium">
                          {formatStatusPt(lot.status)}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-xs tabular-nums">
                          {lot.bid_count}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-xs font-semibold tabular-nums">
                          {formatBrlCents(
                            lot.current_bid_cents ?? lot.starting_bid_cents,
                          )}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs">
                          {lot.leader_masked_name || "Sem lances"}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="inline-flex items-center gap-2">
                            {lot.certificate && (
                              <Link
                                to={`/receipts/${lot.certificate.receipt_code}`}
                                className="rounded-sm border border-gold px-2.5 py-1 text-xs font-medium text-gold hover:bg-gold/10"
                              >
                                Ver comprovante
                              </Link>
                            )}
                            {(lot.status === "LIVE" ||
                              lot.status === "SCHEDULED") && (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleCancelLot(lot.id, lot.lot_number)
                                }
                                className="rounded-sm border border-status-outbid px-2.5 py-1 text-xs font-medium text-status-outbid hover:bg-status-outbid hover:text-white"
                              >
                                Cancelar lote
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <section className="lg:col-span-7">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void loadCatalog(catalogQuery);
              }}
              className="flex gap-2"
            >
              <input
                type="search"
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                placeholder="Pesquisar no Cleveland Museum of Art (ex: Monet, Picasso, Van Gogh, Rembrandt)..."
                className="h-[42px] flex-1 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-3.5 text-sm"
              />
              <button
                type="submit"
                disabled={isLoadingCatalog}
                className="h-[42px] rounded-sm border border-paper-text dark:border-charcoal-text bg-paper-text dark:bg-charcoal-text px-4 text-xs font-semibold text-paper-surface dark:text-charcoal-bg"
              >
                {isLoadingCatalog ? "Buscando..." : "Buscar acervo"}
              </button>
            </form>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {catalogItems.map((item) => {
                const isSelected =
                  selectedArtwork?.external_id === item.external_id;
                return (
                  <button
                    key={item.external_id}
                    type="button"
                    onClick={() => setSelectedArtwork(item)}
                    className={`rounded-sm border p-4 text-left transition-colors ${
                      isSelected
                        ? "border-primary bg-paper-surface dark:bg-charcoal-surface"
                        : "border-paper-border dark:border-charcoal-border bg-paper-surface/70 dark:bg-charcoal-surface/70 hover:border-paper-text"
                    }`}
                  >
                    <ArtworkFrame
                      imageUrl={item.image_url}
                      title={item.title}
                      artist={item.artist}
                      aspectClassName="h-40"
                    />
                    <div className="mt-3 flex items-center justify-between">
                      <span className="font-mono text-[10px] text-paper-subtext dark:text-charcoal-subtext">
                        ID #{item.external_id}
                      </span>
                      <span className="text-[10px] font-medium text-gold">
                        {item.source === "local_fallback"
                          ? "Acervo local"
                          : "Cleveland Museum of Art"}
                      </span>
                    </div>
                    <h3 className="mt-1 font-sans text-base font-semibold text-paper-text dark:text-charcoal-text">
                      {item.title}
                    </h3>
                    <p className="text-xs text-paper-subtext dark:text-charcoal-subtext">
                      {item.artist} ({item.date_display})
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="lg:col-span-5">
            <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6">
              <h2 className="font-sans text-lg font-semibold text-paper-text dark:text-charcoal-text">
                Publicar novo lote
              </h2>

              {selectedArtwork ? (
                <form
                  onSubmit={(e) => void handlePublishLot(e)}
                  className="mt-4 space-y-4"
                >
                  <ArtworkFrame
                    imageUrl={selectedArtwork.image_url}
                    title={selectedArtwork.title}
                    artist={selectedArtwork.artist}
                    aspectClassName="h-52"
                  />

                  <div className="border-b border-paper-border dark:border-charcoal-border pb-3">
                    <h3 className="font-sans text-base font-semibold">
                      {selectedArtwork.title}
                    </h3>
                    <p className="text-xs text-paper-subtext dark:text-charcoal-subtext">
                      {selectedArtwork.artist} ({selectedArtwork.date_display}) - {selectedArtwork.medium_display}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
                        Lance inicial (R$)
                      </label>
                      <input
                        type="text"
                        required
                        value={startingBidInput}
                        onChange={(e) => setStartingBidInput(e.target.value)}
                        className="mt-1 h-[42px] w-full rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 font-mono text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
                        Incremento mínimo (R$)
                      </label>
                      <input
                        type="text"
                        required
                        value={minIncrementInput}
                        onChange={(e) => setMinIncrementInput(e.target.value)}
                        className="mt-1 h-[42px] w-full rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 font-mono text-sm tabular-nums"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
                      Duração do lote
                    </label>
                    <select
                      value={windowPreset}
                      onChange={(e) =>
                        setWindowPreset(
                          e.target.value as "live_30m" | "live_2m" | "scheduled_1h",
                        )
                      }
                      className="mt-1 h-[42px] w-full rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 text-sm"
                    >
                      <option value="live_30m">
                        Iniciar ao vivo agora (duração: 30 minutos)
                      </option>
                      <option value="live_2m">
                        Iniciar nos últimos 105s (para testar prorrogação +2 min)
                      </option>
                      <option value="scheduled_1h">
                        Agendar início para daqui a 1 hora
                      </option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmittingLot}
                    className="w-full rounded-sm border border-primary bg-primary px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
                  >
                    {isSubmittingLot ? "Publicando..." : "Publicar lote"}
                  </button>
                </form>
              ) : (
                <p className="mt-4 text-sm text-paper-subtext dark:text-charcoal-subtext">
                  Selecione uma obra ao lado para configurar o lote.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
};
