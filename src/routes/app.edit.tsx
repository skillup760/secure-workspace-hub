import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, Users, CheckCircle2, AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";
import { files as filesApi, type PresenceUser } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

type Search = { ws?: number; path?: string };

export const Route = createFileRoute("/app/edit")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ws: s.ws ? Number(s.ws) : 1,
    path: typeof s.path === "string" ? s.path : "/untitled.txt",
  }),
  component: EditPage,
});

function EditPage() {
  const { ws = 1, path = "/untitled.txt" } = Route.useSearch();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [content, setContent] = useState("");
  const [baseSha, setBaseSha] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceUser[]>([]);

  const dirtyRef = useRef(false);
  const contentRef = useRef("");
  const baseShaRef = useRef<string | undefined>(undefined);
  const saveTimer = useRef<number | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await filesApi.read(ws, path);
        if (cancelled) return;
        setContent(data.content);
        contentRef.current = data.content;
        setBaseSha(data.sha256);
        baseShaRef.current = data.sha256;
      } catch (err) {
        toast.error((err as { message?: string })?.message ?? "Failed to open file");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ws, path]);

  // Presence heartbeat + poll
  useEffect(() => {
    if (!user) return;
    let stopped = false;
    const tick = async () => {
      try {
        await filesApi.heartbeat(ws, path, user.username);
        const list = await filesApi.presence(ws, path);
        if (!stopped) setPresence(list);
      } catch { /* ignore */ }
    };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => {
      stopped = true;
      window.clearInterval(id);
      filesApi.leave(ws, path);
    };
  }, [ws, path, user]);

  const doSave = useCallback(async () => {
    if (!dirtyRef.current || saving) return;
    setSaving(true);
    const snapshot = contentRef.current;
    try {
      const result = await filesApi.save(ws, path, snapshot, baseShaRef.current);
      setBaseSha(result.sha256);
      baseShaRef.current = result.sha256;
      setSavedAt(result.updatedAt);
      if (contentRef.current === snapshot) {
        dirtyRef.current = false;
        setDirty(false);
      }
      if (result.conflict) toast.warning("Saved, but the file changed on the server. Your version overwrote it.");
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }, [ws, path, saving]);

  // Debounced autosave
  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void doSave(); }, 1200);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [content, dirty, doSave]);

  // Save on unmount if dirty
  useEffect(() => () => { if (dirtyRef.current) void doSave(); }, [doSave]);

  const onChange = (v: string) => {
    setContent(v);
    contentRef.current = v;
    if (!dirtyRef.current) { dirtyRef.current = true; setDirty(true); }
  };

  const others = presence.filter((p) => p.username !== user?.username);

  return (
    <>
      <PageHeader
        title={path.split("/").pop() || path}
        description={`Workspace #${ws} · ${path}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate({ to: "/app/workspace" })}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />Back
            </Button>
            <Button size="sm" onClick={() => doSave()} disabled={!dirty || saving}>
              <Save className="h-4 w-4 mr-1.5" />{saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
        <Badge variant="secondary" className="gap-1.5">
          <Users className="h-3 w-3" />
          {presence.length} viewing {others.length > 0 && `· ${others.map((o) => o.username).join(", ")}`}
        </Badge>
        {dirty ? (
          <Badge variant="outline" className="gap-1.5 text-amber-600 border-amber-300">
            <AlertTriangle className="h-3 w-3" /> Unsaved
          </Badge>
        ) : savedAt ? (
          <Badge variant="outline" className="gap-1.5 text-emerald-600 border-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> Saved {new Date(savedAt).toLocaleTimeString()}
          </Badge>
        ) : null}
        <span className="text-muted-foreground ml-auto">
          {content.length.toLocaleString()} chars · {content.split("\n").length} lines
        </span>
      </div>

      <Textarea
        value={loading ? "Loading…" : content}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        spellCheck={false}
        className="font-mono text-sm min-h-[60vh] resize-y leading-relaxed"
        placeholder="Start typing — changes autosave every second."
      />

      <p className="text-xs text-muted-foreground mt-3">
        Autosave is enabled. Last-write-wins: if another collaborator saves while you edit, your next save will overwrite theirs (you'll see a warning).{" "}
        <Link to="/app/workspace" className="underline">Back to workspace</Link>
      </p>
    </>
  );
}
