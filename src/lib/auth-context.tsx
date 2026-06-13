import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { auth, tokenStore, type User } from "./api-client";

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean; txId?: string }>;
  loginMfa: (txId: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

// Mock auth is ON by default so the Lovable preview works without the local
// Express API on :4000. Set VITE_MOCK_AUTH=0 in real deployments to hit the real API.
const MOCK = import.meta.env.VITE_MOCK_AUTH !== "0";

const mockUser: User = {
  id: 1,
  email: "admin@example.com",
  username: "admin",
  roles: ["admin", "auditor"],
  mfaEnabled: true,
  status: "active",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      if (MOCK) {
        const stored = localStorage.getItem("mock_user");
        setUser(stored ? JSON.parse(stored) : null);
      } else if (tokenStore.getAccess() || tokenStore.getRefresh()) {
        setUser(await auth.me());
      } else {
        setUser(null);
      }
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const value: AuthState = {
    user,
    loading,
    login: async (email, password) => {
      if (MOCK) {
        if (password.length < 4) throw { status: 401, message: "Invalid credentials" };
        return { mfaRequired: true, txId: "mock-tx" };
      }
      const result = await auth.login(email, password);
      if (result.mfaRequired) {
        return { mfaRequired: true, txId: result.txId };
      }
      tokenStore.set(result.accessToken, result.refreshToken);
      setUser(result.user);
      return { mfaRequired: false };
    },
    loginMfa: async (txId, code) => {
      if (MOCK) {
        if (code !== "123456") throw { status: 401, message: "Invalid code (use 123456)" };
        localStorage.setItem("mock_user", JSON.stringify(mockUser));
        setUser(mockUser);
        return;
      }
      const result = await auth.loginMfa(txId, code);
      tokenStore.set(result.accessToken, result.refreshToken);
      setUser(result.user);
    },
    logout: async () => {
      if (MOCK) {
        localStorage.removeItem("mock_user");
      } else {
        try { await auth.logout(); } catch { /* ignore */ }
        tokenStore.clear();
      }
      setUser(null);
    },
    refresh,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
