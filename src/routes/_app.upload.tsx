import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Upload as UploadIcon, X, CheckCircle2 } from "lucide-react";
import { useCallback, useState } from "react";

export const Route = createFileRoute("/_app/upload")({
  component: UploadPage,
});

type Job = { id: string; name: string; size: number; uploaded: number; done: boolean };

function UploadPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const enqueue = useCallback((files: FileList | File[]) => {
    const newJobs: Job[] = Array.from(files).map((f) => ({
      id: crypto.randomUUID(), name: f.name, size: f.size, uploaded: 0, done: false,
    }));
    setJobs((prev) => [...newJobs, ...prev]);

    // Simulated chunked upload — replace with tus-js-client wiring
    newJobs.forEach((job) => {
      const tick = setInterval(() => {
        setJobs((prev) =>
          prev.map((j) => {
            if (j.id !== job.id) return j;
            const next = Math.min(j.size, j.uploaded + j.size / 20);
            const done = next >= j.size;
            if (done) clearInterval(tick);
            return { ...j, uploaded: next, done };
          }),
        );
      }, 250);
    });
  }, []);

  return (
    <>
      <PageHeader title="Upload Center" description="Drag & drop. Resumable, chunked, SHA-256 verified." />

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); enqueue(e.dataTransfer.files); }}
        className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border"
        }`}
      >
        <UploadIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <p className="font-medium">Drop files here</p>
        <p className="text-sm text-muted-foreground mt-1">or</p>
        <label className="mt-3 inline-block">
          <input type="file" multiple className="hidden" onChange={(e) => e.target.files && enqueue(e.target.files)} />
          <Button asChild variant="outline" size="sm"><span>Browse files</span></Button>
        </label>
      </div>

      {jobs.length > 0 && (
        <Card className="mt-6">
          <CardContent className="p-0 divide-y">
            {jobs.map((j) => {
              const pct = (j.uploaded / j.size) * 100;
              return (
                <div key={j.id} className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium truncate">{j.name}</span>
                      <span className="text-muted-foreground">{(j.size / 1024).toFixed(1)} KB</span>
                    </div>
                    <Progress value={pct} />
                  </div>
                  {j.done ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <Button variant="ghost" size="icon" onClick={() => setJobs((p) => p.filter((x) => x.id !== j.id))}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </>
  );
}
