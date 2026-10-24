import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { SEED_ACCOUNTS, useAuth } from "../context/AuthContext.tsx";
import { useTheme } from "../context/ThemeContext.tsx";
import { useWallet } from "../context/WalletContext.tsx";
import { formatBrlCents } from "../utils/formatters.ts";

export const Header: React.FC = () => {
  const { user, quickSeedLogin, logout } = useAuth();
  const { wallet, deposit } = useWallet();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [isQuickDepositing, setIsQuickDepositing] = useState(false);
  const [isSwitchingProfile, setIsSwitchingProfile] = useState(false);

  const handleQuickDeposit = async () => {
    if (isQuickDepositing) return;
    setIsQuickDepositing(true);
    try {
      await deposit(100000);
    } finally {
      setIsQuickDepositing(false);
    }
  };

  const handleProfileSwitch = async (email: string) => {
    const preset = SEED_ACCOUNTS.find((a) => a.email === email);
    if (!preset) return;
    setIsSwitchingProfile(true);
    try {
      const logged = await quickSeedLogin(preset);
      if (logged.role === "AUCTIONEER" && location.pathname === "/wallet") {
        navigate("/auctioneer");
      } else if (logged.role === "BIDDER" && location.pathname === "/auctioneer") {
        navigate("/");
      }
    } finally {
      setIsSwitchingProfile(false);
    }
  };

  const navLinkClass = (path: string) => {
    const isActive =
      path === "/"
        ? location.pathname === "/"
        : location.pathname.startsWith(path);
    return `px-3 py-1.5 text-sm font-medium transition-colors rounded-sm border ${
      isActive
        ? "border-paper-text bg-paper-text text-paper-surface dark:border-charcoal-text dark:bg-charcoal-text dark:text-charcoal-bg"
        : "border-transparent text-paper-subtext hover:text-paper-text dark:text-charcoal-subtext dark:hover:text-charcoal-text"
    }`;
  };

  return (
    <header className="border-b border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface">
      <div className="border-b border-paper-border dark:border-charcoal-border bg-paper-muted/70 dark:bg-charcoal-muted/70">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-paper-subtext dark:text-charcoal-subtext">
            <span className="font-medium">Troca rápida de perfil:</span>
            {SEED_ACCOUNTS.map((preset) => {
              const isCurrent = user?.email === preset.email;
              return (
                <button
                  key={preset.email}
                  type="button"
                  disabled={isSwitchingProfile}
                  onClick={() => void handleProfileSwitch(preset.email)}
                  className={`rounded-sm border px-2 py-0.5 text-xs font-medium transition-colors ${
                    isCurrent
                      ? "border-primary bg-primary text-white"
                      : "border-paper-border bg-paper-surface text-paper-text hover:border-paper-text dark:border-charcoal-border dark:bg-charcoal-surface dark:text-charcoal-text"
                  }`}
                >
                  {preset.roleLabel}: {preset.label.split(" ")[0]}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-2.5 py-1 text-xs font-medium text-paper-text dark:text-charcoal-text hover:border-paper-text dark:hover:border-charcoal-text"
              aria-label="Alternar tema claro ou escuro"
            >
              Tema: {theme === "light" ? "Claro" : "Escuro"}
            </button>

            {user ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono font-medium text-paper-text dark:text-charcoal-text">
                  {user.masked_name}
                </span>
                <button
                  type="button"
                  onClick={logout}
                  className="underline text-paper-subtext hover:text-paper-text dark:text-charcoal-subtext dark:hover:text-charcoal-text"
                >
                  Sair
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="text-xs font-medium underline text-primary hover:text-primary-hover"
              >
                Entrar
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link
            to="/"
            className="font-sans text-xl font-semibold tracking-tight text-paper-text dark:text-charcoal-text"
          >
            Casa de Leilões Verzel
          </Link>

          <nav className="flex flex-wrap items-center gap-1" aria-label="Navegação principal">
            <Link to="/" className={navLinkClass("/")}>
              Vitrine de Lotes
            </Link>
            {user?.role === "BIDDER" && (
              <>
                <Link to="/wallet" className={navLinkClass("/wallet")}>
                  Carteira
                </Link>
                <Link to="/my-bids" className={navLinkClass("/my-bids")}>
                  Meus Arremates
                </Link>
              </>
            )}
            {user?.role === "AUCTIONEER" && (
              <Link to="/auctioneer" className={navLinkClass("/auctioneer")}>
                Painel do Leiloeiro
              </Link>
            )}
          </nav>
        </div>

        {user?.role === "BIDDER" && wallet && (
          <div className="flex flex-wrap items-center gap-3 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3.5 py-2">
            <div className="border-r border-paper-border dark:border-charcoal-border pr-3">
              <span className="block text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
                Total
              </span>
              <span className="font-mono text-xs font-semibold tabular-nums text-paper-text dark:text-charcoal-text">
                {formatBrlCents(wallet.total_balance_cents)}
              </span>
            </div>

            <div className="border-r border-paper-border dark:border-charcoal-border pr-3">
              <span className="block text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
                Comprometido
              </span>
              <span className="font-mono text-xs font-semibold tabular-nums text-status-warning">
                {formatBrlCents(wallet.committed_balance_cents)}
              </span>
            </div>

            <div className="pr-1">
              <span className="block text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
                Disponível
              </span>
              <span className="font-mono text-sm font-bold tabular-nums text-status-winning">
                {formatBrlCents(wallet.available_balance_cents)}
              </span>
            </div>

            <button
              type="button"
              disabled={isQuickDepositing}
              onClick={() => void handleQuickDeposit()}
              title="Depositar R$ 1.000,00 na carteira"
              className="rounded-sm border border-primary bg-primary px-2.5 py-1.5 font-sans text-xs font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50 tabular-nums"
            >
              {isQuickDepositing ? "Aportando..." : "+ R$ 1.000"}
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
