import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/lib/auth-context";
import { usePresence } from "@/lib/ws-client";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center gap-3 border-b px-3">
            <SidebarTrigger />
            <div className="flex-1" />
            <PresenceBadge />
          </header>
          <main className="flex-1 p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function PresenceBadge() {
  const users = usePresence();
  return (
    <Badge variant="secondary" className="gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {users.length} online
    </Badge>
  );
}
