import React from "react";
import { ArtworkFrame } from "../ArtworkFrame.tsx";
import type { CatalogItem } from "../../types/api.ts";

interface LotPublishFormProps {
  selectedArtwork: CatalogItem | null;
  startingBidInput: string;
  onStartingBidInputChange: (v: string) => void;
  minIncrementInput: string;
  onMinIncrementInputChange: (v: string) => void;
  startTimeInput: string;
  onStartTimeInputChange: (v: string) => void;
  endTimeInput: string;
  onEndTimeInputChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  isSubmitting: boolean;
}

export const LotPublishForm: React.FC<LotPublishFormProps> = ({
  selectedArtwork,
  startingBidInput,
  onStartingBidInputChange,
  minIncrementInput,
  onMinIncrementInputChange,
  startTimeInput,
  onStartTimeInputChange,
  endTimeInput,
  onEndTimeInputChange,
  onSubmit,
  isSubmitting,
}) => {
  return (
    <section className="lg:col-span-5">
      <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6 shadow-card">
        <h2 className="font-serif text-xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
          {selectedArtwork ? `Lote: ${selectedArtwork.title}` : "Publicar novo lote"}
        </h2>

        {selectedArtwork ? (
          <form onSubmit={(e) => void onSubmit(e)} className="mt-4 space-y-4">
            <ArtworkFrame
              imageUrl={selectedArtwork.image_url}
              title={selectedArtwork.title}
              artist={selectedArtwork.artist}
              aspectClassName="h-52"
            />

            <div className="border-b border-paper-border dark:border-charcoal-border pb-3">
              <h3 className="font-serif text-base font-bold text-paper-text dark:text-charcoal-text">
                {selectedArtwork.title}
              </h3>
              <p className="font-serif italic text-xs text-paper-subtext dark:text-charcoal-subtext">
                {selectedArtwork.artist} ({selectedArtwork.date_display}) · {selectedArtwork.medium_display}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                  Lance inicial (R$)
                </label>
                <input
                  type="text"
                  required
                  value={startingBidInput}
                  onChange={(e) => onStartingBidInputChange(e.target.value)}
                  placeholder="1000,00"
                  className="mt-1 h-[40px] w-full rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 font-mono text-sm tabular-nums focus:border-gold focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                  Incremento mín. (R$)
                </label>
                <input
                  type="text"
                  required
                  value={minIncrementInput}
                  onChange={(e) => onMinIncrementInputChange(e.target.value)}
                  placeholder="50,00"
                  className="mt-1 h-[40px] w-full rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 font-mono text-sm tabular-nums focus:border-gold focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                  Início do pregão
                </label>
                <input
                  type="datetime-local"
                  required
                  value={startTimeInput}
                  onChange={(e) => onStartTimeInputChange(e.target.value)}
                  className="mt-1 h-[40px] w-full rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 font-mono text-xs focus:border-gold focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                  Término do pregão
                </label>
                <input
                  type="datetime-local"
                  required
                  value={endTimeInput}
                  onChange={(e) => onEndTimeInputChange(e.target.value)}
                  className="mt-1 h-[40px] w-full rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 font-mono text-xs focus:border-gold focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 h-[42px] w-full rounded-sm border border-primary bg-primary font-sans text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-primary-hover disabled:opacity-50 dark:border-gold dark:bg-gold dark:text-charcoal-bg dark:hover:bg-gold-hover"
            >
              {isSubmitting ? "Publicando lote no leilão..." : "Publicar lote no pregão"}
            </button>
          </form>
        ) : (
          <p className="mt-4 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
            Selecione uma obra do catálogo ao lado para configurar o lance inicial e publicar o lote.
          </p>
        )}
      </div>
    </section>
  );
};
