import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { user, login, loginMfa } = useAuth();
  const navigate = useNavigate();
  const [stage, setStage] = useState<"creds" | "mfa">("creds");
  const [txId, setTxId] = useState("");
  const [email, setEmail] = useState("admin@secureshare.local");
  const [password, setPassword] = useState("demo1234");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/app" />;

  const submitCreds = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await login(email, password);
      if (r.mfaRequired && r.txId) {
        setTxId(r.txId);
        setStage("mfa");
        toast.info("Enter your 6-digit code (use 123456 for demo)");
      } else {
        navigate({ to: "/app" });
      }
    } catch (err) {
      toast.error((err as { message?: string }).message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const submitMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await loginMfa(txId, code);
      navigate({ to: "/app" });
    } catch (err) {
      toast.error((err as { message?: string }).message ?? "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-muted/40 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground grid place-items-center font-bold">
              S
            </div>
            <span className="font-semibold">SecureShare</span>
          </div>
          <CardTitle>{stage === "creds" ? "Sign in" : "Two-factor authentication"}</CardTitle>
          <CardDescription>
            {stage === "creds"
              ? "Use your workspace credentials. All traffic is TLS 1.3 encrypted."
              : "Enter the 6-digit code from your authenticator app."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stage === "creds" ? (
            <form onSubmit={submitCreds} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Continue
              </Button>
            </form>
          ) : (
            <form onSubmit={submitMfa} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Authentication code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <ShieldCheck className="h-4 w-4 mr-2" />
                )}
                Verify
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
