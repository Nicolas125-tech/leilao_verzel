import React from "react";
import { Link } from "react-router-dom";
import type { AuctioneerDashboard, LotStatus } from "../../types/api.ts";
import { formatBrlCents } from "../../utils/formatters.ts";

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

interface AuctionLotsTableProps {
  dashboard: AuctioneerDashboard | null;
  isLoading: boolean;
  onCancelLot: (lotId: string, lotNumber: number) => Promise<void>;
}

export const AuctionLotsTable: React.FC<AuctionLotsTableProps> = ({
  dashboard,
  isLoading,
  onCancelLot,
}) => {
  return (
    <div className="mt-6">
      {dashboard && (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5 shadow-card">
            <span className="text-[11px] font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
              Faturamento total recebido
            </span>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-status-winning">
              {formatBrlCents(dashboard.total_revenue_cents)}
            </p>
          </div>

          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5 shadow-card">
            <span className="text-[11px] font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
              Lotes liquidados com vencedor
            </span>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-paper-text dark:text-charcoal-text">
              {dashboard.settled_with_winner_count}
            </p>
          </div>

          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5 shadow-card">
            <span className="text-[11px] font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
              Lotes ativos (ao vivo ou agendados)
            </span>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-paper-text dark:text-charcoal-text">
              {dashboard.active_lots_count}
            </p>
          </div>
        </section>
      )}

      <section className="mt-6 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface shadow-card">
        <div className="border-b border-paper-border dark:border-charcoal-border px-6 py-4">
          <h2 className="font-serif text-xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
            Lotes publicados
          </h2>
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-paper-subtext dark:text-charcoal-subtext">
            Carregando lotes...
          </div>
        ) : !dashboard || dashboard.lots.length === 0 ? (
          <div className="p-6 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
            Nenhum lote publicado ainda. Use a aba Catalogar Nova Obra.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-paper-border dark:border-charcoal-border bg-paper-muted/50 dark:bg-charcoal-muted/50 text-[11px] uppercase tracking-wider font-medium text-paper-subtext dark:text-charcoal-subtext">
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
                    className="border-b border-paper-border dark:border-charcoal-border last:border-b-0 hover:bg-paper-muted/30 dark:hover:bg-charcoal-muted/30 transition-colors"
                  >
                    <td className="px-5 py-3.5 font-mono text-xs font-semibold tabular-nums">
                      #{lot.lot_number}
                    </td>
                    <td className="px-5 py-3.5">
                      <Link
                        to={`/lots/${lot.id}`}
                        className="font-serif text-sm font-bold text-paper-text dark:text-charcoal-text hover:text-primary dark:hover:text-gold transition-colors"
                      >
                        {lot.title}
                      </Link>
                      <span className="block font-serif italic text-xs text-paper-subtext dark:text-charcoal-subtext">
                        {lot.artist}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs font-medium">
                      {formatStatusPt(lot.status)}
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono text-xs tabular-nums">
                      {lot.bid_count}
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono text-xs font-semibold tabular-nums text-primary dark:text-gold">
                      {formatBrlCents(
                        lot.current_bid_cents !== null
                          ? lot.current_bid_cents
                          : lot.starting_bid_cents,
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-paper-subtext dark:text-charcoal-subtext">
                      {lot.leader_masked_name || "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {lot.certificate && (
                          <Link
                            to={`/receipts/${lot.certificate.receipt_code}`}
                            className="rounded-sm border border-gold/70 dark:border-gold bg-gold/10 px-2.5 py-1 text-xs font-medium text-gold hover:bg-gold/20 transition-colors"
                          >
                            Comprovante
                          </Link>
                        )}
                        <Link
                          to={`/lots/${lot.id}`}
                          className="rounded-sm border border-paper-border dark:border-charcoal-border px-2.5 py-1 text-xs font-medium text-paper-text dark:text-charcoal-text hover:border-paper-text"
                        >
                          Ver
                        </Link>
                        {lot.status !== "CANCELLED" && lot.status !== "ENDED" && (
                          <button
                            type="button"
                            onClick={() => void onCancelLot(lot.id, lot.lot_number)}
                            className="rounded-sm border border-status-outbid/40 bg-status-outbid/10 px-2.5 py-1 text-xs font-medium text-status-outbid hover:bg-status-outbid hover:text-white transition-colors"
                          >
                            Cancelar
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
  );
};
