import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArtworkFrame } from "../components/ArtworkFrame.tsx";
import { UserDisputesSection } from "../components/dashboard/UserDisputesSection.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { settlementApi } from "../services/api.ts";
import type { BidderBidsAndWins } from "../types/api.ts";
import { formatBrlCents } from "../utils/formatters.ts";

function formatBidStatusPt(status: string): string {
  switch (status) {
    case "WINNING":
      return "Liderando";
    case "OUTBID":
      return "Superado";
    case "WON":
      return "Arrematado";
    case "CANCELLED":
      return "Cancelado";
    default:
      return status;
  }
}

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
            : "Falha ao carregar histórico de lances e arremates.",
        ),
      )
      .finally(() => setIsLoading(false));
  }, [user]);

  if (!user || user.role !== "BIDDER") {
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6">
        <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-8 shadow-card">
          <h1 className="font-serif text-2xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
            Histórico exclusivo para licitantes
          </h1>
          <p className="mt-2 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
            Selecione um perfil de licitante no topo da página para ver seus lotes disputados e comprovantes.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 space-y-8">
      <div className="border-b border-paper-border dark:border-charcoal-border pb-5">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
          Meus Arremates
        </h1>
        <p className="mt-1.5 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
          Acompanhe os lotes que você venceu e as disputas de que participou.
        </p>
      </div>

      <UserDisputesSection
        hideIfEmpty={false}
        title="Painel de Disputas"
        subtitle="Gerencie seus lances ativos, lotes arrematados e disputas superadas em tempo real."
      />

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
          Carregando arremates e participações...
        </div>
      ) : (
        <>
          <section>
            <h2 className="font-serif text-xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
              Obras arrematadas ({data?.won_lots.length ?? 0})
            </h2>

            {!data || data.won_lots.length === 0 ? (
              <div className="mt-4 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext shadow-card">
                Você ainda não possui lotes encerrados como vencedor.
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
                {data.won_lots.map((lot) => (
                  <article
                    key={lot.id}
                    className="flex flex-col justify-between rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5 shadow-card"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs tabular-nums text-paper-subtext dark:text-charcoal-subtext">
                          Lote #{lot.lot_number}
                        </span>
                        <span className="rounded-full border border-status-winning bg-status-winning/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-status-winning">
                          Arrematado
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

                      <h3 className="mt-4 font-serif text-lg font-bold text-paper-text dark:text-charcoal-text leading-snug">
                        {lot.title}
                      </h3>
                      <p className="font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
                        {lot.artist} ({lot.date_display})
                      </p>
                    </div>

                    <div className="mt-4 border-t border-paper-border dark:border-charcoal-border pt-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <span className="block text-[11px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                          Valor pago
                        </span>
                        <span className="font-mono text-lg font-bold tabular-nums text-status-winning">
                          {formatBrlCents(lot.current_bid_cents)}
                        </span>
                      </div>

                      {lot.certificate && (
                        <Link
                          to={`/receipts/${lot.certificate.receipt_code}`}
                          className="rounded-sm border border-primary bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white hover:bg-primary-hover dark:border-gold dark:bg-gold dark:text-charcoal-bg"
                        >
                          Ver comprovante
                        </Link>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
              Lotes disputados ({data?.participated_lots.length ?? 0})
            </h2>

            {!data || data.participated_lots.length === 0 ? (
              <div className="mt-4 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext shadow-card">
                Você ainda não enviou lances em nenhum lote.
              </div>
            ) : (
              <div className="mt-4 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface overflow-x-auto shadow-card">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-paper-border dark:border-charcoal-border bg-paper-muted/50 dark:bg-charcoal-muted/50 text-[11px] uppercase tracking-wider font-medium text-paper-subtext dark:text-charcoal-subtext">
                      <th className="px-5 py-3">Lote</th>
                      <th className="px-5 py-3">Obra</th>
                      <th className="px-5 py-3 text-right">Sua maior oferta</th>
                      <th className="px-5 py-3 text-right">Maior oferta atual</th>
                      <th className="px-5 py-3">Sua posição</th>
                      <th className="px-5 py-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.participated_lots.map((item) => (
                      <tr
                        key={item.lot.id}
                        className="border-b border-paper-border dark:border-charcoal-border last:border-b-0 hover:bg-paper-muted/30 dark:hover:bg-charcoal-muted/30 transition-colors"
                      >
                        <td className="px-5 py-3.5 font-mono text-xs font-semibold tabular-nums">
                          #{item.lot.lot_number}
                        </td>
                        <td className="px-5 py-3.5 font-serif text-sm font-bold text-paper-text dark:text-charcoal-text">
                          <Link to={`/lots/${item.lot.id}`} className="hover:text-primary dark:hover:text-gold transition-colors">
                            {item.lot.title}
                          </Link>
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-xs tabular-nums">
                          {formatBrlCents(item.my_highest_bid_cents)}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-xs font-bold tabular-nums text-primary dark:text-gold">
                          {formatBrlCents(item.lot.current_bid_cents)}
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                              item.user_bid_status === "WINNING" ||
                              item.user_bid_status === "WON"
                                ? "border-status-winning bg-status-winning/10 text-status-winning"
                                : "border-status-outbid bg-status-outbid/10 text-status-outbid"
                            }`}
                          >
                            {formatBidStatusPt(item.user_bid_status)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <Link
                            to={`/lots/${item.lot.id}`}
                            className="text-xs font-medium uppercase tracking-wider underline text-primary dark:text-gold"
                          >
                            Ver lote
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
