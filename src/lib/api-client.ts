// REST API client for SecureShare backend.
// Replace VITE_API_URL with your API base, e.g. https://share.example.com/api/v1
const BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export type ApiError = { status: number; message: string };

function getAuthToken() {
  return typeof localStorage !== "undefined" ? localStorage.getItem("auth_token") : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers = {
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers,
    ...init,
  });
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
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

// ---- Domain endpoints (typed stubs — wire to real backend) ----

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

export const auth = {
  login: (email: string, password: string) =>
    api.post<{ mfaRequired: boolean; txId?: string; token?: string; user?: User }>("/auth/login", { email, password }),
  loginMfa: (txId: string, code: string) =>
    api.post<{ ok: true; token: string }>("/auth/login/mfa", { txId, code }),
  logout: () => api.post<void>("/auth/logout"),
  me: () => api.get<User>("/me"),
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
    const token = getAuthToken();
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
  audit: (params: { from?: string; to?: string } = {}) =>
    api.get<{ ts: string; actor: string; action: string; target: string; ip: string }[]>(
      `/admin/audit?${new URLSearchParams(params as Record<string, string>)}`,
    ),
};
