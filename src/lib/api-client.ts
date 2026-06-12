// REST API client for SecureWorkspaceHub backend.
// Tokens: short-lived JWT access + rotating opaque refresh token.
const BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export type ApiError = { status: number; message: string };

const ACCESS_KEY = "auth_token";
const REFRESH_KEY = "auth_refresh";

export const tokenStore = {
  getAccess: () => (typeof localStorage !== "undefined" ? localStorage.getItem(ACCESS_KEY) : null),
  getRefresh: () => (typeof localStorage !== "undefined" ? localStorage.getItem(REFRESH_KEY) : null),
  set: (access: string, refresh: string) => {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

// ── refresh coordination (single-flight) ──
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const refresh = tokenStore.getRefresh();
  if (!refresh) return false;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) {
        tokenStore.clear();
        return false;
      }
      const data = await res.json();
      tokenStore.set(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = tokenStore.getAccess();
  const headers = {
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${BASE}${path}`, { headers, ...init });

  if (res.status === 401 && retry && tokenStore.getRefresh() && !path.startsWith("/auth/")) {
    const ok = await tryRefresh();
    if (ok) return request<T>(path, init, false);
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.message ?? message;
    } catch {
      try { message = await res.text(); } catch { /* keep statusText */ }
    }
    throw { status: res.status, message } as ApiError;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(p: string) => request<T>(p, { method: "DELETE" }),
};

// ---- Domain types ----
export type User = {
  id: number;
  email: string;
  username: string;
  roles: ("admin" | "auditor" | "user")[];
  mfaEnabled: boolean;
  status: "active" | "disabled" | "locked";
};

export type Workspace = {
  id: number;
  name: string;
  isShared: boolean;
  quotaBytes: number;
  usedBytes: number;
};

export type FileNode = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mime?: string;
  updatedAt: string;
  sha256?: string;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type LoginResult =
  | { mfaRequired: true; txId: string }
  | ({ mfaRequired: false; user: User } & TokenPair);

export const auth = {
  login: (email: string, password: string) =>
    api.post<LoginResult>("/auth/login", { email, password }),
  loginMfa: (txId: string, code: string) =>
    api.post<{ user: User } & TokenPair>("/auth/login/mfa", { txId, code }),
  logout: () =>
    api.post<{ ok: true }>("/auth/logout", { refreshToken: tokenStore.getRefresh() }),
  me: () => api.get<User>("/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: true }>("/auth/password", { currentPassword, newPassword }),
  mfa: {
    enroll: () =>
      api.post<{ secret: string; otpauthUri: string; qrDataUrl: string }>("/auth/mfa/enroll"),
    confirm: (code: string) => api.post<{ mfaEnabled: true }>("/auth/mfa/confirm", { code }),
    disable: (password: string, code?: string) =>
      api.post<{ mfaEnabled: false }>("/auth/mfa/disable", { password, code }),
  },
};

export const workspaces = {
  list: () => api.get<Workspace[]>("/workspaces"),
  tree: (id: number, path = "/") =>
    api.get<FileNode[]>(`/workspaces/${id}/tree?path=${encodeURIComponent(path)}`),
  mkdir: (id: number, path: string) =>
    api.post<FileNode>(`/workspaces/${id}/folders`, { path }),
  rename: (id: number, from: string, to: string) =>
    api.patch<FileNode>(`/workspaces/${id}/files/${encodeURIComponent(from)}`, { to }),
  remove: (id: number, path: string) =>
    api.del<void>(`/workspaces/${id}/files/${encodeURIComponent(path)}`),
  uploadFile: async (id: number, file: File, path = "/") => {
    const token = tokenStore.getAccess();
    const fd = new FormData();
    fd.append("file", file);
    if (path) fd.append("path", path);
    const res = await fetch(`${BASE}/workspaces/${id}/upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) {
      const message = await res.text().catch(() => res.statusText);
      throw { status: res.status, message } as ApiError;
    }
    return (await res.json()) as FileNode;
  },
};

export const admin = {
  listUsers: () => api.get<User[]>("/admin/users"),
  createUser: (input: { email: string; username: string; password: string; role: string }) =>
    api.post<User>("/admin/users", input),
  setStatus: (id: number, status: User["status"]) =>
    api.patch<User>(`/admin/users/${id}`, { status }),
  unlock: (id: number) => api.post<{ ok: true }>(`/admin/users/${id}/unlock`),
  audit: (params: { from?: string; to?: string } = {}) =>
    api.get<{ ts: string; actor: string; action: string; target: string; ip: string }[]>(
      `/admin/audit?${new URLSearchParams(params as Record<string, string>)}`,
    ),
};
