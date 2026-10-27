import type {
  AuctioneerDashboard,
  AuditChain,
  Bid,
  BidderBidsAndWins,
  CatalogItem,
  Lot,
  LotCreatePayload,
  PublicReceipt,
  TokenResponse,
  User,
  UserRole,
  Wallet,
  WalletTransaction,
} from "../types/api.ts";

const RAW_API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") || "";
const API_BASE = `${RAW_API_URL}/api/v1`;
const TOKEN_STORAGE_KEY = "verzel_token";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetail = `Erro HTTP ${response.status}`;
    try {
      const errBody = await response.json();
      if (typeof errBody?.detail === "string") {
        errorDetail = errBody.detail;
      } else if (Array.isArray(errBody?.detail)) {
        errorDetail = errBody.detail.map((d: { msg?: string }) => d.msg).join("; ");
      }
    } catch {
    }
    throw new Error(errorDetail);
  }

  return (await response.json()) as T;
}

export const authApi = {
  login(email: string, password: string): Promise<TokenResponse> {
    return apiRequest<TokenResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  register(
    name: string,
    email: string,
    password: string,
    role: UserRole,
  ): Promise<TokenResponse> {
    return apiRequest<TokenResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password, role }),
    });
  },

  me(): Promise<User> {
    return apiRequest<User>("/auth/me");
  },
};

export const walletApi = {
  getMe(): Promise<Wallet> {
    return apiRequest<Wallet>("/wallets/me");
  },

  deposit(amountCents: number): Promise<Wallet> {
    return apiRequest<Wallet>("/wallets/deposit", {
      method: "POST",
      body: JSON.stringify({ amount_cents: amountCents }),
    });
  },

  listTransactions(): Promise<WalletTransaction[]> {
    return apiRequest<WalletTransaction[]>("/wallets/transactions");
  },
};

export const catalogApi = {
  search(query?: string, skip: number = 0, limit: number = 8): Promise<CatalogItem[]> {
    const params = new URLSearchParams();
    if (query?.trim()) {
      params.set("q", query.trim());
    }
    if (skip > 0) {
      params.set("skip", String(skip));
    }
    if (limit > 0) {
      params.set("limit", String(limit));
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    return apiRequest<CatalogItem[]>(`/catalog${qs}`);
  },
};

export const lotsApi = {
  listPublic(statusFilter?: string, queryText?: string): Promise<Lot[]> {
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== "ALL") {
      params.set("status", statusFilter);
    }
    if (queryText && queryText.trim()) {
      params.set("q", queryText.trim());
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    return apiRequest<Lot[]>(`/lots${qs}`);
  },

  getById(lotId: string): Promise<Lot> {
    return apiRequest<Lot>(`/lots/${lotId}`);
  },

  create(payload: LotCreatePayload): Promise<Lot> {
    return apiRequest<Lot>("/lots", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  cancel(lotId: string): Promise<Lot> {
    return apiRequest<Lot>(`/lots/${lotId}/cancel`, {
      method: "POST",
    });
  },

  placeBid(lotId: string, amountCents: number): Promise<Bid> {
    return apiRequest<Bid>(`/lots/${lotId}/bids`, {
      method: "POST",
      body: JSON.stringify({ amount_cents: amountCents }),
    });
  },

  getAuditChain(lotId: string): Promise<AuditChain> {
    return apiRequest<AuditChain>(`/lots/${lotId}/audit`);
  },
};

export const settlementApi = {
  getPublicReceipt(receiptCode: string): Promise<PublicReceipt> {
    return apiRequest<PublicReceipt>(`/receipts/${encodeURIComponent(receiptCode)}`);
  },

  getMyBidsAndWins(): Promise<BidderBidsAndWins> {
    return apiRequest<BidderBidsAndWins>("/me/bids-and-wins");
  },

  getAuctioneerDashboard(): Promise<AuctioneerDashboard> {
    return apiRequest<AuctioneerDashboard>("/auctioneer/dashboard");
  },
};
