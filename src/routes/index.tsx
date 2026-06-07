import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Shield, FolderLock, Activity, Network } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/app" />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-primary text-primary-foreground grid place-items-center font-bold text-sm">
              S
            </div>
            <span className="font-semibold">SecureShare</span>
          </div>
          <Link
            to="/login"
            className="text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Zero-Trust · Self-Hosted · TLS 1.3
          </div>
          <h1 className="text-5xl font-semibold tracking-tight leading-tight">
            Secure file sharing for your team — on hardware you control.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            Isolated workspaces, resumable transfers, MFA, WireGuard VPN, and real-time audit
            logging. Designed for Raspberry Pi 5 deployments behind WiJungle firewall.
          </p>
          <div className="mt-8 flex gap-3">
            <Link
              to="/login"
              className="inline-flex items-center px-5 py-2.5 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90"
            >
              Open dashboard
            </Link>
            <a
              href="https://docs.lovable.dev"
              className="inline-flex items-center px-5 py-2.5 rounded-md border font-medium hover:bg-accent"
            >
              Architecture docs
            </a>
          </div>
        </div>

        <div className="mt-20 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: Shield, t: "Zero-Trust Auth", d: "Argon2id + TOTP MFA, lockout, session rotation." },
            { icon: FolderLock, t: "Workspace Isolation", d: "Chrooted paths, per-user POSIX quotas." },
            { icon: Activity, t: "Real-Time", d: "WebSocket transfer progress + audit feed." },
            { icon: Network, t: "VPN-First", d: "WireGuard tunnel; admin scoped to VPN CIDR." },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="border rounded-lg p-4">
              <Icon className="h-5 w-5 text-primary mb-3" />
              <div className="font-medium">{t}</div>
              <div className="text-sm text-muted-foreground mt-1">{d}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
