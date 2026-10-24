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
          <h1 className="font-serif text-2xl font-semibold">
            Lote Indisponivel
          </h1>
          <p className="mt-2 text-sm">{error}</p>
          <Link
            to="/"
            className="mt-4 inline-block font-mono text-xs underline"
          >
            Retornar a Vitrine
          </Link>
        </div>
      </main>
    );
  }

  if (!lotData) {
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6">
        <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-8 text-sm text-paper-subtext dark:text-charcoal-subtext">
          Carregando sala de pregao e cadeia criptografica...
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
        message: "Informe um valor de lance valido acima de R$ 0,00.",
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
          ? `Lance #${created.sequence_number} (${formatBrlCents(created.amount_cents)}) confirmado. Regra Anti-Sniping acionada (+2 min).`
          : `Lance #${created.sequence_number} (${formatBrlCents(created.amount_cents)}) registrado e encadeado via SHA-256.`,
      });
    } catch (err) {
      setBidFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Recusa ao processar lance no motor transacional.",
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
    { label: "Minimo Exigido", cents: minRequiredCents },
    {
      label: "+ 1 Incremento",
      cents: minRequiredCents + lotData.min_increment_cents,
    },
    {
      label: "+ 2 Incrementos",
      cents: minRequiredCents + lotData.min_increment_cents * 2,
    },
  ];

  const attributesEntries = Object.entries(lotData.attributes_json || {});

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
      {/* Barra de navegacao contextual */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-paper-border dark:border-charcoal-border pb-4">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="font-mono text-xs underline text-paper-subtext hover:text-paper-text dark:text-charcoal-subtext dark:hover:text-charcoal-text"
          >
            Voltar a Vitrine
          </Link>
          <span className="font-mono text-xs text-paper-subtext dark:text-charcoal-subtext">
            /
          </span>
          <span className="font-mono text-xs font-semibold tabular-nums">
            LOTE #{lotData.lot_number}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-sm border px-2.5 py-1 font-mono text-[11px] font-medium ${
              connectionStatus === "CONNECTED"
                ? "border-status-winning/50 bg-status-winning/10 text-status-winning"
                : "border-status-warning/50 bg-status-warning/10 text-status-warning"
            }`}
          >
            CANAL TEMPO REAL: {connectionStatus}
          </span>
          <Link
            to={`/lots/${lotData.id}/audit`}
            className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-3 py-1 font-mono text-xs font-medium hover:border-paper-text dark:hover:border-charcoal-text"
          >
            Auditoria Criptografica SHA-256
          </Link>
        </div>
      </div>

      {/* Layout Bipartido Assimetrico 7/5 conforme DESIGN.md */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Coluna Esquerda (7 colunas): Obra, Ficha Catalografica e Ancora SHA-256 */}
        <section className="lg:col-span-7 space-y-6">
          <ArtworkFrame
            imageUrl={lotData.image_url}
            title={lotData.title}
            artist={lotData.artist}
            aspectClassName="h-[420px] sm:h-[480px]"
          />

          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6">
            <h1 className="font-serif text-3xl font-semibold leading-tight text-paper-text dark:text-charcoal-text sm:text-4xl">
              {lotData.title}
            </h1>
            <p className="mt-2 text-base font-medium text-paper-text dark:text-charcoal-text">
              {lotData.artist} ({lotData.date_display})
            </p>
            <p className="mt-1 text-sm text-paper-subtext dark:text-charcoal-subtext">
              Tecnica: {lotData.medium_display}
            </p>

            {/* Atributos Persistidos no PostgreSQL */}
            {attributesEntries.length > 0 && (
              <div className="mt-6 border-t border-paper-border dark:border-charcoal-border pt-4">
                <h2 className="font-serif text-lg font-semibold text-paper-text dark:text-charcoal-text">
                  Ficha Catalografica Persistida
                </h2>
                <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {attributesEntries.map(([key, val]) => (
                    <div
                      key={key}
                      className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg p-3"
                    >
                      <dt className="font-mono text-[10px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                        {key.replace(/_/g, " ")}
                      </dt>
                      <dd className="mt-1 text-xs font-medium text-paper-text dark:text-charcoal-text">
                        {String(val ?? "Nao informado")}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {/* Ancora Criptografica do Lote */}
            <div className="mt-6 border-t border-paper-border dark:border-charcoal-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                  Head Hash Ancorado no Lote ({lotData.bid_count} lances):
                </span>
                <Link
                  to={`/lots/${lotData.id}/audit`}
                  className="font-mono text-xs underline text-primary"
                >
                  Verificar Integridade Completa
                </Link>
              </div>
              <p className="mt-1.5 break-all rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 py-2 font-mono text-xs text-paper-text dark:text-charcoal-text">
                {lotData.head_hash}
              </p>
            </div>
          </div>
        </section>

        {/* Coluna Direita (5 colunas): Terminal de Pregao em Tempo Real */}
        <section className="lg:col-span-5 space-y-6">
          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6">
            {/* Linha de Status e Cronometro */}
            <div className="flex items-start justify-between gap-4 border-b border-paper-border dark:border-charcoal-border pb-4">
              <div>
                <span className="block font-mono text-xs uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                  Status do Pregao
                </span>
                <span className="mt-1 inline-block font-mono text-sm font-bold uppercase text-primary">
                  {lotData.status}
                </span>
              </div>

              <div className="text-right">
                <span className="block font-mono text-xs uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                  Tempo Restante
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

            {/* Aviso Anti-Sniping quando nos 2 minutos finais */}
            {lotData.status === "LIVE" && countdownState.isCritical && (
              <div className="mt-4 rounded-sm border border-status-warning bg-status-warning/10 px-3.5 py-2.5 text-xs text-status-warning">
                Janela Anti-Sniping ativa (&le; 120s). Qualquer novo lance aceito prorroga automaticamente o encerramento para +2 minutos.
              </div>
            )}

            {/* Preco Atual e Incremento */}
            <div className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <span className="block font-mono text-xs uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                  {lotData.current_bid_cents !== null
                    ? "Maior Lance Atual"
                    : "Lance Inicial"}
                </span>
                <p className="mt-1 font-sans text-3xl font-bold tabular-nums text-paper-text dark:text-charcoal-text">
                  {formatBrlCents(
                    lotData.current_bid_cents ?? lotData.starting_bid_cents,
                  )}
                </p>
              </div>

              <div className="text-right">
                <span className="block font-mono text-xs uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                  Incremento Minimo
                </span>
                <p className="mt-1 font-mono text-base font-semibold tabular-nums text-paper-text dark:text-charcoal-text">
                  + {formatBrlCents(lotData.min_increment_cents)}
                </p>
                {lotData.leader_masked_name && (
                  <p className="mt-1 font-mono text-xs text-paper-subtext dark:text-charcoal-subtext">
                    Lider: {lotData.leader_masked_name}
                  </p>
                )}
              </div>
            </div>

            {/* Painel de Posicao do Licitante na Disputa */}
            {user?.role === "BIDDER" && (
              <div className="mt-5">
                {isLeader ? (
                  <div className="rounded-sm border border-status-winning bg-status-winning/10 px-4 py-3 text-xs font-medium text-status-winning">
                    {lotData.status === "ENDED"
                      ? "VOCE ARREMATOU ESTE LOTE. LIQUIDACAO CONCLUIDA."
                      : `VOCE ESTA LIDERANDO ESTE LOTE. (${formatBrlCents(lotData.current_bid_cents)} reservados no saldo comprometido).`}
                  </div>
                ) : isOutbid ? (
                  <div className="rounded-sm border border-status-outbid bg-status-outbid/10 px-4 py-3 text-xs font-medium text-status-outbid">
                    VOCE FOI SUPERADO. Seu saldo comprometido anterior ja retornou integralmente ao saldo disponivel.
                  </div>
                ) : (
                  <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-4 py-3 text-xs text-paper-subtext dark:text-charcoal-subtext">
                    Voce ainda nao deu lances neste lote. Proximo lance minimo:{" "}
                    <strong className="font-mono tabular-nums text-paper-text dark:text-charcoal-text">
                      {formatBrlCents(minRequiredCents)}
                    </strong>
                  </div>
                )}
              </div>
            )}

            {/* Comprovante Assinado quando encerrado com vencedor */}
            {lotData.status === "ENDED" && lotData.certificate && (
              <div className="mt-5 rounded-sm border border-gold bg-gold/10 p-4">
                <span className="block font-mono text-xs font-semibold uppercase tracking-wider text-gold">
                  Comprovante de Arremate Emitido
                </span>
                <p className="mt-1 font-mono text-xs tabular-nums text-paper-text dark:text-charcoal-text">
                  Codigo: {lotData.certificate.receipt_code} — Vencedor:{" "}
                  {lotData.certificate.winner_masked_name}
                </p>
                <Link
                  to={`/receipts/${lotData.certificate.receipt_code}`}
                  className="mt-3 inline-block rounded-sm border border-primary bg-primary px-4 py-2 font-mono text-xs font-semibold text-white hover:bg-primary-hover"
                >
                  Abrir Certificado Assinado (HMAC-SHA256)
                </Link>
              </div>
            )}

            {/* Feedback de Aceite ou Recusa de Lance */}
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

            {/* Controles de Submissao de Lance */}
            {lotData.status === "LIVE" && (
              <div className="mt-5 border-t border-paper-border dark:border-charcoal-border pt-5">
                {!user ? (
                  <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg p-4 text-center">
                    <p className="text-xs text-paper-subtext dark:text-charcoal-subtext">
                      Autentique-se como Licitante (ou use os botoes de 1 clique no topo) para submeter lances em tempo real.
                    </p>
                    <Link
                      to="/login"
                      className="mt-3 inline-block rounded-sm border border-primary bg-primary px-4 py-2 text-xs font-semibold text-white"
                    >
                      Autenticar Licitante
                    </Link>
                  </div>
                ) : user.role === "AUCTIONEER" ? (
                  <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg p-4 text-xs text-paper-subtext dark:text-charcoal-subtext">
                    Voce esta autenticado como Leiloeiro ({user.masked_name}). Para disputar este lote, selecione Licitante 1 ou Licitante 2 na barra de acesso rapido no topo.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {wallet && (
                      <div className="flex items-center justify-between text-xs text-paper-subtext dark:text-charcoal-subtext">
                        <span>Seu Saldo Disponivel:</span>
                        <span className="font-mono font-semibold tabular-nums text-status-winning">
                          {formatBrlCents(wallet.available_balance_cents)}
                        </span>
                      </div>
                    )}

                    {/* Botoes de Lance Rapido */}
                    <div className="grid grid-cols-3 gap-2">
                      {quickAmounts.map((q) => (
                        <button
                          key={q.label}
                          type="button"
                          disabled={isSubmittingBid}
                          onClick={() => void submitBidCents(q.cents)}
                          className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-2 py-2 text-center transition-colors hover:border-primary disabled:opacity-50"
                        >
                          <span className="block font-mono text-[10px] uppercase text-paper-subtext dark:text-charcoal-subtext">
                            {q.label}
                          </span>
                          <span className="mt-0.5 block font-mono text-xs font-bold tabular-nums text-paper-text dark:text-charcoal-text">
                            {formatBrlCents(q.cents)}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Formulario de Lance Customizado */}
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
                        {isSubmittingBid ? "Enviando..." : "Confirmar Lance"}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Historico de Lances em Tempo Real */}
          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface">
            <div className="flex items-center justify-between border-b border-paper-border dark:border-charcoal-border px-5 py-3.5">
              <h2 className="font-serif text-lg font-semibold text-paper-text dark:text-charcoal-text">
                Livro de Lances em Tempo Real
              </h2>
              <span className="font-mono text-xs tabular-nums text-paper-subtext dark:text-charcoal-subtext">
                {bidsHistory.length} registros
              </span>
            </div>

            {bidsHistory.length === 0 ? (
              <div className="p-6 text-center text-xs text-paper-subtext dark:text-charcoal-subtext">
                Nenhum lance registrado ainda. O primeiro lance partira do bloco GENESIS.
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
                            +2 MIN
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
                        SHA-256: {bid.current_hash.slice(0, 16)}...
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
