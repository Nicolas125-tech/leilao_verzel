import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { authApi, getStoredToken, setStoredToken } from "../services/api.ts";
import type { User, UserRole } from "../types/api.ts";

export interface SeedAccountPreset {
  label: string;
  roleLabel: string;
  email: string;
  password: string;
  role: UserRole;
  defaultDepositCents: number;
}

export const SEED_ACCOUNTS: SeedAccountPreset[] = [
  {
    label: "Helena Curadora",
    roleLabel: "LEILOEIRA",
    email: "curador@verzel.com.br",
    password: "Verzel2026!",
    role: "AUCTIONEER",
    defaultDepositCents: 0,
  },
  {
    label: "Nicolas Brito",
    roleLabel: "LICITANTE 1",
    email: "nicolas@verzel.com.br",
    password: "Verzel2026!",
    role: "BIDDER",
    defaultDepositCents: 1500000,
  },
  {
    label: "Marina Silva",
    roleLabel: "LICITANTE 2",
    email: "marina@verzel.com.br",
    password: "Verzel2026!",
    role: "BIDDER",
    defaultDepositCents: 1200000,
  },
];

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (
    name: string,
    email: string,
    password: string,
    role: UserRole,
  ) => Promise<User>;
  quickSeedLogin: (preset: SeedAccountPreset) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadSession = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const me = await authApi.me();
      setUser(me);
    } catch {
      setStoredToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const login = async (email: string, password: string): Promise<User> => {
    const res = await authApi.login(email, password);
    setStoredToken(res.access_token);
    setUser(res.user);
    return res.user;
  };

  const register = async (
    name: string,
    email: string,
    password: string,
    role: UserRole,
  ): Promise<User> => {
    const res = await authApi.register(name, email, password, role);
    setStoredToken(res.access_token);
    setUser(res.user);
    return res.user;
  };

  const quickSeedLogin = (preset: SeedAccountPreset): Promise<User> =>
    login(preset.email, preset.password);

  const logout = () => {
    setStoredToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        register,
        quickSeedLogin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth deve ser utilizado dentro de um AuthProvider");
  }
  return ctx;
}
