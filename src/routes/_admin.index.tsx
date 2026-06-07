import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, HardDrive, Activity, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_admin/")({
  component: AdminOverview,
});

function AdminOverview() {
  return (
    <>
      <PageHeader title="System Overview" description="Real-time health, transfers, and security posture." />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total users" value={28} icon={Users} hint="3 disabled" />
        <StatCard label="Storage used" value="142 GB" icon={HardDrive} hint="of 500 GB" />
        <StatCard label="Active transfers" value={7} icon={Activity} hint="4 uploads, 3 downloads" />
        <StatCard label="Security events 24h" value={2} icon={ShieldAlert} hint="1 lockout, 1 GeoIP block" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">System health</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <Row label="CPU temp" value="52°C" />
            <Row label="Load avg" value="0.74" />
            <Row label="Disk I/O" value="14 MB/s" />
            <Row label="ClamAV signatures" value="Fresh (3h ago)" />
            <Row label="SSL cert" value="89 days remaining" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">VPN status</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <Row label="WireGuard interface" value="wg0 up" />
            <Row label="Connected peers" value="12 / 28" />
            <Row label="Last handshake" value="14s ago" />
            <Row label="Throughput" value="↑ 1.2 MB/s · ↓ 4.8 MB/s" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b last:border-0 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
