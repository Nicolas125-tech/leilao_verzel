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

        {isLoading ? (
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
                              void onCancelLot(lot.id, lot.lot_number)
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
  );
};
