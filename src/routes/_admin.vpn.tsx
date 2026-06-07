import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const peers = [
  { name: "alice-laptop", ip: "10.66.0.10", handshake: "12s", rx: "120 MB", tx: "8 MB", status: "up" },
  { name: "bob-mobile", ip: "10.66.0.11", handshake: "4m", rx: "4 MB", tx: "1 MB", status: "up" },
  { name: "carol-desk", ip: "10.66.0.12", handshake: "—", rx: "—", tx: "—", status: "down" },
];

export const Route = createFileRoute("/_admin/vpn")({
  component: () => (
    <>
      <PageHeader
        title="WireGuard VPN"
        description="Peers, handshakes, throughput."
        actions={<Button size="sm">Add peer</Button>}
      />
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Peer</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Last handshake</TableHead>
              <TableHead>RX / TX</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {peers.map((p) => (
              <TableRow key={p.name}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="font-mono text-xs">{p.ip}</TableCell>
                <TableCell>{p.handshake}</TableCell>
                <TableCell className="text-muted-foreground">{p.rx} / {p.tx}</TableCell>
                <TableCell>
                  <Badge variant={p.status === "up" ? "secondary" : "destructive"}>{p.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  ),
});
