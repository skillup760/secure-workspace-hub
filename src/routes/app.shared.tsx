import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/app/shared")({
  component: () => (
    <>
      <PageHeader title="Shared folders" description="Project workspaces you have ACL access to." />
      <div className="text-sm text-muted-foreground">No shared folders assigned yet.</div>
    </>
  ),
});
