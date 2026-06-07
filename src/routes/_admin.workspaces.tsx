import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const ws = [
  { name: "user-alice", used: 1.2, quota: 5 },
  { name: "user-bob", used: 4.1, quota: 5 },
  { name: "user-carol", used: 0.4, quota: 5 },
  { name: "shared-marketing", used: 18, quota: 50 },
  { name: "shared-engineering", used: 42, quota: 100 },
];

export const Route = createFileRoute("/_admin/workspaces")({
  component: () => (
    <>
      <PageHeader title="Workspaces" description="Per-user and shared, with POSIX quotas." />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {ws.map((w) => {
          const pct = (w.used / w.quota) * 100;
          return (
            <Card key={w.name}>
              <CardContent className="p-4">
                <div className="flex justify-between mb-2">
                  <span className="font-medium">{w.name}</span>
                  <span className="text-xs text-muted-foreground">{w.used} / {w.quota} GB</span>
                </div>
                <Progress value={pct} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  ),
});
