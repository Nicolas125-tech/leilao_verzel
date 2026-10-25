import React from "react";
import { ArtworkFrame } from "../ArtworkFrame.tsx";
import type { CatalogItem } from "../../types/api.ts";

interface LotPublishFormProps {
  selectedArtwork: CatalogItem | null;
  startingBidInput: string;
  onStartingBidInputChange: (v: string) => void;
  minIncrementInput: string;
  onMinIncrementInputChange: (v: string) => void;
  windowPreset: "live_30m" | "live_2m" | "scheduled_1h";
  onWindowPresetChange: (v: "live_30m" | "live_2m" | "scheduled_1h") => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  isSubmitting: boolean;
}

export const LotPublishForm: React.FC<LotPublishFormProps> = ({
  selectedArtwork,
  startingBidInput,
  onStartingBidInputChange,
  minIncrementInput,
  onMinIncrementInputChange,
  windowPreset,
  onWindowPresetChange,
  onSubmit,
  isSubmitting,
}) => {
  return (
    <section className="lg:col-span-5">
      <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6">
        <h2 className="font-sans text-lg font-semibold text-paper-text dark:text-charcoal-text">
          Publicar novo lote
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
                  onChange={(e) => onStartingBidInputChange(e.target.value)}
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
                  onChange={(e) => onMinIncrementInputChange(e.target.value)}
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
                  onWindowPresetChange(
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
              disabled={isSubmitting}
              className="w-full rounded-sm border border-primary bg-primary px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {isSubmitting ? "Publicando..." : "Publicar lote"}
            </button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-paper-subtext dark:text-charcoal-subtext">
            Selecione uma obra ao lado para configurar o lote.
          </p>
        )}
      </div>
    </section>
  );
};
