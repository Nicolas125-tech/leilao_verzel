import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArtworkFrame } from "../components/ArtworkFrame.tsx";
import { CountdownBadge } from "../components/CountdownBadge.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { useWallet } from "../context/WalletContext.tsx";
import { useLotWebSocket } from "../hooks/useLotWebSocket.ts";
import { lotsApi } from "../services/api.ts";
import {
  calculateCountdown,
  formatBrlCents,
  parseBrlToCents,
} from "../utils/formatters.ts";

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

export const LiveAuctionPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { wallet, refreshWallet } = useWallet();
  const { lotData, bidsHistory, connectionStatus, error, reloadLot } =
    useLotWebSocket(id);

  const [customBidInput, setCustomBidInput] = useState<string>("");
  const [isSubmittingBid, setIsSubmittingBid] = useState<boolean>(false);
  const [bidFeedback, setBidFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const minRequiredCents = lotData
    ? lotData.current_bid_cents !== null
      ? lotData.current_bid_cents + lotData.min_increment_cents
      : lotData.starting_bid_cents
    : 0;

  useEffect(() => {
    if (minRequiredCents > 0) {
      setCustomBidInput((minRequiredCents / 100).toFixed(2).replace(".", ","));
    }
  }, [minRequiredCents]);

  if (error && !lotData) {
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6">
        <div
          role="alert"
          className="rounded-sm border border-status-outbid bg-status-outbid/10 p-6 text-status-outbid"
        >
          <h1 className="font-sans text-xl font-semibold">
            Lote indisponível
          </h1>
          <p className="mt-2 text-sm">{error}</p>
          <Link
            to="/"
            className="mt-4 inline-block text-xs font-medium underline"
          >
            Voltar para a vitrine
          </Link>
        </div>
      </main>
    );
  }

  if (!lotData) {
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6">
        <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-8 text-sm text-paper-subtext dark:text-charcoal-subtext">
          Carregando lote...
        </div>
      </main>
    );
  }

  const isLeader = Boolean(user && lotData.leader_user_id === user.id);
  const hasParticipated = Boolean(
    user && bidsHistory.some((b) => b.user_id === user.id),
  );
  const isOutbid = hasParticipated && !isLeader;

  const countdownState = calculateCountdown(lotData.end_time);

  const submitBidCents = async (amountCents: number) => {
    if (!id) return;
    setBidFeedback(null);

    if (amountCents <= 0) {
      setBidFeedback({
        type: "error",
        message: "Informe um valor de lance válido acima de R$ 0,00.",
      });
      return;
    }

    setIsSubmittingBid(true);
    try {
      const created = await lotsApi.placeBid(id, amountCents);
      await Promise.all([reloadLot(), refreshWallet()]);
      setBidFeedback({
        type: "success",
        message: created.extension_triggered
          ? `Lance #${created.sequence_number} (${formatBrlCents(created.amount_cents)}) confirmado. Tempo prorrogado em +2 minutos.`
          : `Lance #${created.sequence_number} (${formatBrlCents(created.amount_cents)}) confirmado.`,
      });
    } catch (err) {
      setBidFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Não foi possível registrar o lance.",
      });
    } finally {
      setIsSubmittingBid(false);
    }
  };

  const handleCustomBidSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseBrlToCents(customBidInput);
    await submitBidCents(cents);
  };

  const quickAmounts = [
    { label: "Mínimo", cents: minRequiredCents },
    {
      label: "+ 1 incremento",
      cents: minRequiredCents + lotData.min_increment_cents,
    },
    {
      label: "+ 2 incrementos",
      cents: minRequiredCents + lotData.min_increment_cents * 2,
    },
  ];

  const attributesEntries = Object.entries(lotData.attributes_json || {});

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-paper-border dark:border-charcoal-border pb-4">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-xs font-medium underline text-paper-subtext hover:text-paper-text dark:text-charcoal-subtext dark:hover:text-charcoal-text"
          >
            Voltar para a vitrine
          </Link>
          <span className="text-xs text-paper-subtext dark:text-charcoal-subtext">
            /
          </span>
          <span className="font-mono text-xs font-semibold tabular-nums">
            Lote #{lotData.lot_number}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-sm border px-2.5 py-1 text-[11px] font-medium ${
              connectionStatus === "CONNECTED"
                ? "border-status-winning/50 bg-status-winning/10 text-status-winning"
                : "border-status-warning/50 bg-status-warning/10 text-status-warning"
            }`}
          >
            {connectionStatus === "CONNECTED" ? "Tempo real ativo" : "Reconectando..."}
          </span>
          <Link
            to={`/lots/${lotData.id}/audit`}
            className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-3 py-1 text-xs font-medium hover:border-paper-text dark:hover:border-charcoal-text"
          >
            Auditoria
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <section className="lg:col-span-7 space-y-6">
          <ArtworkFrame
            imageUrl={lotData.image_url}
            title={lotData.title}
            artist={lotData.artist}
            aspectClassName="h-[420px] sm:h-[480px]"
          />

          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6">
            <h1 className="font-sans text-2xl font-semibold tracking-tight text-paper-text dark:text-charcoal-text sm:text-3xl">
              {lotData.title}
            </h1>
            <p className="mt-2 text-base font-medium text-paper-text dark:text-charcoal-text">
              {lotData.artist} ({lotData.date_display})
            </p>
            <p className="mt-1 text-sm text-paper-subtext dark:text-charcoal-subtext">
              Técnica: {lotData.medium_display}
            </p>

            {attributesEntries.length > 0 && (
              <div className="mt-6 border-t border-paper-border dark:border-charcoal-border pt-4">
                <h2 className="font-sans text-base font-semibold text-paper-text dark:text-charcoal-text">
                  Detalhes da obra
                </h2>
                <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {attributesEntries.map(([key, val]) => (
                    <div
                      key={key}
                      className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg p-3"
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
                  Hash atual do lote ({lotData.bid_count} lances):
                </span>
                <Link
                  to={`/lots/${lotData.id}/audit`}
                  className="text-xs font-medium underline text-primary"
                >
                  Auditar cadeia de lances
                </Link>
              </div>
              <p className="mt-1.5 break-all rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 py-2 font-mono text-xs text-paper-text dark:text-charcoal-text">
                {lotData.head_hash}
              </p>
            </div>
          </div>
        </section>

        <section className="lg:col-span-5 space-y-6">
          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6">
            <div className="flex items-start justify-between gap-4 border-b border-paper-border dark:border-charcoal-border pb-4">
              <div>
                <span className="block text-xs text-paper-subtext dark:text-charcoal-subtext">
                  Status
                </span>
                <span className="mt-1 inline-block text-sm font-bold text-primary">
                  {formatLotStatusLabel(lotData.status)}
                </span>
              </div>

              <div className="text-right">
                <span className="block text-xs text-paper-subtext dark:text-charcoal-subtext">
                  Tempo restante
                </span>
                <div className="mt-1">
                  <CountdownBadge
                    endTimeIso={lotData.end_time}
                    startTimeIso={lotData.start_time}
                    status={lotData.status}
                    extensionCount={lotData.extension_count}
                    onExpire={() => void reloadLot()}
                  />
                </div>
              </div>
            </div>

            {lotData.status === "LIVE" && countdownState.isCritical && (
              <div className="mt-4 rounded-sm border border-status-warning bg-status-warning/10 px-3.5 py-2.5 text-xs text-status-warning">
                Últimos 2 minutos: novos lances prorrogam o encerramento em +2 minutos.
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <span className="block text-xs text-paper-subtext dark:text-charcoal-subtext">
                  {lotData.current_bid_cents !== null
                    ? "Lance atual"
                    : "Lance inicial"}
                </span>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-paper-text dark:text-charcoal-text">
                  {formatBrlCents(
                    lotData.current_bid_cents ?? lotData.starting_bid_cents,
                  )}
                </p>
              </div>

              <div className="text-right">
                <span className="block text-xs text-paper-subtext dark:text-charcoal-subtext">
                  Incremento mínimo
                </span>
                <p className="mt-1 font-mono text-base font-semibold tabular-nums text-paper-text dark:text-charcoal-text">
                  + {formatBrlCents(lotData.min_increment_cents)}
                </p>
                {lotData.leader_masked_name && (
                  <p className="mt-1 font-mono text-xs text-paper-subtext dark:text-charcoal-subtext">
                    Líder: {lotData.leader_masked_name}
                  </p>
                )}
              </div>
            </div>

            {user?.role === "BIDDER" && (
              <div className="mt-5">
                {isLeader ? (
                  <div className="rounded-sm border border-status-winning bg-status-winning/10 px-4 py-3 text-xs font-medium text-status-winning">
                    {lotData.status === "ENDED"
                      ? "Você arrematou este lote."
                      : `Você está ganhando (${formatBrlCents(lotData.current_bid_cents)} reservados no saldo comprometido).`}
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

            {lotData.status === "ENDED" && lotData.certificate && (
              <div className="mt-5 rounded-sm border border-gold bg-gold/10 p-4">
                <span className="block text-xs font-semibold text-gold">
                  Lote arrematado
                </span>
                <p className="mt-1 font-mono text-xs tabular-nums text-paper-text dark:text-charcoal-text">
                  Vencedor: {lotData.certificate.winner_masked_name}
                </p>
                <Link
                  to={`/receipts/${lotData.certificate.receipt_code}`}
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

            {lotData.status === "LIVE" && (
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
                          onClick={() => void submitBidCents(q.cents)}
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

                    <form
                      onSubmit={(e) => void handleCustomBidSubmit(e)}
                      className="flex gap-2 pt-1"
                    >
                      <input
                        type="text"
                        value={customBidInput}
                        onChange={(e) => setCustomBidInput(e.target.value)}
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

          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface">
            <div className="flex items-center justify-between border-b border-paper-border dark:border-charcoal-border px-5 py-3.5">
              <h2 className="font-sans text-base font-semibold text-paper-text dark:text-charcoal-text">
                Histórico de lances
              </h2>
              <span className="font-mono text-xs tabular-nums text-paper-subtext dark:text-charcoal-subtext">
                {bidsHistory.length} {bidsHistory.length === 1 ? "lance" : "lances"}
              </span>
            </div>

            {bidsHistory.length === 0 ? (
              <div className="p-6 text-center text-xs text-paper-subtext dark:text-charcoal-subtext">
                Nenhum lance enviado até o momento.
              </div>
            ) : (
              <ul className="divide-y divide-paper-border dark:divide-charcoal-border max-h-[380px] overflow-y-auto">
                {bidsHistory.map((bid) => (
                  <li key={bid.id} className="px-5 py-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
                          #{bid.sequence_number}
                        </span>
                        <span className="font-mono text-xs font-semibold text-paper-text dark:text-charcoal-text">
                          {bid.bidder_masked_name}
                        </span>
                        {bid.extension_triggered && (
                          <span className="border border-gold/60 bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] text-gold">
                            +2 min
                          </span>
                        )}
                      </div>

                      <span className="font-mono text-sm font-bold tabular-nums text-paper-text dark:text-charcoal-text">
                        {formatBrlCents(bid.amount_cents)}
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-paper-subtext dark:text-charcoal-subtext">
                      <span className="tabular-nums">
                        {new Date(bid.created_at).toLocaleTimeString("pt-BR")}
                      </span>
                      <span title={bid.current_hash}>
                        Hash: {bid.current_hash.slice(0, 16)}...
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
};
