import React from "react";
import { Link } from "react-router-dom";
import { CountdownBadge } from "../CountdownBadge.tsx";
import type { Lot, User, Wallet } from "../../types/api.ts";
import { calculateCountdown, formatBrlCents } from "../../utils/formatters.ts";

function formatLotStatusLabel(status: string): string {
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

interface BidControlPanelProps {
  lot: Lot;
  minRequiredCents: number;
  customBidInput: string;
  onCustomBidInputChange: (value: string) => void;
  onSubmitBid: (cents: number) => Promise<void>;
  onReloadLot: () => void;
  isSubmittingBid: boolean;
  bidFeedback: {
    type: "success" | "error";
    message: string;
  } | null;
  user: User | null;
  wallet: Wallet | null;
  isLeader: boolean;
  isOutbid: boolean;
}

export const BidControlPanel: React.FC<BidControlPanelProps> = ({
  lot,
  minRequiredCents,
  customBidInput,
  onCustomBidInputChange,
  onSubmitBid,
  onReloadLot,
  isSubmittingBid,
  bidFeedback,
  user,
  wallet,
  isLeader,
  isOutbid,
}) => {
  const countdownState = calculateCountdown(lot.end_time);

  const quickAmounts = [
    { label: "Mínimo", cents: minRequiredCents },
    {
      label: "+ 1 incremento",
      cents: minRequiredCents + lot.min_increment_cents,
    },
    {
      label: "+ 2 incrementos",
      cents: minRequiredCents + lot.min_increment_cents * 2,
    },
  ];

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sanitized = customBidInput.trim().replace(/\./g, "").replace(",", ".");
    const val = parseFloat(sanitized);
    const cents = isNaN(val) ? 0 : Math.round(val * 100);
    await onSubmitBid(cents);
  };

  return (
    <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6">
      <div className="flex items-start justify-between gap-4 border-b border-paper-border dark:border-charcoal-border pb-4">
        <div>
          <span className="block text-xs text-paper-subtext dark:text-charcoal-subtext">
            Status
          </span>
          <span className="mt-1 inline-block text-sm font-bold text-primary">
            {formatLotStatusLabel(lot.status)}
          </span>
        </div>

        <div className="text-right">
          <span className="block text-xs text-paper-subtext dark:text-charcoal-subtext">
            Tempo restante
          </span>
          <div className="mt-1">
            <CountdownBadge
              endTimeIso={lot.end_time}
              startTimeIso={lot.start_time}
              status={lot.status}
              extensionCount={lot.extension_count}
              onExpire={onReloadLot}
            />
          </div>
        </div>
      </div>

      {lot.status === "LIVE" && countdownState.isCritical && (
        <div className="mt-4 rounded-sm border border-status-warning bg-status-warning/10 px-3.5 py-2.5 text-xs text-status-warning">
          Últimos 2 minutos: novos lances prorrogam o encerramento em +2 minutos.
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <span className="block text-xs text-paper-subtext dark:text-charcoal-subtext">
            {lot.current_bid_cents !== null ? "Lance atual" : "Lance inicial"}
          </span>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-paper-text dark:text-charcoal-text">
            {formatBrlCents(lot.current_bid_cents ?? lot.starting_bid_cents)}
          </p>
        </div>

        <div className="text-right">
          <span className="block text-xs text-paper-subtext dark:text-charcoal-subtext">
            Incremento mínimo
          </span>
          <p className="mt-1 font-mono text-base font-semibold tabular-nums text-paper-text dark:text-charcoal-text">
            + {formatBrlCents(lot.min_increment_cents)}
          </p>
          {lot.leader_masked_name && (
            <p className="mt-1 font-mono text-xs text-paper-subtext dark:text-charcoal-subtext">
              Líder: {lot.leader_masked_name}
            </p>
          )}
        </div>
      </div>

      {user?.role === "BIDDER" && (
        <div className="mt-5">
          {isLeader ? (
            <div className="rounded-sm border border-status-winning bg-status-winning/10 px-4 py-3 text-xs font-medium text-status-winning">
              {lot.status === "ENDED"
                ? "Você arrematou este lote."
                : `Seu lance é o líder no momento (${formatBrlCents(lot.current_bid_cents)} retidos no saldo comprometido).`}
            </div>
          ) : isOutbid ? (
            <div className="rounded-sm border border-status-outbid bg-status-outbid/10 px-4 py-3 text-xs font-medium text-status-outbid">
              Seu lance foi superado. O valor reservado já voltou para o seu saldo disponível.
            </div>
          ) : (
            <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-4 py-3 text-xs text-paper-subtext dark:text-charcoal-subtext">
              Você ainda não deu lances neste lote. Próximo lance mínimo:{" "}
              <strong className="font-mono tabular-nums text-paper-text dark:text-charcoal-text">
                {formatBrlCents(minRequiredCents)}
              </strong>
            </div>
          )}
        </div>
      )}

      {lot.status === "ENDED" && lot.certificate && (
        <div className="mt-5 rounded-sm border border-gold bg-gold/10 p-4">
          <span className="block text-xs font-semibold text-gold">
            Lote arrematado
          </span>
          <p className="mt-1 font-mono text-xs tabular-nums text-paper-text dark:text-charcoal-text">
            Vencedor: {lot.certificate.winner_masked_name}
          </p>
          <Link
            to={`/receipts/${lot.certificate.receipt_code}`}
            className="mt-3 inline-block rounded-sm border border-primary bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover"
          >
            Ver comprovante de arremate
          </Link>
        </div>
      )}

      {bidFeedback && (
        <div
          role="alert"
          className={`mt-4 rounded-sm border px-4 py-3 text-xs font-medium ${
            bidFeedback.type === "success"
              ? "border-status-winning bg-status-winning/10 text-status-winning"
              : "border-status-outbid bg-status-outbid/10 text-status-outbid"
          }`}
        >
          {bidFeedback.message}
        </div>
      )}

      {lot.status === "LIVE" && (
        <div className="mt-5 border-t border-paper-border dark:border-charcoal-border pt-5">
          {!user ? (
            <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg p-4 text-center">
              <p className="text-xs text-paper-subtext dark:text-charcoal-subtext">
                Entre como licitante (ou use a troca rápida no topo) para enviar lances.
              </p>
              <Link
                to="/login"
                className="mt-3 inline-block rounded-sm border border-primary bg-primary px-4 py-2 text-xs font-semibold text-white"
              >
                Entrar
              </Link>
            </div>
          ) : user.role === "AUCTIONEER" ? (
            <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg p-4 text-xs text-paper-subtext dark:text-charcoal-subtext">
              Você está conectado como leiloeiro ({user.masked_name}). Para dar lances, alterne para Licitante 1 ou Licitante 2 na barra superior.
            </div>
          ) : (
            <div className="space-y-3">
              {wallet && (
                <div className="flex items-center justify-between text-xs text-paper-subtext dark:text-charcoal-subtext">
                  <span>Seu saldo disponível:</span>
                  <span className="font-mono font-semibold tabular-nums text-status-winning">
                    {formatBrlCents(wallet.available_balance_cents)}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                {quickAmounts.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    disabled={isSubmittingBid}
                    onClick={() => void onSubmitBid(q.cents)}
                    className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-2 py-2 text-center transition-colors hover:border-primary disabled:opacity-50"
                  >
                    <span className="block text-[10px] text-paper-subtext dark:text-charcoal-subtext">
                      {q.label}
                    </span>
                    <span className="mt-0.5 block font-mono text-xs font-bold tabular-nums text-paper-text dark:text-charcoal-text">
                      {formatBrlCents(q.cents)}
                    </span>
                  </button>
                ))}
              </div>

              <form onSubmit={(e) => void handleFormSubmit(e)} className="flex gap-2 pt-1">
                <input
                  type="text"
                  value={customBidInput}
                  onChange={(e) => onCustomBidInputChange(e.target.value)}
                  aria-label="Valor do lance em reais"
                  placeholder="3000,00"
                  className="h-[42px] flex-1 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3.5 font-mono text-sm tabular-nums"
                />
                <button
                  type="submit"
                  disabled={isSubmittingBid}
                  className="h-[42px] rounded-sm border border-primary bg-primary px-5 text-xs font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
                >
                  {isSubmittingBid ? "Enviando..." : "Dar lance"}
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
