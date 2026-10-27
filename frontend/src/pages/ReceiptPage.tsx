import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArtworkFrame } from "../components/ArtworkFrame.tsx";
import { VerzelEmblem } from "../components/VerzelEmblem.tsx";
import { settlementApi } from "../services/api.ts";
import type { PublicReceipt } from "../types/api.ts";
import { formatBrlCents } from "../utils/formatters.ts";

export const ReceiptPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const [receipt, setReceipt] = useState<PublicReceipt | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    if (!code) return;
    setIsLoading(true);
    setErrorMsg(null);
    settlementApi
      .getPublicReceipt(code)
      .then((data) => setReceipt(data))
      .catch((err) =>
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "Comprovante de arremate não encontrado.",
        ),
      )
      .finally(() => setIsLoading(false));
  }, [code]);

  const handleCopyPublicLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.warn("Não foi possível copiar o link para a área de transferência:", err);
    }
  };

  if (isLoading) {
    return (
      <main className="mx-auto max-w-[900px] px-4 py-12 sm:px-6">
        <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-8 text-sm text-paper-subtext dark:text-charcoal-subtext shadow-card">
          Carregando comprovante...
        </div>
      </main>
    );
  }

  if (errorMsg || !receipt) {
    return (
      <main className="mx-auto max-w-[900px] px-4 py-12 sm:px-6">
        <div
          role="alert"
          className="rounded-sm border border-status-outbid bg-status-outbid/10 p-6 text-status-outbid shadow-card"
        >
          <h1 className="font-serif text-2xl font-bold">
            Comprovante não encontrado
          </h1>
          <p className="mt-2 text-sm">{errorMsg}</p>
          <Link to="/" className="mt-4 inline-block text-xs font-medium uppercase tracking-wider underline">
            Voltar para a vitrine
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[900px] px-4 py-10 sm:px-6">
      <article className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6 sm:p-10 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-paper-border dark:border-charcoal-border pb-6">
          <div className="flex items-start gap-4">
            <VerzelEmblem className="h-16 w-16 sm:h-20 sm:w-20" />
            <div>
              <h1 className="font-serif text-3xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
                Comprovante de Arremate #{receipt.receipt_code}
              </h1>
              <p className="mt-1 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
                Documento público emitido pela Casa de Leilões com assinatura criptográfica verificada.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                receipt.is_signature_valid
                  ? "border-status-winning bg-status-winning/10 text-status-winning"
                  : "border-status-outbid bg-status-outbid/10 text-status-outbid"
              }`}
            >
              {receipt.is_signature_valid
                ? "Assinatura válida"
                : "Assinatura inválida"}
            </span>
            <button
              type="button"
              onClick={() => void handleCopyPublicLink()}
              className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 py-1 text-xs font-medium uppercase tracking-wider text-paper-text dark:text-charcoal-text hover:border-paper-text"
            >
              {copied ? "Link copiado" : "Copiar link"}
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-12">
          <div className="md:col-span-5">
            <ArtworkFrame
              imageUrl={receipt.image_url}
              title={receipt.title}
              artist={receipt.artist}
              aspectClassName="h-64"
            />
          </div>

          <div className="md:col-span-7 space-y-4">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext tabular-nums">
                Lote #{receipt.lot_number}
              </span>
              <h2 className="mt-1 font-serif text-2xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
                {receipt.title}
              </h2>
              <p className="font-serif italic text-base text-paper-subtext dark:text-charcoal-subtext">
                {receipt.artist} ({receipt.date_display})
              </p>
              <p className="text-xs text-paper-subtext dark:text-charcoal-subtext">
                {receipt.medium_display}
              </p>
            </div>

            <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg p-4 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-paper-subtext dark:text-charcoal-subtext">
                  Vencedor (Licitante):
                </span>
                <span className="font-mono font-medium">
                  {receipt.winner_masked_name}
                </span>
              </div>

              <div className="flex justify-between text-xs">
                <span className="text-paper-subtext dark:text-charcoal-subtext">
                  Valor final liquidado:
                </span>
                <span className="font-mono text-base font-bold tabular-nums text-status-winning">
                  {formatBrlCents(receipt.final_amount_cents)}
                </span>
              </div>

              <div className="flex justify-between text-xs">
                <span className="text-paper-subtext dark:text-charcoal-subtext">
                  Data de liquidação:
                </span>
                <span className="font-mono text-[11px] tabular-nums">
                  {new Date(receipt.settled_at).toLocaleString("pt-BR")}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-paper-border dark:border-charcoal-border pt-6 space-y-4">
          <div>
            <span className="block text-xs font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
              Hash do lance vencedor
            </span>
            <p className="mt-1 break-all rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg p-3 font-mono text-xs text-paper-text dark:text-charcoal-text">
              {receipt.final_bid_hash}
            </p>
          </div>

          <div>
            <span className="block text-xs font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
              Assinatura HMAC-SHA256
            </span>
            <p className="mt-1 break-all rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg p-3 font-mono text-xs text-paper-text dark:text-charcoal-text">
              {receipt.receipt_signature}
            </p>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
            <Link
              to={`/lots/${receipt.lot_id}/audit`}
              className="text-xs font-medium uppercase tracking-wider underline text-primary dark:text-gold"
            >
              Auditar cadeia de lances
            </Link>

            <Link
              to="/"
              className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-4 py-2 text-xs font-medium uppercase tracking-wider hover:border-paper-text"
            >
              Voltar para a vitrine
            </Link>
          </div>
        </div>
      </article>
    </main>
  );
};
