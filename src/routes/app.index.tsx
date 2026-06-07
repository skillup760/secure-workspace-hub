import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { HardDrive, Upload, Download, Activity } from "lucide-react";
import { useRealtime } from "@/lib/ws-client";
import { useState } from "react";

export const Route = createFileRoute("/app/")({
  component: UserDashboard,
});

function UserDashboard() {
  const [recent, setRecent] = useState<{ ts: string; action: string; target: string }[]>([
    { ts: "2 min ago", action: "UPLOAD", target: "/reports/Q4.pdf" },
    { ts: "14 min ago", action: "DOWNLOAD", target: "/shared/specs.zip" },
    { ts: "1 hr ago", action: "RENAME", target: "/drafts/notes.md" },
  ]);
  useRealtime("audit", (ev) =>
    setRecent((r) => [{ ts: "now", action: ev.action, target: ev.target }, ...r].slice(0, 10)),
  );

  const used = 3.4;
  const quota = 5;
  const pct = (used / quota) * 100;

  return (
    <>
      <PageHeader
        title="Welcome back"
        description="Your workspace at a glance. All transfers are encrypted and audited."
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Storage used" value={`${used} / ${quota} GB`} icon={HardDrive} hint={`${pct.toFixed(0)}% of quota`} />
        <StatCard label="Uploads today" value={12} icon={Upload} hint="+3 vs yesterday" />
        <StatCard label="Downloads today" value={47} icon={Download} hint="Across 3 workspaces" />
        <StatCard label="Active sessions" value={2} icon={Activity} hint="Pi-LAN, WG-mobile" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Storage quota</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={pct} />
            <div className="mt-2 text-sm text-muted-foreground">
              {used} GB used of {quota} GB. Contact your admin to request more.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {recent.map((r, i) => (
                <li key={i} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">{r.action}</span>
                    <span className="text-muted-foreground truncate">{r.target}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{r.ts}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
