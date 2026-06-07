import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { UserPlus, MoreVertical } from "lucide-react";

const users = [
  { username: "alice", email: "alice@corp.io", role: "admin", status: "active", mfa: true },
  { username: "bob", email: "bob@corp.io", role: "user", status: "active", mfa: true },
  { username: "carol", email: "carol@corp.io", role: "auditor", status: "active", mfa: true },
  { username: "dave", email: "dave@corp.io", role: "user", status: "locked", mfa: false },
];

export const Route = createFileRoute("/admin/users")({
  component: () => (
    <>
      <PageHeader
        title="Users"
        description="Create, disable, and assign roles. All actions are audited."
        actions={<Button size="sm"><UserPlus className="h-4 w-4 mr-1.5" />New user</Button>}
      />
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>MFA</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.username}>
                <TableCell>
                  <div className="font-medium">{u.username}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell><Badge variant="outline">{u.role}</Badge></TableCell>
                <TableCell>{u.mfa ? "✅" : "⚠️"}</TableCell>
                <TableCell>
                  <Badge variant={u.status === "active" ? "secondary" : "destructive"}>{u.status}</Badge>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  ),
});
