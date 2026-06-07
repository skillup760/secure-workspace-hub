// Lightweight WebSocket client for real-time events (upload progress, presence, file changes).
// Wire to Socket.IO or native WS at /realtime on the backend.
import { useEffect, useRef, useState } from "react";

export type RealtimeEvent =
  | { type: "upload.progress"; uploadId: string; uploaded: number; total: number }
  | { type: "file.changed"; workspaceId: number; path: string; action: "create" | "update" | "delete" }
  | { type: "presence"; users: { id: number; username: string }[] }
  | { type: "quota.warn"; workspaceId: number; usedBytes: number; quotaBytes: number }
  | { type: "audit"; ts: string; actor: string; action: string; target: string };

const WS_URL =
  import.meta.env.VITE_WS_URL ??
  (typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/realtime`
    : "");

type Listener = (ev: RealtimeEvent) => void;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private retry = 0;

  connect() {
    if (this.ws || typeof window === "undefined") return;
    try {
      this.ws = new WebSocket(WS_URL);
    } catch {
      return;
    }
    this.ws.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as RealtimeEvent;
        this.listeners.forEach((l) => l(ev));
      } catch {
        /* ignore */
      }
    };
    this.ws.onclose = () => {
      this.ws = null;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    this.ws.onopen = () => {
      this.retry = 0;
    };
  }

  on(l: Listener) {
    this.listeners.add(l);
    this.connect();
    return () => this.listeners.delete(l);
  }
}

export const realtime = new RealtimeClient();

export function useRealtime<T extends RealtimeEvent["type"]>(
  type: T,
  handler: (ev: Extract<RealtimeEvent, { type: T }>) => void,
) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const off = realtime.on((ev) => {
      if (ev.type === type) ref.current(ev as Extract<RealtimeEvent, { type: T }>);
    });
    return () => {
      off();
    };
  }, [type]);
}

export function usePresence() {
  const [users, setUsers] = useState<{ id: number; username: string }[]>([]);
  useRealtime("presence", (ev) => setUsers(ev.users));
  return users;
}
