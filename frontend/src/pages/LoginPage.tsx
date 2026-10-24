import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SEED_ACCOUNTS, useAuth, type SeedAccountPreset } from "../context/AuthContext.tsx";
import type { UserRole } from "../types/api.ts";

export const LoginPage: React.FC = () => {
  const { login, register, quickSeedLogin } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("BIDDER");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      const loggedUser =
        mode === "login"
          ? await login(email, password)
          : await register(name, email, password, role);
      navigate(loggedUser.role === "AUCTIONEER" ? "/auctioneer" : "/");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Falha na autenticação.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSeedClick = async (preset: SeedAccountPreset) => {
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      const loggedUser = await quickSeedLogin(preset);
      navigate(loggedUser.role === "AUCTIONEER" ? "/auctioneer" : "/");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Falha ao autenticar conta de demonstração.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-[960px] px-4 py-10 sm:px-6">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
        <section className="md:col-span-5 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6">
          <h1 className="font-sans text-xl font-semibold text-paper-text dark:text-charcoal-text">
            Contas de demonstração
          </h1>
          <p className="mt-2 text-sm text-paper-subtext dark:text-charcoal-subtext">
            Entre com 1 clique em qualquer perfil pré-configurado para testar lances, carteira ou painel do leiloeiro.
          </p>

          <div className="mt-5 space-y-3">
            {SEED_ACCOUNTS.map((preset) => (
              <button
                key={preset.email}
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleSeedClick(preset)}
                className="flex w-full items-center justify-between rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-4 py-3 text-left transition-colors hover:border-primary"
              >
                <div>
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-primary">
                    {preset.roleLabel}
                  </span>
                  <span className="mt-0.5 block font-medium text-paper-text dark:text-charcoal-text">
                    {preset.label}
                  </span>
                  <span className="font-mono text-xs text-paper-subtext dark:text-charcoal-subtext">
                    {preset.email}
                  </span>
                </div>
                <span className="text-xs font-semibold text-paper-text dark:text-charcoal-text">
                  Entrar
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="md:col-span-7 rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface p-6">
          <div className="flex border-b border-paper-border dark:border-charcoal-border pb-4 gap-2">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded-sm border px-4 py-1.5 text-xs font-medium ${
                mode === "login"
                  ? "border-paper-text bg-paper-text text-paper-surface dark:border-charcoal-text dark:bg-charcoal-text dark:text-charcoal-bg"
                  : "border-paper-border text-paper-subtext dark:border-charcoal-border dark:text-charcoal-subtext"
              }`}
            >
              Entrar com e-mail
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`rounded-sm border px-4 py-1.5 text-xs font-medium ${
                mode === "register"
                  ? "border-paper-text bg-paper-text text-paper-surface dark:border-charcoal-text dark:bg-charcoal-text dark:text-charcoal-bg"
                  : "border-paper-border text-paper-subtext dark:border-charcoal-border dark:text-charcoal-subtext"
              }`}
            >
              Criar conta
            </button>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="mt-4 rounded-sm border border-status-outbid bg-status-outbid/10 px-4 py-3 text-sm text-status-outbid"
            >
              {errorMsg}
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
            {mode === "register" && (
              <div>
                <label className="block text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
                  Nome completo (exibido de forma mascarada em público)
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Carlos Eduardo"
                  className="mt-1.5 h-[42px] w-full rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3.5 text-sm"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
                E-mail
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nicolas@verzel.com.br"
                className="mt-1.5 h-[42px] w-full rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
                Senha
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo de 6 caracteres"
                className="mt-1.5 h-[42px] w-full rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3.5 text-sm"
              />
            </div>

            {mode === "register" && (
              <div>
                <label className="block text-xs font-medium text-paper-subtext dark:text-charcoal-subtext">
                  Tipo de conta
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="mt-1.5 h-[42px] w-full rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-3.5 text-sm"
                >
                  <option value="BIDDER">Licitante (Comprador)</option>
                  <option value="AUCTIONEER">Leiloeiro (Publicador de lotes)</option>
                </select>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-sm border border-primary bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {isSubmitting
                ? "Processando..."
                : mode === "login"
                  ? "Entrar"
                  : "Criar conta"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
};
