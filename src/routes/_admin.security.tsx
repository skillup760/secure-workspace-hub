import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { ShieldAlert, Lock, Ban, Activity } from "lucide-react";

export const Route = createFileRoute("/_admin/security")({
  component: () => (
    <>
      <PageHeader title="Security events" description="Fail2Ban, CrowdSec, and app-level signals." />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Failed logins (1h)" value={3} icon={Lock} />
        <StatCard label="IPs banned" value={12} icon={Ban} />
        <StatCard label="GeoIP blocks 24h" value={47} icon={ShieldAlert} />
        <StatCard label="ClamAV detections" value={0} icon={Activity} hint="last 7 days" />
      </div>
    </>
  ),
});
