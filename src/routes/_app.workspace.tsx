import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Folder, FileText, MoreVertical, Search, Upload, FolderPlus } from "lucide-react";
import { useState } from "react";

type Node = { name: string; isDir: boolean; size: string; updated: string };

const initial: Node[] = [
  { name: "reports", isDir: true, size: "—", updated: "2h ago" },
  { name: "drafts", isDir: true, size: "—", updated: "1d ago" },
  { name: "Q4.pdf", isDir: false, size: "2.3 MB", updated: "2m ago" },
  { name: "specs.zip", isDir: false, size: "44 MB", updated: "1h ago" },
  { name: "notes.md", isDir: false, size: "12 KB", updated: "5m ago" },
];

export const Route = createFileRoute("/_app/workspace")({
  component: WorkspacePage,
});

function WorkspacePage() {
  const [q, setQ] = useState("");
  const items = initial.filter((n) => n.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader
        title="My Workspace"
        description="/workspaces/user42 — fully isolated, quota-bound."
        actions={
          <>
            <Button variant="outline" size="sm"><FolderPlus className="h-4 w-4 mr-1.5" />New folder</Button>
            <Button size="sm"><Upload className="h-4 w-4 mr-1.5" />Upload</Button>
          </>
        }
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files…" className="pl-8" />
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-32">Size</TableHead>
              <TableHead className="w-40">Updated</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((n) => (
              <TableRow key={n.name} className="cursor-pointer">
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {n.isDir ? <Folder className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                    {n.name}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{n.size}</TableCell>
                <TableCell className="text-muted-foreground">{n.updated}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
