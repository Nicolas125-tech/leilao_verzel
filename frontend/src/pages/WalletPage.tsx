import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.tsx";
import { useWallet } from "../context/WalletContext.tsx";
import { formatBrlCents, parseBrlToCents } from "../utils/formatters.ts";

const PRESET_DEPOSITS_CENTS = [
  { label: "+ R$ 1.000,00", cents: 100000 },
  { label: "+ R$ 5.000,00", cents: 500000 },
  { label: "+ R$ 10.000,00", cents: 1000000 },
];

export const WalletPage: React.FC = () => {
  const { user } = useAuth();
  const { wallet, transactions, isLoadingWallet, deposit } = useWallet();

  const [customAmountInput, setCustomAmountInput] = useState("2500,00");
  const [isDepositing, setIsDepositing] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  if (!user || user.role !== "BIDDER") {
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6">
        <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-8">
          <h1 className="font-serif text-2xl font-semibold text-paper-text dark:text-charcoal-text">
            Area Restrita a Licitantes
          </h1>
          <p className="mt-2 text-sm text-paper-subtext dark:text-charcoal-subtext">
            Apenas usuarios autenticados com perfil Licitante (BIDDER) possuem carteira de lances e extrato de saldo comprometido.
          </p>
          <Link
            to="/login"
            className="mt-4 inline-block rounded-sm border border-primary bg-primary px-4 py-2 text-xs font-semibold text-white"
          >
            Alternar para Conta de Licitante
          </Link>
        </div>
      </main>
    );
  }

  const handleDepositCents = async (amountCents: number) => {
    if (amountCents <= 0) {
      setFeedback({
        type: "error",
        message: "Informe um valor de aporte positivo em reais.",
      });
      return;
    }

    setIsDepositing(true);
    setFeedback(null);
    try {
      await deposit(amountCents);
      setFeedback({
        type: "success",
        message: `Aporte de ${formatBrlCents(amountCents)} creditado imediatamente no saldo disponivel.`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Erro ao processar deposito.",
      });
    } finally {
      setIsDepositing(false);
    }
  };

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseBrlToCents(customAmountInput);
    await handleDepositCents(cents);
  };

  const txBadge = (type: string) => {
    switch (type) {
      case "DEPOSIT":
        return "APORTE DE SALDO";
      case "BID_HOLD":
        return "RETENCAO (LIDER)";
      case "BID_RELEASE":
        return "ESTORNO (SUPERADO)";
      case "SETTLEMENT_DEBIT":
        return "LIQUIDACAO ARREMATE";
      case "CANCEL_REFUND":
        return "ESTORNO CANCELAMENTO";
      default:
        return type;
    }
  };

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
      <div className="border-b border-paper-border dark:border-charcoal-border pb-6">
        <h1 className="font-serif text-3xl font-semibold text-paper-text dark:text-charcoal-text">
          Carteira &amp; Livro-Razao do Licitante
        </h1>
        <p className="mt-1.5 max-w-[68ch] text-sm text-paper-subtext dark:text-charcoal-subtext">
          Todo lance lider reserva imediatamente o valor correspondente no Saldo Comprometido. Se outro licitante superar sua oferta, o valor retorna instantaneamente ao Saldo Disponivel na mesma transacao.
        </p>
      </div>

      {/* Triade de Saldos */}
      {wallet && (
        <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5">
            <span className="font-mono text-xs uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
              Saldo Total na Casa
            </span>
            <p className="mt-2 font-sans text-2xl font-bold tabular-nums text-paper-text dark:text-charcoal-text">
              {formatBrlCents(wallet.total_balance_cents)}
            </p>
            <p className="mt-1 text-xs text-paper-subtext dark:text-charcoal-subtext">
              Patrimonio liquido custodiado (Disponivel + Comprometido).
            </p>
          </div>

          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5">
            <span className="font-mono text-xs uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
              Saldo Comprometido em Lances
            </span>
            <p className="mt-2 font-sans text-2xl font-bold tabular-nums text-status-warning">
              {formatBrlCents(wallet.committed_balance_cents)}
            </p>
            <p className="mt-1 text-xs text-paper-subtext dark:text-charcoal-subtext">
              Retido exclusivamente nos lotes em que voce detem a lideranca.
            </p>
          </div>

          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5">
            <span className="font-mono text-xs uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
              Saldo Disponivel p/ Novos Lances
            </span>
            <p className="mt-2 font-sans text-2xl font-bold tabular-nums text-status-winning">
              {formatBrlCents(wallet.available_balance_cents)}
            </p>
            <p className="mt-1 text-xs text-paper-subtext dark:text-charcoal-subtext">
              Limite imediato livre para novas ofertas no pregao.
            </p>
          </div>
        </section>
      )}

      {/* Aporte Simulado */}
      <section className="mt-6 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6">
        <h2 className="font-serif text-xl font-semibold text-paper-text dark:text-charcoal-text">
          Aporte Simulado Instantaneo
        </h2>
        <p className="mt-1 text-sm text-paper-subtext dark:text-charcoal-subtext">
          Adicione fundos instantaneamente para disputar lotes de alto valor na sala ao vivo.
        </p>

        {feedback && (
          <div
            role="alert"
            className={`mt-4 rounded-sm border px-4 py-3 text-sm ${
              feedback.type === "success"
                ? "border-status-winning bg-status-winning/10 text-status-winning"
                : "border-status-outbid bg-status-outbid/10 text-status-outbid"
            }`}
          >
            {feedback.message}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {PRESET_DEPOSITS_CENTS.map((preset) => (
            <button
              key={preset.cents}
              type="button"
              disabled={isDepositing}
              onClick={() => void handleDepositCents(preset.cents)}
              className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-4 py-2.5 font-mono text-xs font-semibold tabular-nums text-paper-text dark:text-charcoal-text transition-colors hover:border-primary"
            >
              {preset.label}
            </button>
          ))}

          <form
            onSubmit={(e) => void handleCustomSubmit(e)}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              type="text"
              value={customAmountInput}
              onChange={(e) => setCustomAmountInput(e.target.value)}
              aria-label="Valor de aporte customizado em reais"
              placeholder="2500,00"
              className="h-[42px] w-40 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 font-mono text-sm tabular-nums"
            />
            <button
              type="submit"
              disabled={isDepositing}
              className="h-[42px] rounded-sm border border-primary bg-primary px-5 text-xs font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              Confirmar Aporte Customizado
            </button>
          </form>
        </div>
      </section>

      {/* Tabela do Livro-Razao Cronologico */}
      <section className="mt-8 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface">
        <div className="border-b border-paper-border dark:border-charcoal-border px-6 py-4">
          <h2 className="font-serif text-xl font-semibold text-paper-text dark:text-charcoal-text">
            Livro-Razao Cronologico (Extrato Auditavel)
          </h2>
        </div>

        {isLoadingWallet ? (
          <div className="p-6 text-sm text-paper-subtext dark:text-charcoal-subtext">
            Sincronizando lancamentos...
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-6 text-sm text-paper-subtext dark:text-charcoal-subtext">
            Nenhuma movimentacao financeira registrada ate o momento.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-paper-border dark:border-charcoal-border bg-paper-muted/50 dark:bg-charcoal-muted/50 font-mono text-xs uppercase text-paper-subtext dark:text-charcoal-subtext">
                  <th className="px-6 py-3">Data / Hora (UTC)</th>
                  <th className="px-6 py-3">Natureza</th>
                  <th className="px-6 py-3">Historico</th>
                  <th className="px-6 py-3 text-right">Valor</th>
                  <th className="px-6 py-3 text-right">Total Apos</th>
                  <th className="px-6 py-3 text-right">Comprometido Apos</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="border-b border-paper-border dark:border-charcoal-border last:border-b-0"
                  >
                    <td className="px-6 py-3.5 font-mono text-xs tabular-nums text-paper-subtext dark:text-charcoal-subtext">
                      {new Date(tx.created_at).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-6 py-3.5 font-mono text-xs font-medium">
                      {txBadge(tx.type)}
                    </td>
                    <td className="px-6 py-3.5 text-paper-text dark:text-charcoal-text">
                      {tx.description}
                    </td>
                    <td className="px-6 py-3.5 text-right font-mono text-xs font-semibold tabular-nums">
                      {formatBrlCents(tx.amount_cents)}
                    </td>
                    <td className="px-6 py-3.5 text-right font-mono text-xs tabular-nums">
                      {formatBrlCents(tx.balance_after_cents)}
                    </td>
                    <td className="px-6 py-3.5 text-right font-mono text-xs tabular-nums text-status-warning">
                      {formatBrlCents(tx.committed_after_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
};
