import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { NotificationBell } from "./NotificationBell.tsx";
import { VerzelEmblem } from "./VerzelEmblem.tsx";
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
  const [profileError, setProfileError] = useState<string | null>(null);

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
    setProfileError(null);
    try {
      const logged = await quickSeedLogin(preset);
      if (logged.role === "AUCTIONEER" && location.pathname === "/wallet") {
        navigate("/auctioneer");
      } else if (logged.role === "BIDDER" && location.pathname === "/auctioneer") {
        navigate("/");
      }
    } catch (err) {
      setProfileError(
        err instanceof Error ? err.message : "Falha ao trocar de perfil.",
      );
    } finally {
      setIsSwitchingProfile(false);
    }
  };

  const navLinkClass = (path: string) => {
    const isActive =
      path === "/"
        ? location.pathname === "/"
        : location.pathname.startsWith(path);
    return `px-3.5 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors rounded-sm border shrink-0 whitespace-nowrap ${
      isActive
        ? "border-primary bg-primary text-white dark:border-gold dark:bg-gold/15 dark:text-gold"
        : "border-transparent text-paper-subtext hover:text-paper-text hover:border-paper-border dark:text-charcoal-subtext dark:hover:text-charcoal-text dark:hover:border-charcoal-border"
    }`;
  };

  return (
    <header className="border-b border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface w-full max-w-full">
      <div className="border-b border-paper-border dark:border-charcoal-border bg-paper-muted/60 dark:bg-charcoal-muted/60">
        <div className="mx-auto flex max-w-[1280px] flex-col md:flex-row items-stretch md:items-center justify-between gap-2 md:gap-3 px-3 py-1.5 sm:px-6">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 text-xs text-paper-subtext dark:text-charcoal-subtext shrink min-w-0">
            <span className="font-serif italic shrink-0 hidden sm:inline">Alternar licitante:</span>
            <span className="font-serif italic shrink-0 sm:hidden">Licitante:</span>
            {SEED_ACCOUNTS.map((preset) => {
              const isCurrent = user?.email === preset.email;
              return (
                <button
                  key={preset.email}
                  type="button"
                  disabled={isSwitchingProfile}
                  onClick={() => void handleProfileSwitch(preset.email)}
                  className={`rounded-sm border px-2 py-0.5 text-[11px] font-medium transition-colors shrink-0 whitespace-nowrap ${
                    isCurrent
                      ? "border-primary bg-primary text-white dark:border-gold dark:bg-gold dark:text-charcoal-bg"
                      : "border-paper-border bg-paper-surface text-paper-text hover:border-paper-text dark:border-charcoal-border dark:bg-charcoal-surface dark:text-charcoal-text"
                  }`}
                >
                  {preset.roleLabel}: {preset.maskedName}
                </button>
              );
            })}
            {profileError && (
              <span role="alert" className="text-xs font-semibold text-status-outbid shrink-0">
                {profileError}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between md:justify-end gap-2.5 text-xs shrink-0 w-full md:w-auto pt-1 md:pt-0 border-t md:border-t-0 border-paper-border/40 dark:border-charcoal-border/40">
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-2.5 py-1 text-xs font-medium text-paper-text dark:text-charcoal-text hover:border-paper-text dark:hover:border-charcoal-text shrink-0"
              aria-label="Alternar tema claro ou escuro"
            >
              {theme === "light" ? "Modo Escuro" : "Modo Claro"}
            </button>

            {user ? (
              <div className="flex items-center gap-2 sm:gap-2.5 text-xs shrink-0">
                <NotificationBell />
                <span className="font-mono font-medium text-paper-text dark:text-charcoal-text truncate max-w-[110px] sm:max-w-none">
                  {user.masked_name}
                </span>
                <button
                  type="button"
                  onClick={logout}
                  className="underline text-paper-subtext hover:text-paper-text dark:text-charcoal-subtext dark:hover:text-charcoal-text shrink-0"
                >
                  Sair
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="text-xs font-medium uppercase tracking-wider text-primary hover:underline dark:text-gold shrink-0"
              >
                Cadastre-se / Entrar
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1280px] flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 px-4 py-2.5 sm:py-3 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between lg:justify-start gap-3 sm:gap-6 w-full lg:w-auto">
          <Link
            to="/"
            className="group flex items-center gap-2.5 sm:gap-3.5 transition-opacity hover:opacity-90 shrink-0"
          >
            <VerzelEmblem className="h-10 w-10 sm:h-12 sm:w-12 lg:h-14 lg:w-14 transition-transform duration-200 group-hover:scale-105 shrink-0" />
            <span className="font-display text-xl sm:text-2xl lg:text-3xl font-bold tracking-wider text-paper-text dark:text-charcoal-text uppercase leading-none">
              Casa de Leilões Verzel
            </span>
          </Link>

          <nav className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0" aria-label="Navegação principal">
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
          <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2.5 sm:gap-3 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-muted/30 dark:bg-charcoal-muted/30 px-3 py-2 shadow-card w-full sm:w-auto">
            <div className="border-r border-paper-border dark:border-charcoal-border pr-2.5 sm:pr-3">
              <span className="block text-[10px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                Total
              </span>
              <span className="font-mono text-xs font-semibold tabular-nums text-paper-text dark:text-charcoal-text">
                {formatBrlCents(wallet.total_balance_cents)}
              </span>
            </div>

            <div className="border-r border-paper-border dark:border-charcoal-border pr-2.5 sm:pr-3">
              <span className="block text-[10px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                Comprometido
              </span>
              <span className="font-mono text-xs font-semibold tabular-nums text-status-warning">
                {formatBrlCents(wallet.committed_balance_cents)}
              </span>
            </div>

            <div className="pr-1">
              <span className="block text-[10px] uppercase tracking-wider text-paper-subtext dark:text-charcoal-subtext">
                Disponível
              </span>
              <span className="font-mono text-xs sm:text-sm font-bold tabular-nums text-status-winning">
                {formatBrlCents(wallet.available_balance_cents)}
              </span>
            </div>

            <button
              type="button"
              disabled={isQuickDepositing}
              onClick={() => void handleQuickDeposit()}
              title="Depositar R$ 1.000,00 na carteira"
              className="rounded-sm border border-primary bg-primary px-2.5 sm:px-3 py-1 sm:py-1.5 font-sans text-xs font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50 tabular-nums dark:border-gold dark:bg-gold dark:text-charcoal-bg dark:hover:bg-gold-hover shrink-0"
            >
              {isQuickDepositing ? "Depositando..." : "+ R$ 1.000"}
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
