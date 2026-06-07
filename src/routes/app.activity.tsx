import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/app/activity")({
  component: () => (
    <>
      <PageHeader title="Activity history" description="Your last 30 days of file events." />
      <div className="text-sm text-muted-foreground">Activity feed will stream here.</div>
    </>
  ),
});
