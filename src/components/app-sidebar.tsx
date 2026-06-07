import { Link, useRouterState } from "@tanstack/react-router";
import {
  FolderTree,
  LayoutDashboard,
  Upload,
  Download,
  Users,
  Activity,
  ShieldAlert,
  Network,
  HardDrive,
  ScrollText,
  Settings,
  LogOut,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";

const userNav = [
  { title: "Dashboard", url: "/app", icon: LayoutDashboard },
  { title: "My Workspace", url: "/app/workspace", icon: FolderTree },
  { title: "Shared", url: "/app/shared", icon: Network },
  { title: "Upload Center", url: "/app/upload", icon: Upload },
  { title: "Downloads", url: "/app/downloads", icon: Download },
  { title: "Activity", url: "/app/activity", icon: Activity },
  { title: "Settings", url: "/app/settings", icon: Settings },
];

const adminNav = [
  { title: "Overview", url: "/admin", icon: LayoutDashboard },
  { title: "Users", url: "/admin/users", icon: Users },
  { title: "Workspaces", url: "/admin/workspaces", icon: HardDrive },
  { title: "Transfers", url: "/admin/transfers", icon: Activity },
  { title: "Security", url: "/admin/security", icon: ShieldAlert },
  { title: "VPN", url: "/admin/vpn", icon: Network },
  { title: "Audit Logs", url: "/admin/audit", icon: ScrollText },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { user, logout } = useAuth();
  const isActive = (p: string) => pathname === p || pathname.startsWith(p + "/");
  const isAdmin = user?.roles.includes("admin");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground grid place-items-center font-bold">
            S
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold leading-none">SecureShare</span>
              <span className="text-xs text-muted-foreground">Zero-Trust File Hub</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {userNav.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNav.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="h-8 w-8 rounded-full bg-muted grid place-items-center text-xs font-semibold">
            {user?.username.slice(0, 2).toUpperCase() ?? "?"}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{user?.username}</div>
              <div className="text-xs text-muted-foreground truncate">
                {user?.roles.join(", ")}
              </div>
            </div>
          )}
          {!collapsed && (
            <Button variant="ghost" size="icon" onClick={() => logout()} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
