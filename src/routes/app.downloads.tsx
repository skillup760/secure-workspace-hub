import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/app/downloads")({
  component: () => (
    <>
      <PageHeader title="Downloads" description="Resumable transfers with Range support." />
      <div className="text-sm text-muted-foreground">No active downloads.</div>
    </>
  ),
});
