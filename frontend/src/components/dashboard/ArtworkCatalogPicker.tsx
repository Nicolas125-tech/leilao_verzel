import React from "react";
import { ArtworkFrame } from "../ArtworkFrame.tsx";
import type { CatalogItem } from "../../types/api.ts";

export interface CatalogCategory {
  id: string;
  label: string;
  query: string;
}

export const CATALOG_CATEGORIES: CatalogCategory[] = [
  { id: "all", label: "Todas as Obras", query: "" },
  { id: "monet", label: "Claude Monet", query: "Monet" },
  { id: "vangogh", label: "Van Gogh", query: "Van Gogh" },
  { id: "rembrandt", label: "Rembrandt", query: "Rembrandt" },
  { id: "picasso", label: "Picasso", query: "Picasso" },
  { id: "renascenca", label: "Renascimento", query: "Renaissance" },
  { id: "paisagens", label: "Paisagens", query: "Landscape" },
  { id: "retratos", label: "Retratos", query: "Portrait" },
  { id: "gravuras", label: "Gravuras", query: "Print" },
];

interface ArtworkCatalogPickerProps {
  items: CatalogItem[];
  selectedItem: CatalogItem | null;
  onSelectItem: (item: CatalogItem) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onSearch: (q?: string) => Promise<void>;
  isLoading: boolean;
  page: number;
  onPageChange: (newPage: number) => void;
  activeCategory: string;
  onSelectCategory: (categoryKey: string, query: string) => void;
}

export const ArtworkCatalogPicker: React.FC<ArtworkCatalogPickerProps> = ({
  items,
  selectedItem,
  onSelectItem,
  searchQuery,
  onSearchQueryChange,
  onSearch,
  isLoading,
  page,
  onPageChange,
  activeCategory,
  onSelectCategory,
}) => {
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void onSearch(searchQuery);
  };

  return (
    <section className="lg:col-span-7">
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-paper-subtext dark:text-charcoal-subtext">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Pesquisar no acervo (ex: Monet, Picasso, Van Gogh, Rembrandt)..."
            className="h-[42px] w-full rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface pl-9 pr-3 text-xs text-paper-text dark:text-charcoal-text placeholder:text-paper-subtext focus:border-gold focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="h-[42px] rounded-sm border border-primary bg-primary px-4 text-xs font-semibold uppercase tracking-wider text-white hover:bg-primary-hover disabled:opacity-50 dark:border-gold dark:bg-gold dark:text-charcoal-bg dark:hover:bg-gold-hover transition-colors"
        >
          {isLoading ? "Buscando..." : "Buscar acervo"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filtros de obras por artista ou período">
        {CATALOG_CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelectCategory(cat.id, cat.query)}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-wider transition-all ${
                isActive
                  ? "border-primary bg-primary text-white shadow-sm dark:border-gold dark:bg-gold dark:text-charcoal-bg"
                  : "border-paper-border bg-paper-surface text-paper-subtext hover:border-paper-text hover:text-paper-text dark:border-charcoal-border dark:bg-charcoal-surface dark:text-charcoal-subtext dark:hover:text-charcoal-text"
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {isLoading && items.length === 0 ? (
        <div className="mt-6 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-12 text-center text-sm font-serif italic text-paper-subtext dark:text-charcoal-subtext shadow-card">
          Consultando acervo de obras...
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-12 text-center shadow-card">
          <p className="font-serif italic text-base text-paper-subtext dark:text-charcoal-subtext">
            Nenhuma obra encontrada para o filtro selecionado.
          </p>
          <button
            type="button"
            onClick={() => onSelectCategory("all", "")}
            className="mt-3 text-xs font-semibold uppercase tracking-wider text-primary dark:text-gold underline"
          >
            Ver todas as obras disponíveis
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {items.map((item) => {
            const isSelected = selectedItem?.external_id === item.external_id;
            return (
              <button
                key={item.external_id}
                type="button"
                onClick={() => onSelectItem(item)}
                className={`rounded-sm border p-4 text-left transition-all ${
                  isSelected
                    ? "border-primary bg-paper-surface shadow-frame dark:border-gold dark:bg-charcoal-surface"
                    : "border-paper-border dark:border-charcoal-border bg-paper-surface/80 dark:bg-charcoal-surface/80 hover:border-paper-text shadow-card"
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
                  <span className="text-[10px] font-medium text-gold uppercase tracking-wider">
                    {item.source === "local_fallback"
                      ? "Acervo local"
                      : "Cleveland Museum"}
                  </span>
                </div>
                <h3 className="mt-1 font-serif text-base font-bold text-paper-text dark:text-charcoal-text leading-snug">
                  {item.title}
                </h3>
                <p className="font-serif italic text-xs text-paper-subtext dark:text-charcoal-subtext">
                  {item.artist} ({item.date_display})
                </p>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-paper-border dark:border-charcoal-border pt-4">
        <button
          type="button"
          disabled={page <= 1 || isLoading}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex items-center gap-1.5 rounded-full border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-4 py-2 text-xs font-semibold uppercase tracking-wider text-paper-text dark:text-charcoal-text transition-all hover:border-primary hover:text-primary dark:hover:border-gold dark:hover:text-gold disabled:opacity-40 disabled:cursor-not-allowed shadow-card"
        >
          <span aria-hidden="true">←</span>
          <span>Página Anterior</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
            Página <span className="font-bold text-primary dark:text-gold">{page}</span>
          </span>
          {isLoading && (
            <span className="text-xs font-serif italic text-gold animate-pulse">
              Carregando...
            </span>
          )}
        </div>

        <button
          type="button"
          disabled={items.length === 0 || items.length < 8 || isLoading}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex items-center gap-1.5 rounded-full border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-4 py-2 text-xs font-semibold uppercase tracking-wider text-paper-text dark:text-charcoal-text transition-all hover:border-primary hover:text-primary dark:hover:border-gold dark:hover:text-gold disabled:opacity-40 disabled:cursor-not-allowed shadow-card"
        >
          <span>Próxima Página</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
};
