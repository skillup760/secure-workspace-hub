import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { auth, type User } from "./api-client";

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean; txId?: string }>;
  loginMfa: (txId: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

// Mock user toggle — flip to true to preview the app without a backend.
const MOCK = import.meta.env.VITE_MOCK_AUTH === "1";

const mockUser: User = {
  id: 1,
  email: "admin@secureshare.local",
  username: "admin",
  roles: ["admin"],
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
      } else {
        setUser(await auth.me());
      }
    } catch {
      localStorage.removeItem("auth_token");
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
      if (!result.mfaRequired && result.token && result.user) {
        localStorage.setItem("auth_token", result.token);
        setUser(result.user);
      }
      return result;
    },
    loginMfa: async (txId, code) => {
      if (MOCK) {
        if (code !== "123456") throw { status: 401, message: "Invalid code (use 123456)" };
        localStorage.setItem("mock_user", JSON.stringify(mockUser));
        setUser(mockUser);
        return;
      }

      const result = await auth.loginMfa(txId, code);
      localStorage.setItem("auth_token", result.token);
      await refresh();
    },
    logout: async () => {
      if (MOCK) {
        localStorage.removeItem("mock_user");
      } else {
        await auth.logout();
        localStorage.removeItem("auth_token");
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
