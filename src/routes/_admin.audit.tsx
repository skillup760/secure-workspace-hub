import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const log = [
  { ts: "12:04:33", actor: "alice", action: "UPLOAD", target: "/user-alice/Q4.pdf", ip: "10.66.0.10" },
  { ts: "12:02:11", actor: "bob", action: "DOWNLOAD", target: "/shared-eng/build.tar.gz", ip: "10.66.0.11" },
  { ts: "12:00:02", actor: "admin", action: "USER_CREATE", target: "user:eve", ip: "10.66.0.1" },
  { ts: "11:58:47", actor: "carol", action: "LOGIN", target: "—", ip: "10.66.0.12" },
  { ts: "11:55:01", actor: "—", action: "FAIL2BAN_BLOCK", target: "203.0.113.7", ip: "—" },
];

export const Route = createFileRoute("/_admin/audit")({
  component: () => (
    <>
      <PageHeader title="Audit logs" description="Immutable append-only event stream. Shipped to Loki." />
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Time</TableHead>
              <TableHead className="w-32">Actor</TableHead>
              <TableHead className="w-40">Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead className="w-32">IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {log.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{r.ts}</TableCell>
                <TableCell>{r.actor}</TableCell>
                <TableCell><span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{r.action}</span></TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{r.target}</TableCell>
                <TableCell className="font-mono text-xs">{r.ip}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  ),
});
