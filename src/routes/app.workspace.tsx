import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Folder, FileText, MoreVertical, Search, Upload, FolderPlus, FilePlus } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { workspaces } from "@/lib/api-client";
import { toast } from "sonner";

type Node = { name: string; isDir: boolean; size: string; updated: string; path: string };

export const Route = createFileRoute("/app/workspace")({
  component: WorkspacePage,
});

function WorkspacePage() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  // Fetch files from backend on mount
  useEffect(() => {
    (async () => {
      try {
        const files = await workspaces.tree(1, "/");
        const nodes = files.map((f) => ({
          name: f.name,
          path: f.path,
          isDir: f.isDir,
          size: f.isDir ? "—" : `${(f.size / 1024).toFixed(1)} KB`,
          updated: new Date(f.updatedAt).toLocaleDateString(),
        }));
        setItems(nodes);
      } catch (err) {
        console.error("Failed to load workspace files:", err);
        toast.error("Failed to load files");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const itemsFiltered = items.filter((n) => n.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader
        title="My Workspace"
        description="/workspaces/user42 — fully isolated, quota-bound."
        actions={
          <>
            <Button variant="outline" size="sm"><FolderPlus className="h-4 w-4 mr-1.5" />New folder</Button>
            <input ref={inputRef} type="file" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setUploading(true);
              try {
                await workspaces.uploadFile(1, f, "/");
                // Refresh file list from backend
                const files = await workspaces.tree(1, "/");
                const nodes = files.map((file) => ({
                  name: file.name,
                  path: file.path,
                  isDir: file.isDir,
                  size: file.isDir ? "—" : `${(file.size / 1024).toFixed(1)} KB`,
                  updated: new Date(file.updatedAt).toLocaleDateString(),
                }));
                setItems(nodes);
                toast.success(`Uploaded ${f.name}`);
              } catch (err) {
                toast.error((err as any)?.message ?? 'Upload failed');
              } finally {
                setUploading(false);
                if (inputRef.current) inputRef.current.value = "";
              }
            }} />
            <Button size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
              <Upload className="h-4 w-4 mr-1.5" />{uploading ? 'Uploading…' : 'Upload'}
            </Button>
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
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  Loading files…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  No files yet. Upload one to get started.
                </TableCell>
              </TableRow>
            ) : (
              itemsFiltered.map((n) => (
                <TableRow key={n.path} className="cursor-pointer">
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
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
