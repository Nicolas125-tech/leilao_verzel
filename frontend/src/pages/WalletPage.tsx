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
        <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-8 shadow-card">
          <h1 className="font-serif text-2xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
            Área restrita a licitantes
          </h1>
          <p className="mt-2 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
            Apenas usuários com perfil de licitante possuem carteira de lances e extrato.
          </p>
          <Link
            to="/login"
            className="mt-4 inline-block rounded-sm border border-primary bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white hover:bg-primary-hover dark:border-gold dark:bg-gold dark:text-charcoal-bg"
          >
            Trocar para conta de licitante
          </Link>
        </div>
      </main>
    );
  }

  const handleDepositCents = async (amountCents: number) => {
    if (amountCents <= 0) {
      setFeedback({
        type: "error",
        message: "Informe um valor positivo em reais.",
      });
      return;
    }

    setIsDepositing(true);
    setFeedback(null);
    try {
      await deposit(amountCents);
      setFeedback({
        type: "success",
        message: `Depósito de ${formatBrlCents(amountCents)} adicionado ao saldo disponível.`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Erro ao processar depósito.",
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
        return "Depósito";
      case "BID_HOLD":
        return "Reserva (Líder)";
      case "BID_RELEASE":
        return "Estorno (Superado)";
      case "SETTLEMENT_DEBIT":
        return "Liquidação de arremate";
      case "CANCEL_REFUND":
        return "Estorno por cancelamento";
      default:
        return type;
    }
  };

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
      <div className="border-b border-paper-border dark:border-charcoal-border pb-5">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
          Minha Carteira
        </h1>
        <p className="mt-1 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
          Gerenciamento de saldo para emissão de ofertas e arremates.
        </p>
      </div>

      {wallet && (
        <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5 shadow-card">
            <span className="text-[11px] font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
              Saldo total
            </span>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-paper-text dark:text-charcoal-text">
              {formatBrlCents(wallet.total_balance_cents)}
            </p>
            <p className="mt-1 text-xs text-paper-subtext dark:text-charcoal-subtext">
              Soma do valor disponível e do valor comprometido.
            </p>
          </div>

          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5 shadow-card">
            <span className="text-[11px] font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
              Saldo comprometido em lances
            </span>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-status-warning">
              {formatBrlCents(wallet.committed_balance_cents)}
            </p>
            <p className="mt-1 text-xs text-paper-subtext dark:text-charcoal-subtext">
              Reservado apenas nos lotes em que você está liderando.
            </p>
          </div>

          <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-5 shadow-card">
            <span className="text-[11px] font-medium uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
              Saldo disponível
            </span>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-status-winning">
              {formatBrlCents(wallet.available_balance_cents)}
            </p>
            <p className="mt-1 text-xs text-paper-subtext dark:text-charcoal-subtext">
              Livre para enviar novos lances.
            </p>
          </div>
        </section>
      )}

      <section className="mt-6 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6 shadow-card">
        <h2 className="font-serif text-xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
          Adicionar Saldo
        </h2>

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

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {PRESET_DEPOSITS_CENTS.map((preset) => (
            <button
              key={preset.cents}
              type="button"
              disabled={isDepositing}
              onClick={() => void handleDepositCents(preset.cents)}
              className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-4 py-2.5 font-mono text-xs font-semibold tabular-nums text-paper-text dark:text-charcoal-text transition-colors hover:border-primary dark:hover:border-gold"
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
              aria-label="Valor de depósito em reais"
              placeholder="2500,00"
              className="h-[42px] w-40 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3 font-mono text-sm tabular-nums focus:border-gold focus:outline-none"
            />
            <button
              type="submit"
              disabled={isDepositing}
              className="h-[42px] rounded-sm border border-primary bg-primary px-5 text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-primary-hover disabled:opacity-50 dark:border-gold dark:bg-gold dark:text-charcoal-bg dark:hover:bg-gold-hover"
            >
              Depositar
            </button>
          </form>
        </div>
      </section>

      <section className="mt-8 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface shadow-card">
        <div className="border-b border-paper-border dark:border-charcoal-border px-6 py-4">
          <h2 className="font-serif text-xl font-bold tracking-tight text-paper-text dark:text-charcoal-text">
            Histórico de Movimentações
          </h2>
        </div>

        {isLoadingWallet ? (
          <div className="p-6 text-sm text-paper-subtext dark:text-charcoal-subtext">
            Carregando movimentações...
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-6 font-serif italic text-sm text-paper-subtext dark:text-charcoal-subtext">
            Nenhuma movimentação registrada até o momento.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-paper-border dark:border-charcoal-border bg-paper-muted/50 dark:bg-charcoal-muted/50 text-[11px] uppercase tracking-wider font-medium text-paper-subtext dark:text-charcoal-subtext">
                  <th className="px-6 py-3">Data / Hora</th>
                  <th className="px-6 py-3">Tipo</th>
                  <th className="px-6 py-3">Descrição</th>
                  <th className="px-6 py-3 text-right">Valor</th>
                  <th className="px-6 py-3 text-right">Total após</th>
                  <th className="px-6 py-3 text-right">Comprometido após</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="border-b border-paper-border dark:border-charcoal-border last:border-b-0 hover:bg-paper-muted/30 dark:hover:bg-charcoal-muted/30 transition-colors"
                  >
                    <td className="px-6 py-3.5 font-mono text-xs tabular-nums text-paper-subtext dark:text-charcoal-subtext">
                      {new Date(tx.created_at).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-6 py-3.5 text-xs font-medium">
                      {txBadge(tx.type)}
                    </td>
                    <td className="px-6 py-3.5 text-paper-text dark:text-charcoal-text">
                      {tx.description}
                    </td>
                    <td className="px-6 py-3.5 text-right font-mono text-xs font-semibold tabular-nums text-primary dark:text-gold">
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
