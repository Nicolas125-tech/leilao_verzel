import React from "react";
import { Link } from "react-router-dom";
import { ArtworkFrame } from "../ArtworkFrame.tsx";
import type { Lot } from "../../types/api.ts";

interface LotArtworkDetailsProps {
  lot: Lot;
}

export const LotArtworkDetails: React.FC<LotArtworkDetailsProps> = ({ lot }) => {
  const attributesEntries = Object.entries(lot.attributes_json || {});

  return (
    <section className="lg:col-span-7 space-y-6">
      <ArtworkFrame
        imageUrl={lot.image_url}
        title={lot.title}
        artist={lot.artist}
        aspectClassName="h-[420px] sm:h-[480px]"
      />

      <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6 shadow-card">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
          {lot.title}
        </h1>
        <p className="mt-2 font-serif italic text-lg font-medium text-primary dark:text-gold">
          {lot.artist} ({lot.date_display})
        </p>
        <p className="mt-1 text-sm text-paper-subtext dark:text-charcoal-subtext">
          Técnica: {lot.medium_display}
        </p>

        {attributesEntries.length > 0 && (
          <div className="mt-6 border-t border-paper-border dark:border-charcoal-border pt-4">
            <h2 className="font-display text-xs font-semibold uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
              Detalhes do Acervo
            </h2>
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {attributesEntries.map(([key, val]) => (
                <div
                  key={key}
                  className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-muted/30 dark:bg-charcoal-muted/30 p-3"
                >
                  <dt className="text-[11px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                    {key.replace(/_/g, " ")}
                  </dt>
                  <dd className="mt-1 text-xs font-medium text-paper-text dark:text-charcoal-text">
                    {String(val ?? "Não informado")}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div className="mt-6 border-t border-paper-border dark:border-charcoal-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
              Hash atual do lote ({lot.bid_count} lances):
            </span>
            <Link
              to={`/lots/${lot.id}/audit`}
              className="text-xs font-medium underline text-primary dark:text-gold"
            >
              Auditar cadeia de lances
            </Link>
          </div>
          <p className="mt-1.5 break-all rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-muted/40 dark:bg-charcoal-muted/40 px-3 py-2 font-mono text-xs text-paper-text dark:text-charcoal-text">
            {lot.head_hash}
          </p>
        </div>
      </div>
    </section>
  );
};
