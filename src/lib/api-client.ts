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

// ── Live file editing (concurrent read/write on the server) ──
export type FileContent = {
  path: string;
  name: string;
  content: string;
  sha256?: string;
  size: number;
  mime?: string;
  updatedAt: string;
};
export type SaveResult = {
  path: string;
  name: string;
  sha256: string;
  size: number;
  updatedAt: string;
  conflict?: boolean;
};
export type PresenceUser = { id: number; username: string };

// Mock mode mirrors src/lib/auth-context.tsx so the Lovable preview works
// without a running Express API. In mock, content is persisted to localStorage.
const MOCK_EDIT = import.meta.env.VITE_MOCK_AUTH !== "0";
const mockFileKey = (wsId: number, p: string) => `mock:file:${wsId}:${p}`;
const mockPresKey = (wsId: number, p: string) => `mock:presence:${wsId}:${p}`;

async function sha256Hex(text: string) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return String(text.length);
}

export const files = {
  read: async (workspaceId: number, path: string): Promise<FileContent> => {
    if (MOCK_EDIT) {
      const content = localStorage.getItem(mockFileKey(workspaceId, path)) ?? "";
      return {
        path,
        name: path.split("/").pop() ?? path,
        content,
        sha256: await sha256Hex(content),
        size: new Blob([content]).size,
        mime: "text/plain",
        updatedAt: new Date().toISOString(),
      };
    }
    return api.get<FileContent>(`/workspaces/${workspaceId}/file?path=${encodeURIComponent(path)}`);
  },
  save: async (workspaceId: number, path: string, content: string, baseSha256?: string): Promise<SaveResult> => {
    if (MOCK_EDIT) {
      localStorage.setItem(mockFileKey(workspaceId, path), content);
      return {
        path,
        name: path.split("/").pop() ?? path,
        sha256: await sha256Hex(content),
        size: new Blob([content]).size,
        updatedAt: new Date().toISOString(),
        conflict: false,
      };
    }
    const token = tokenStore.getAccess();
    const res = await fetch(`${BASE}/workspaces/${workspaceId}/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ path, content, baseSha256 }),
    });
    if (!res.ok) {
      const message = await res.text().catch(() => res.statusText);
      throw { status: res.status, message } as ApiError;
    }
    return (await res.json()) as SaveResult;
  },
  heartbeat: async (workspaceId: number, path: string, username: string) => {
    if (MOCK_EDIT) {
      const key = mockPresKey(workspaceId, path);
      const now = Date.now();
      const raw = localStorage.getItem(key);
      const map: Record<string, { username: string; ts: number }> = raw ? JSON.parse(raw) : {};
      map[username] = { username, ts: now };
      for (const k of Object.keys(map)) if (now - map[k].ts > 15_000) delete map[k];
      localStorage.setItem(key, JSON.stringify(map));
      return;
    }
    await api.post(`/workspaces/${workspaceId}/presence`, { path });
  },
  presence: async (workspaceId: number, path: string): Promise<PresenceUser[]> => {
    if (MOCK_EDIT) {
      const raw = localStorage.getItem(mockPresKey(workspaceId, path));
      if (!raw) return [];
      const map = JSON.parse(raw) as Record<string, { username: string; ts: number }>;
      const now = Date.now();
      return Object.values(map)
        .filter((e) => now - e.ts < 15_000)
        .map((e, i) => ({ id: i + 1, username: e.username }));
    }
    const res = await api.get<{ users: PresenceUser[] }>(`/workspaces/${workspaceId}/presence?path=${encodeURIComponent(path)}`);
    return res.users;
  },
  leave: async (workspaceId: number, path: string) => {
    if (MOCK_EDIT) return;
    try { await api.del(`/workspaces/${workspaceId}/presence?path=${encodeURIComponent(path)}`); } catch { /* ignore */ }
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
