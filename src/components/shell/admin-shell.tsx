"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  Building2,
  Camera,
  Clapperboard,
  LayoutDashboard,
  ListChecks,
  Receipt,
  Send,
  Settings,
  SquareKanban,
  Users,
} from "lucide-react";
import { Logo, LogoMark } from "@/components/brand/logo";
import { NotificationsButton } from "@/components/shell/notifications-button";
import { isActive, type NavItem, type ShellUser } from "@/components/shell/types";
import { UserMenu } from "@/components/shell/user-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

interface NavGroup {
  label: string;
  items: (NavItem & { adminOnly?: boolean })[];
}

const NAV: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { href: "/admin/production", label: "Production", icon: SquareKanban },
      { href: "/admin/tasks", label: "Tasks", icon: ListChecks },
      { href: "/admin/shoots", label: "Shoots", icon: Camera },
      { href: "/admin/content", label: "Content", icon: Clapperboard },
      { href: "/admin/approvals", label: "Approvals", icon: BadgeCheck },
      { href: "/admin/ready-to-post", label: "Ready to Post", icon: Send },
    ],
  },
  {
    label: "Finance",
    items: [{ href: "/admin/expenses", label: "Expenses", icon: Receipt }],
  },
  {
    label: "Organization",
    items: [
      { href: "/admin/brands", label: "Brands", icon: Building2 },
      { href: "/admin/team", label: "Team", icon: Users, adminOnly: true },
      { href: "/admin/settings", label: "Settings", icon: Settings, adminOnly: true },
    ],
  },
];

/**
 * Collapse to the icon rail on tablet widths when the shell first mounts.
 * Uses local state directly so the automatic collapse is not persisted to the
 * sidebar cookie (a later desktop session should open expanded).
 */
function TabletAutoCollapse({ collapse }: { collapse: () => void }) {
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px) and (max-width: 1279px)").matches) collapse();
  }, [collapse]);
  return null;
}

/** Close the mobile drawer after navigating. */
function CloseMobileOnNavigate() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile]);
  return null;
}

export function AdminShell({
  user,
  canAdminister,
  defaultOpen,
  unread,
  children,
}: {
  user: ShellUser;
  /** Server-derived unread notification count at render time. */
  unread: number;
  /** Display hint only — the server enforces access on every admin-only page/action. */
  canAdminister: boolean;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(defaultOpen);
  const collapse = useCallback(() => setOpen(false), []);
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.adminOnly || canAdminister),
  }));
  const current = groups.flatMap((g) => g.items).find((i) => isActive(pathname, i));

  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <TabletAutoCollapse collapse={collapse} />
      <CloseMobileOnNavigate />
      <Sidebar collapsible="icon" variant="sidebar">
        <SidebarHeader className="h-14 justify-center px-3 group-data-[collapsible=icon]:px-2">
          <Link
            href="/admin"
            className="flex items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Logo className="group-data-[collapsible=icon]:hidden" />
            <LogoMark className="hidden group-data-[collapsible=icon]:inline-flex" />
          </Link>
        </SidebarHeader>
        <SidebarContent>
          {groups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const active = isActive(pathname, item);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.label}
                          className="relative data-[active=true]:font-medium data-[active=true]:before:absolute data-[active=true]:before:top-1.5 data-[active=true]:before:bottom-1.5 data-[active=true]:before:-left-2 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-full data-[active=true]:before:bg-brand group-data-[collapsible=icon]:data-[active=true]:before:hidden"
                        >
                          <Link href={item.href} aria-current={active ? "page" : undefined}>
                            <item.icon strokeWidth={1.75} />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="group-data-[collapsible=icon]:hidden">
          <UserMenu
            user={user}
            variant="row"
            align="start"
            side="top"
            switchTo={[{ href: "/work", label: "Open My Work" }]}
          />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 h-4 data-[orientation=vertical]:h-4" />
          <p className="min-w-0 truncate text-sm font-medium">{current?.label ?? "PhotoXo"}</p>
          <div className="ml-auto flex items-center gap-1">
            <NotificationsButton key={unread} inboxHref="/admin/inbox" initialUnread={unread} />
            <div className="md:hidden">
              <UserMenu user={user} switchTo={[{ href: "/work", label: "Open My Work" }]} />
            </div>
            {!open && (
              <div className="hidden md:block">
                <UserMenu user={user} switchTo={[{ href: "/work", label: "Open My Work" }]} />
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
