import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArtworkFrame } from "../components/ArtworkFrame.tsx";
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
            : "Comprovante de arremate nao encontrado.",
        ),
      )
      .finally(() => setIsLoading(false));
  }, [code]);

  const handleCopyPublicLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // ignora se clipboard nao suportado
    }
  };

  if (isLoading) {
    return (
      <main className="mx-auto max-w-[900px] px-4 py-12 sm:px-6">
        <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-8 text-sm text-paper-subtext dark:text-charcoal-subtext">
          Verificando certificado e assinatura HMAC-SHA256...
        </div>
      </main>
    );
  }

  if (errorMsg || !receipt) {
    return (
      <main className="mx-auto max-w-[900px] px-4 py-12 sm:px-6">
        <div
          role="alert"
          className="rounded-sm border border-status-outbid bg-status-outbid/10 p-6 text-status-outbid"
        >
          <h1 className="font-serif text-2xl font-semibold">
            Comprovante Nao Localizado
          </h1>
          <p className="mt-2 text-sm">{errorMsg}</p>
          <Link to="/" className="mt-4 inline-block font-mono text-xs underline">
            Retornar a Vitrine
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[900px] px-4 py-10 sm:px-6">
      <article className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6 sm:p-10">
        {/* Cabecalho Editorial do Certificado */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-paper-border dark:border-charcoal-border pb-6">
          <div>
            <h1 className="font-serif text-3xl font-semibold text-paper-text dark:text-charcoal-text">
              Comprovante #{receipt.receipt_code}
            </h1>
            <p className="mt-1 font-mono text-xs uppercase tracking-widest text-gold">
              Certificado Oficial de Liquidacao e Arremate
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`rounded-sm border px-3 py-1 font-mono text-xs font-semibold ${
                receipt.is_signature_valid
                  ? "border-status-winning bg-status-winning/10 text-status-winning"
                  : "border-status-outbid bg-status-outbid/10 text-status-outbid"
              }`}
            >
              {receipt.is_signature_valid
                ? "ASSINATURA HMAC VALIDA"
                : "ASSINATURA INVALIDA"}
            </span>
            <button
              type="button"
              onClick={() => void handleCopyPublicLink()}
              className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 py-1 font-mono text-xs hover:border-paper-text"
            >
              {copied ? "Link Copiado" : "Copiar Link Publico"}
            </button>
          </div>
        </div>

        {/* Obra e Dados Financeiros */}
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
              <span className="font-mono text-xs text-paper-subtext dark:text-charcoal-subtext tabular-nums">
                LOTE #{receipt.lot_number}
              </span>
              <h2 className="font-serif text-2xl font-semibold text-paper-text dark:text-charcoal-text">
                {receipt.title}
              </h2>
              <p className="text-sm text-paper-subtext dark:text-charcoal-subtext">
                {receipt.artist} ({receipt.date_display}) — {receipt.medium_display}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 border-y border-paper-border dark:border-charcoal-border py-4">
              <div>
                <span className="block font-mono text-[11px] uppercase text-paper-subtext dark:text-charcoal-subtext">
                  Arrematante (Mascarado)
                </span>
                <span className="mt-1 block font-mono text-sm font-bold text-paper-text dark:text-charcoal-text">
                  {receipt.winner_masked_name}
                </span>
              </div>

              <div>
                <span className="block font-mono text-[11px] uppercase text-paper-subtext dark:text-charcoal-subtext">
                  Valor Final Liquidado
                </span>
                <span className="mt-1 block font-sans text-xl font-bold tabular-nums text-status-winning">
                  {formatBrlCents(receipt.final_amount_cents)}
                </span>
              </div>
            </div>

            <div className="font-mono text-xs text-paper-subtext dark:text-charcoal-subtext tabular-nums">
              Data/Hora da Liquidacao (UTC): {receipt.settled_at_iso}
            </div>
          </div>
        </div>

        {/* Provas Criptograficas */}
        <div className="mt-8 space-y-3 border-t border-paper-border dark:border-charcoal-border pt-6 font-mono text-xs">
          <div>
            <span className="block text-[10px] uppercase text-paper-subtext dark:text-charcoal-subtext">
              Hash do Lance Vencedor (Final Bid SHA-256)
            </span>
            <p className="mt-1 break-all rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg p-2.5">
              {receipt.final_bid_hash}
            </p>
          </div>

          <div>
            <span className="block text-[10px] uppercase text-paper-subtext dark:text-charcoal-subtext">
              Assinatura Criptografica do Certificado (HMAC-SHA256)
            </span>
            <p className="mt-1 break-all rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg p-2.5">
              {receipt.receipt_signature}
            </p>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
            <Link
              to={`/lots/${receipt.lot_id}`}
              className="underline text-paper-subtext hover:text-paper-text"
            >
              Ver Pagina do Lote #{receipt.lot_number}
            </Link>
            <Link
              to={`/lots/${receipt.lot_id}/audit`}
              className="underline text-primary hover:text-primary-hover"
            >
              Inspecionar Cadeia Completa de Lances (SHA-256)
            </Link>
          </div>
        </div>
      </article>
    </main>
  );
};
