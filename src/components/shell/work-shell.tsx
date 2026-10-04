"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Building2, Camera, Clapperboard, ListChecks, Receipt, Send, Sun } from "lucide-react";
import { Logo, LogoMark } from "@/components/brand/logo";
import { NotificationsButton } from "@/components/shell/notifications-button";
import { isActive, type NavItem, type ShellUser } from "@/components/shell/types";
import { UserMenu, type WorkspaceLink } from "@/components/shell/user-menu";
import { cn } from "@/lib/utils";

const NAV: NavItem[] = [
  { href: "/work", label: "My Day", icon: Sun, exact: true },
  { href: "/work/tasks", label: "Tasks", icon: ListChecks },
  { href: "/work/content", label: "Content", icon: Clapperboard },
  { href: "/work/to-post", label: "Ready to Post", shortLabel: "To Post", icon: Send },
  { href: "/work/expenses", label: "Expenses", icon: Receipt },
];
const INBOX: NavItem = { href: "/work/inbox", label: "Notifications", icon: Bell };
/** Desktop sidebar only; on phones My brands is reached from My Day. */
const BRANDS: NavItem = { href: "/work/brands", label: "My brands", icon: Building2 };
/** Desktop sidebar only; on phones My shoots is reached from My Day. */
const SHOOTS: NavItem = { href: "/work/shoots", label: "My shoots", icon: Camera };

/**
 * Staff workspace — designed phone-first (employees use it on the move):
 *  · < 1024px: sticky top bar + bottom tab bar in the thumb zone
 *  · ≥ 1024px: calm left sidebar, centred reading width
 */
export function WorkShell({
  user,
  switchTo,
  unread,
  children,
}: {
  user: ShellUser;
  /** Server-derived unread notification count at render time. */
  unread: number;
  switchTo?: WorkspaceLink[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const current = [...NAV, SHOOTS, BRANDS, INBOX].find((i) => isActive(pathname, i));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center px-4">
          <Link
            href="/work"
            className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Logo />
          </Link>
        </div>
        <nav aria-label="Primary" className="flex-1 overflow-y-auto px-2 py-2">
          <ul className="flex flex-col gap-0.5">
            {[...NAV, SHOOTS, BRANDS, INBOX].map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50",
                      active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                    )}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="absolute top-2 bottom-2 -left-2 w-0.5 rounded-full bg-brand"
                      />
                    )}
                    <item.icon className="size-4" strokeWidth={1.75} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t p-2">
          <UserMenu user={user} variant="row" align="start" side="top" switchTo={switchTo} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Top bar */}
        <header className="pt-safe sticky top-0 z-30 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <div className="flex h-14 items-center gap-3 px-4 lg:px-8">
            <Link href="/work" className="rounded-md lg:hidden" aria-label="PhotoXo home">
              <LogoMark />
            </Link>
            <p className="min-w-0 truncate text-[15px] font-semibold tracking-tight lg:text-sm lg:font-medium">
              {current?.label ?? "PhotoXo"}
            </p>
            <div className="ml-auto flex items-center gap-1">
              <NotificationsButton key={unread} inboxHref={INBOX.href} initialUnread={unread} />
              <div className="lg:hidden">
                <UserMenu user={user} switchTo={switchTo} />
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl min-w-0 flex-1 px-4 pt-5 pb-[calc(var(--spacing-bottomnav)+env(safe-area-inset-bottom)+1.5rem)] sm:px-6 lg:px-8 lg:pt-8 lg:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile / tablet bottom navigation */}
      <nav
        aria-label="Primary"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 lg:hidden"
      >
        <ul className="mx-auto grid h-(--spacing-bottomnav) max-w-xl grid-cols-5">
          {NAV.map((item) => {
            const active = isActive(pathname, item);
            return (
              <li key={item.href} className="min-w-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground outline-none focus-visible:bg-accent",
                    active && "text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                      active && "bg-accent",
                    )}
                  >
                    <item.icon className="size-5" strokeWidth={active ? 2 : 1.75} />
                  </span>
                  <span className="max-w-full truncate px-0.5">
                    {item.shortLabel ?? item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
