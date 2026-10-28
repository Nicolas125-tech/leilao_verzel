import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Volume2, VolumeX } from "lucide-react";
import { BidControlPanel } from "../components/auction/BidControlPanel.tsx";
import { BidHistoryFeed } from "../components/auction/BidHistoryFeed.tsx";
import { LotArtworkDetails } from "../components/auction/LotArtworkDetails.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { useWallet } from "../context/WalletContext.tsx";
import { useAuctionAudio } from "../hooks/useAuctionAudio.ts";
import { useLotWebSocket } from "../hooks/useLotWebSocket.ts";
import { lotsApi } from "../services/api.ts";
import { formatBrlCents } from "../utils/formatters.ts";

export const LiveAuctionPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { wallet, refreshWallet } = useWallet();
  const { lotData, bidsHistory, connectionStatus, error, reloadLot } =
    useLotWebSocket(id);
  const { isMuted, toggleMute, playBidSound, playGavelSound } =
    useAuctionAudio();

  const [customBidInput, setCustomBidInput] = useState<string>("");
  const [isSubmittingBid, setIsSubmittingBid] = useState<boolean>(false);
  const [bidFeedback, setBidFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const prevBidCountRef = useRef<number | null>(null);
  const prevStatusRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (!lotData) return;

    if (
      prevBidCountRef.current !== null &&
      lotData.bid_count > prevBidCountRef.current
    ) {
      playBidSound();
    }
    if (
      prevStatusRef.current === "LIVE" &&
      lotData.status === "ENDED"
    ) {
      playGavelSound();
    }

    prevBidCountRef.current = lotData.bid_count;
    prevStatusRef.current = lotData.status;
  }, [lotData, playBidSound, playGavelSound]);

  if (error && !lotData) {
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6">
        <div
          role="alert"
          className="rounded-sm border border-status-outbid bg-status-outbid/10 p-6 text-status-outbid shadow-card"
        >
          <h1 className="font-serif text-2xl font-bold">
            Lote indisponível
          </h1>
          <p className="mt-2 text-sm">{error}</p>
          <Link
            to="/"
            className="mt-4 inline-block text-xs font-medium uppercase tracking-wider underline"
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
        <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-8 text-sm text-paper-subtext dark:text-charcoal-subtext shadow-card">
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

  const handleBidSubmission = async (amountCents: number) => {
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

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-paper-border dark:border-charcoal-border pb-4">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-xs font-medium uppercase tracking-wider underline text-paper-subtext hover:text-paper-text dark:text-charcoal-subtext dark:hover:text-charcoal-text"
          >
            ← Voltar para a vitrine
          </Link>
          <span className="text-xs text-paper-subtext dark:text-charcoal-subtext">
            /
          </span>
          <span className="font-mono text-xs font-semibold tabular-nums">
            Lote #{lotData.lot_number}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={toggleMute}
            aria-label="Ativar/desativar som dos lances"
            aria-pressed={isMuted}
            className="inline-flex items-center gap-1.5 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-2.5 py-1 text-xs font-medium text-paper-text dark:text-charcoal-text hover:border-paper-text dark:hover:border-charcoal-text transition-colors motion-reduce:transition-none"
          >
            {isMuted ? (
              <VolumeX className="h-3.5 w-3.5 text-paper-subtext dark:text-charcoal-subtext" />
            ) : (
              <Volume2 className="h-3.5 w-3.5 text-primary dark:text-gold" />
            )}
            <span>{isMuted ? "Som desativado" : "Som ativo"}</span>
          </button>

          <span
            className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-wider ${
              connectionStatus === "CONNECTED"
                ? "border-status-winning/50 bg-status-winning/10 text-status-winning"
                : "border-status-warning/50 bg-status-warning/10 text-status-warning"
            }`}
          >
            {connectionStatus === "CONNECTED" ? "Ao vivo" : "Reconectando..."}
          </span>
          <Link
            to={`/lots/${lotData.id}/audit`}
            className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-3 py-1 text-xs font-medium uppercase tracking-wider hover:border-paper-text dark:hover:border-charcoal-text"
          >
            Auditoria
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <LotArtworkDetails lot={lotData} />

        <section className="lg:col-span-5 space-y-6">
          <BidControlPanel
            lot={lotData}
            minRequiredCents={minRequiredCents}
            customBidInput={customBidInput}
            onCustomBidInputChange={setCustomBidInput}
            onSubmitBid={handleBidSubmission}
            onReloadLot={() => void reloadLot()}
            isSubmittingBid={isSubmittingBid}
            bidFeedback={bidFeedback}
            user={user}
            wallet={wallet}
            isLeader={isLeader}
            isOutbid={isOutbid}
          />

          <BidHistoryFeed bids={bidsHistory} />
        </section>
      </div>
    </main>
  );
};
