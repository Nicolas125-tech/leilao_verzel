import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArtworkFrame } from "../components/ArtworkFrame.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { settlementApi } from "../services/api.ts";
import type { BidderBidsAndWins } from "../types/api.ts";
import { formatBrlCents } from "../utils/formatters.ts";

export const MyBidsPage: React.FC = () => {
  const { user } = useAuth();
  const [data, setData] = useState<BidderBidsAndWins | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!user || user.role !== "BIDDER") {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    settlementApi
      .getMyBidsAndWins()
      .then((res) => setData(res))
      .catch((err) =>
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "Falha ao carregar historico de lances e arremates.",
        ),
      )
      .finally(() => setIsLoading(false));
  }, [user]);

  if (!user || user.role !== "BIDDER") {
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6">
        <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-8">
          <h1 className="font-serif text-2xl font-semibold">
            Historico Exclusivo para Licitantes
          </h1>
          <p className="mt-2 text-sm text-paper-subtext dark:text-charcoal-subtext">
            Selecione um perfil Licitante no topo da pagina para visualizar seus lotes disputados e certificados de arremate.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 space-y-8">
      <div className="border-b border-paper-border dark:border-charcoal-border pb-6">
        <h1 className="font-serif text-3xl font-semibold text-paper-text dark:text-charcoal-text">
          Meus Lances &amp; Obras Arrematadas
        </h1>
        <p className="mt-1.5 text-sm text-paper-subtext dark:text-charcoal-subtext">
          Acompanhe sua posicao atual nas salas ativas e acesse os certificados publicos assinados dos lotes vencidos.
        </p>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-sm border border-status-outbid bg-status-outbid/10 p-4 text-sm text-status-outbid"
        >
          {errorMsg}
        </div>
      )}

      {isLoading ? (
        <div className="p-6 text-sm text-paper-subtext dark:text-charcoal-subtext">
          Carregando participacoes e certificados...
        </div>
      ) : (
        <>
          {/* Secao 1: Lotes Arrematados com Certificado */}
          <section>
            <h2 className="font-serif text-2xl font-semibold text-paper-text dark:text-charcoal-text">
              Obras Arrematadas ({data?.won_lots.length ?? 0})
            </h2>

            {!data || data.won_lots.length === 0 ? (
              <div className="mt-4 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6 text-sm text-paper-subtext dark:text-charcoal-subtext">
                Voce ainda nao possui lotes encerrados como vencedor.
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
                {data.won_lots.map((lot) => (
                  <article
                    key={lot.id}
                    className="flex flex-col justify-between rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs tabular-nums text-paper-subtext dark:text-charcoal-subtext">
                          LOTE #{lot.lot_number}
                        </span>
                        <span className="rounded-sm border border-status-winning bg-status-winning/10 px-2 py-0.5 font-mono text-xs font-semibold text-status-winning">
                          ARREMATADO
                        </span>
                      </div>

                      <div className="mt-3">
                        <ArtworkFrame
                          imageUrl={lot.image_url}
                          title={lot.title}
                          artist={lot.artist}
                          aspectClassName="h-48"
                        />
                      </div>

                      <h3 className="mt-4 font-serif text-2xl font-semibold">
                        {lot.title}
                      </h3>
                      <p className="text-sm text-paper-subtext dark:text-charcoal-subtext">
                        {lot.artist} ({lot.date_display})
                      </p>
                    </div>

                    <div className="mt-4 border-t border-paper-border dark:border-charcoal-border pt-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <span className="block font-mono text-[10px] uppercase text-paper-subtext dark:text-charcoal-subtext">
                          Valor Liquidado
                        </span>
                        <span className="font-mono text-lg font-bold tabular-nums text-status-winning">
                          {formatBrlCents(lot.current_bid_cents)}
                        </span>
                      </div>

                      {lot.certificate && (
                        <Link
                          to={`/receipts/${lot.certificate.receipt_code}`}
                          className="rounded-sm border border-primary bg-primary px-4 py-2 font-mono text-xs font-semibold text-white hover:bg-primary-hover"
                        >
                          Comprovante {lot.certificate.receipt_code}
                        </Link>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Secao 2: Todos os Lotes Disputados */}
          <section>
            <h2 className="font-serif text-2xl font-semibold text-paper-text dark:text-charcoal-text">
              Participacoes em Pregao ({data?.participated_lots.length ?? 0})
            </h2>

            {!data || data.participated_lots.length === 0 ? (
              <div className="mt-4 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6 text-sm text-paper-subtext dark:text-charcoal-subtext">
                Voce ainda nao submeteu lances em nenhum lote.
              </div>
            ) : (
              <div className="mt-4 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-paper-border dark:border-charcoal-border bg-paper-muted/50 dark:bg-charcoal-muted/50 font-mono text-xs uppercase text-paper-subtext dark:text-charcoal-subtext">
                      <th className="px-5 py-3">Lote</th>
                      <th className="px-5 py-3">Obra</th>
                      <th className="px-5 py-3 text-right">Sua Maior Oferta</th>
                      <th className="px-5 py-3 text-right">Maior Oferta Geral</th>
                      <th className="px-5 py-3">Sua Posicao</th>
                      <th className="px-5 py-3 text-right">Acao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.participated_lots.map((item) => (
                      <tr
                        key={item.lot.id}
                        className="border-b border-paper-border dark:border-charcoal-border last:border-b-0"
                      >
                        <td className="px-5 py-3.5 font-mono text-xs font-semibold tabular-nums">
                          #{item.lot.lot_number}
                        </td>
                        <td className="px-5 py-3.5 font-serif text-base font-semibold">
                          {item.lot.title}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-xs tabular-nums">
                          {formatBrlCents(item.my_highest_bid_cents)}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-xs font-bold tabular-nums">
                          {formatBrlCents(item.lot.current_bid_cents)}
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] font-semibold ${
                              item.user_bid_status === "WINNING" ||
                              item.user_bid_status === "WON"
                                ? "border-status-winning text-status-winning"
                                : "border-status-outbid text-status-outbid"
                            }`}
                          >
                            {item.user_bid_status}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <Link
                            to={`/lots/${item.lot.id}`}
                            className="font-mono text-xs underline text-primary"
                          >
                            Abrir Sala
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
};
