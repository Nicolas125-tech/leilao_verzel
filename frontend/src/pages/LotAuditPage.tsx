import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { lotsApi } from "../services/api.ts";
import type { AuditChain } from "../types/api.ts";
import { formatBrlCents } from "../utils/formatters.ts";

export const LotAuditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [audit, setAudit] = useState<AuditChain | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runVerification = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await lotsApi.getAuditChain(id);
      setAudit(data);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Falha ao executar auditoria criptografica do lote.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void runVerification();
  }, [runVerification]);

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-paper-border dark:border-charcoal-border pb-6">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs text-paper-subtext dark:text-charcoal-subtext">
            <Link to="/" className="underline hover:text-paper-text">
              Vitrine
            </Link>
            <span>/</span>
            {id && (
              <Link to={`/lots/${id}`} className="underline hover:text-paper-text">
                Sala do Lote
              </Link>
            )}
          </div>
          <h1 className="mt-2 font-serif text-3xl font-semibold text-paper-text dark:text-charcoal-text">
            Verificador Publico de Integridade Criptografica (HMAC-SHA256)
          </h1>
          <p className="mt-1 max-w-[72ch] text-sm text-paper-subtext dark:text-charcoal-subtext">
            Recalcula em tempo real cada elo desde o bloco GENESIS diretamente a partir das linhas do PostgreSQL, detectando qualquer alteracao de valor (UPDATE), exclusao intermediaria ou truncamento (DELETE).
          </p>
        </div>

        <button
          type="button"
          disabled={isLoading}
          onClick={() => void runVerification()}
          className="rounded-sm border border-primary bg-primary px-4 py-2.5 font-mono text-xs font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {isLoading ? "Recalculando Hashes..." : "Reexecutar Auditoria Agora"}
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="mt-6 rounded-sm border border-status-outbid bg-status-outbid/10 p-4 text-sm text-status-outbid"
        >
          {errorMsg}
        </div>
      )}

      {audit && (
        <div className="mt-6 space-y-6">
          {/* Painel de Veredito */}
          <section
            className={`rounded-sm border p-6 ${
              audit.is_chain_valid
                ? "border-status-winning bg-status-winning/10"
                : "border-status-outbid bg-status-outbid/10"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2
                  className={`font-mono text-sm font-bold uppercase tracking-wider ${
                    audit.is_chain_valid
                      ? "text-status-winning"
                      : "text-status-outbid"
                  }`}
                >
                  {audit.is_chain_valid
                    ? "VEREDITO: HISTORICO INTEGRO — CADEIA CRIPTOGRAFICA AUTENTICA"
                    : `VEREDITO: ADULTERACAO DETECTADA NO BANCO DE DADOS (SEQUENCIA #${audit.broken_at_sequence ?? "?"})`}
                </h2>
                <p className="mt-1 font-serif text-xl font-semibold text-paper-text dark:text-charcoal-text">
                  Lote #{audit.lot_number} — {audit.title}
                </p>
              </div>

              <div className="text-right font-mono text-xs tabular-nums">
                <span className="block text-paper-subtext dark:text-charcoal-subtext">
                  Total de Lances Auditados: <strong>{audit.total_bids}</strong>
                </span>
                <span className="block text-paper-subtext dark:text-charcoal-subtext">
                  Head Hash do Lote: {audit.head_hash.slice(0, 20)}...
                </span>
              </div>
            </div>

            {!audit.is_chain_valid && audit.anomalies.length > 0 && (
              <div className="mt-4 border-t border-status-outbid/40 pt-3">
                <span className="block font-mono text-xs font-semibold uppercase text-status-outbid">
                  Diagnostico Forense das Anomalias Detectadas:
                </span>
                <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs text-status-outbid">
                  {audit.anomalies.map((anomaly, idx) => (
                    <li key={idx}>{anomaly}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Cadeia de Blocos Passo a Passo */}
          <section className="space-y-4">
            <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-4 font-mono text-xs">
              <span className="font-semibold text-gold">BLOCO #0 (ANCORA RAIZ):</span>{" "}
              <span className="text-paper-text dark:text-charcoal-text">GENESIS</span>
            </div>

            {audit.nodes.length === 0 ? (
              <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6 text-sm text-paper-subtext dark:text-charcoal-subtext">
                Este lote ainda nao recebeu lances. O Head Hash permanece ancorado em GENESIS.
              </div>
            ) : (
              audit.nodes.map((node) => {
                const hashMismatch = node.stored_hash !== node.recalculated_hash;
                const prevMismatch =
                  node.previous_hash !== node.expected_previous_hash;

                return (
                  <article
                    key={node.bid_id}
                    className={`rounded-sm border p-5 ${
                      node.is_valid
                        ? "border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface"
                        : "border-status-outbid bg-status-outbid/5"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-paper-border dark:border-charcoal-border pb-3">
                      <div className="flex items-center gap-3">
                        <span className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-2.5 py-1 font-mono text-xs font-bold tabular-nums">
                          BLOCO #{node.sequence_number}
                        </span>
                        <span className="font-mono text-xs font-semibold">
                          Licitante: {node.bidder_masked_name}
                        </span>
                        <span className="font-mono text-xs text-paper-subtext dark:text-charcoal-subtext tabular-nums">
                          {node.created_at_iso}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-bold tabular-nums">
                          {formatBrlCents(node.amount_cents)}
                        </span>
                        <span
                          className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase ${
                            node.is_valid
                              ? "border-status-winning text-status-winning"
                              : "border-status-outbid bg-status-outbid text-white"
                          }`}
                        >
                          {node.is_valid ? "ELO INTEGRO" : "ELO CORROMPIDO"}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 font-mono text-xs md:grid-cols-2">
                      <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg p-3">
                        <span className="block text-[10px] uppercase text-paper-subtext dark:text-charcoal-subtext">
                          Previous Hash Armazenado
                        </span>
                        <p
                          className={`mt-1 break-all ${
                            prevMismatch ? "text-status-outbid font-bold" : ""
                          }`}
                        >
                          {node.previous_hash}
                        </p>
                        {prevMismatch && (
                          <p className="mt-1 break-all text-[11px] text-status-outbid">
                            Esperado: {node.expected_previous_hash}
                          </p>
                        )}
                      </div>

                      <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg p-3">
                        <span className="block text-[10px] uppercase text-paper-subtext dark:text-charcoal-subtext">
                          Current Hash Armazenado vs. Recalculado
                        </span>
                        <p className="mt-1 break-all">
                          Banco: {node.stored_hash}
                        </p>
                        <p
                          className={`mt-1 break-all ${
                            hashMismatch
                              ? "font-bold text-status-outbid"
                              : "text-status-winning"
                          }`}
                        >
                          Calc.: {node.recalculated_hash}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </section>
        </div>
      )}
    </main>
  );
};
