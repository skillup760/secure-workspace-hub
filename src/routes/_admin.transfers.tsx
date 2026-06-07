import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useRealtime } from "@/lib/ws-client";
import { useState } from "react";

type Live = { id: string; user: string; file: string; pct: number; dir: "up" | "down" };

const seed: Live[] = [
  { id: "1", user: "alice", file: "Q4-report.pdf", pct: 64, dir: "up" },
  { id: "2", user: "bob", file: "build-artifacts.tar.gz", pct: 22, dir: "up" },
  { id: "3", user: "carol", file: "audit-evidence.zip", pct: 88, dir: "down" },
];

export const Route = createFileRoute("/_admin/transfers")({
  component: TransfersPage,
});

function TransfersPage() {
  const [live, setLive] = useState<Live[]>(seed);
  useRealtime("upload.progress", (ev) => {
    setLive((p) =>
      p.map((j) =>
        j.id === ev.uploadId ? { ...j, pct: (ev.uploaded / ev.total) * 100 } : j,
      ),
    );
  });

  return (
    <>
      <PageHeader title="Live transfers" description="Real-time WebSocket feed across all users." />
      <div className="space-y-3">
        {live.map((j) => (
          <Card key={j.id}>
            <CardContent className="p-4">
              <div className="flex justify-between text-sm mb-2">
                <span><span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded mr-2">{j.dir.toUpperCase()}</span><span className="font-medium">{j.user}</span> · {j.file}</span>
                <span className="text-muted-foreground">{j.pct.toFixed(0)}%</span>
              </div>
              <Progress value={j.pct} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
