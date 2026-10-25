import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { walletApi } from "../services/api.ts";
import type { Wallet, WalletTransaction } from "../types/api.ts";
import { useAuth } from "./AuthContext.tsx";

interface WalletContextValue {
  wallet: Wallet | null;
  transactions: WalletTransaction[];
  isLoadingWallet: boolean;
  refreshWallet: () => Promise<void>;
  deposit: (amountCents: number) => Promise<Wallet>;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const refreshWallet = useCallback(async () => {
    if (!user || user.role !== "BIDDER") {
      setWallet(null);
      setTransactions([]);
      return;
    }

    setIsSyncing(true);
    try {
      const [walletData, txData] = await Promise.all([
        walletApi.getMe(),
        walletApi.listTransactions(),
      ]);
      setWallet(walletData);
      setTransactions(txData);
    } catch (err) {
      console.warn("Sincronização de saldo indisponível:", err);
    } finally {
      setIsSyncing(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshWallet();
  }, [refreshWallet]);

  const deposit = async (amountCents: number): Promise<Wallet> => {
    const updated = await walletApi.deposit(amountCents);
    setWallet(updated);
    try {
      const txData = await walletApi.listTransactions();
      setTransactions(txData);
    } catch {
      return updated;
    }
    return updated;
  };

  return (
    <WalletContext.Provider
      value={{
        wallet,
        transactions,
        isLoadingWallet: isSyncing,
        refreshWallet,
        deposit,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet deve ser utilizado dentro de um WalletProvider");
  }
  return ctx;
}
