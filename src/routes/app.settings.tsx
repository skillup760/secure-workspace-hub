import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { user, logout } = useAuth();
  return (
    <>
      <PageHeader title="Settings" description="Account, MFA, sessions." />
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Username:</span> {user?.username}</div>
            <div><span className="text-muted-foreground">Email:</span> {user?.email}</div>
            <div><span className="text-muted-foreground">Roles:</span> {user?.roles.join(", ")}</div>
            <div><span className="text-muted-foreground">MFA:</span> {user?.mfaEnabled ? "Enabled" : "Disabled"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Session</CardTitle></CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => logout()}>Sign out everywhere</Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
