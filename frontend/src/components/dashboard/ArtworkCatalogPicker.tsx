import React from "react";
import { ArtworkFrame } from "../ArtworkFrame.tsx";
import type { CatalogItem } from "../../types/api.ts";

interface ArtworkCatalogPickerProps {
  items: CatalogItem[];
  selectedItem: CatalogItem | null;
  onSelectItem: (item: CatalogItem) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onSearch: (q?: string) => Promise<void>;
  isLoading: boolean;
}

export const ArtworkCatalogPicker: React.FC<ArtworkCatalogPickerProps> = ({
  items,
  selectedItem,
  onSelectItem,
  searchQuery,
  onSearchQueryChange,
  onSearch,
  isLoading,
}) => {
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void onSearch(searchQuery);
  };

  return (
    <section className="lg:col-span-7">
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Pesquisar no Cleveland Museum of Art (ex: Monet, Picasso, Van Gogh, Rembrandt)..."
          className="h-[42px] flex-1 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-3.5 text-sm"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="h-[42px] rounded-sm border border-paper-text dark:border-charcoal-text bg-paper-text dark:bg-charcoal-text px-4 text-xs font-semibold text-paper-surface dark:text-charcoal-bg"
        >
          {isLoading ? "Buscando..." : "Buscar acervo"}
        </button>
      </form>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.map((item) => {
          const isSelected = selectedItem?.external_id === item.external_id;
          return (
            <button
              key={item.external_id}
              type="button"
              onClick={() => onSelectItem(item)}
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
  );
};
