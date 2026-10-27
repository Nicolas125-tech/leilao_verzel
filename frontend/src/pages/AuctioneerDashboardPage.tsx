import React, { useCallback, useEffect, useState } from "react";
import { ArtworkCatalogPicker } from "../components/dashboard/ArtworkCatalogPicker.tsx";
import { AuctionLotsTable } from "../components/dashboard/AuctionLotsTable.tsx";
import { LotPublishForm } from "../components/dashboard/LotPublishForm.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { catalogApi, lotsApi, settlementApi } from "../services/api.ts";
import type {
  AuctioneerDashboard,
  CatalogItem,
} from "../types/api.ts";
import { parseBrlToCents } from "../utils/formatters.ts";

type AuctioneerTab = "management" | "catalog";

function formatLocalDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
  const [catalogPage, setCatalogPage] = useState<number>(1);
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const [startingBidInput, setStartingBidInput] = useState<string>("1000,00");
  const [minIncrementInput, setMinIncrementInput] = useState<string>("50,00");
  const [startTimeInput, setStartTimeInput] = useState<string>(() => {
    return formatLocalDateTime(new Date());
  });
  const [endTimeInput, setEndTimeInput] = useState<string>(() => {
    const nextDay = new Date();
    nextDay.setDate(nextDay.getDate() + 1);
    return formatLocalDateTime(nextDay);
  });
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
    async (q?: string, page: number = 1) => {
      setIsLoadingCatalog(true);
      try {
        const skip = (page - 1) * 8;
        const items = await catalogApi.search(q, skip, 8);
        setCatalogItems(items);
        setCatalogPage(page);
        if (items.length > 0 && (!selectedArtwork || page !== 1)) {
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

  const handlePageChange = (newPage: number) => {
    void loadCatalog(catalogQuery, newPage);
  };

  const handleSelectCategory = (categoryId: string, queryText: string) => {
    setActiveCategory(categoryId);
    setCatalogQuery(queryText);
    void loadCatalog(queryText, 1);
  };

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (activeTab === "catalog" && catalogItems.length === 0) {
      void loadCatalog("", 1);
    }
  }, [activeTab, catalogItems.length, loadCatalog]);

  if (!user || user.role !== "AUCTIONEER") {
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6">
        <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-8 shadow-card">
          <h1 className="font-serif text-2xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
            Acesso exclusivo ao leiloeiro
          </h1>
          <p className="mt-2 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
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

    const startDate = new Date(startTimeInput);
    const endDate = new Date(endTimeInput);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setFeedback({
        type: "error",
        message: "Informe datas válidas de início e término.",
      });
      return;
    }

    if (endDate.getTime() <= startDate.getTime()) {
      setFeedback({
        type: "error",
        message: "A data de encerramento deve ser posterior à data de início.",
      });
      return;
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
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
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
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
            Painel do Leiloeiro
          </h1>
          <p className="mt-1.5 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
            Acompanhe os lotes publicados, o faturamento recebido e cadastre novas obras.
          </p>
        </div>

        <div className="flex items-center gap-2" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "management"}
            onClick={() => setActiveTab("management")}
            className={`rounded-full border px-4 py-1.5 text-xs font-medium uppercase tracking-wider transition-all duration-150 ${
              activeTab === "management"
                ? "border-primary bg-primary text-white shadow-sm dark:border-gold dark:bg-gold dark:text-charcoal-bg"
                : "border-paper-border bg-paper-surface text-paper-subtext hover:border-paper-text hover:text-paper-text dark:border-charcoal-border dark:bg-charcoal-surface dark:text-charcoal-subtext dark:hover:text-charcoal-text"
            }`}
          >
            Lotes e Faturamento
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "catalog"}
            onClick={() => setActiveTab("catalog")}
            className={`rounded-full border px-4 py-1.5 text-xs font-medium uppercase tracking-wider transition-all duration-150 ${
              activeTab === "catalog"
                ? "border-primary bg-primary text-white shadow-sm dark:border-gold dark:bg-gold dark:text-charcoal-bg"
                : "border-paper-border bg-paper-surface text-paper-subtext hover:border-paper-text hover:text-paper-text dark:border-charcoal-border dark:bg-charcoal-surface dark:text-charcoal-subtext dark:hover:text-charcoal-text"
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
        <AuctionLotsTable
          dashboard={dashboard}
          isLoading={isLoadingDashboard}
          onCancelLot={handleCancelLot}
        />
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <ArtworkCatalogPicker
            items={catalogItems}
            selectedItem={selectedArtwork}
            onSelectItem={setSelectedArtwork}
            searchQuery={catalogQuery}
            onSearchQueryChange={setCatalogQuery}
            onSearch={(q) => loadCatalog(q, 1)}
            isLoading={isLoadingCatalog}
            page={catalogPage}
            onPageChange={handlePageChange}
            activeCategory={activeCategory}
            onSelectCategory={handleSelectCategory}
          />

          <LotPublishForm
            selectedArtwork={selectedArtwork}
            startingBidInput={startingBidInput}
            onStartingBidInputChange={setStartingBidInput}
            minIncrementInput={minIncrementInput}
            onMinIncrementInputChange={setMinIncrementInput}
            startTimeInput={startTimeInput}
            onStartTimeInputChange={setStartTimeInput}
            endTimeInput={endTimeInput}
            onEndTimeInputChange={setEndTimeInput}
            onSubmit={handlePublishLot}
            isSubmitting={isSubmittingLot}
          />
        </div>
      )}
    </main>
  );
};
