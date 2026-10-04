"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleCheckBig, Clapperboard, Library } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { isActive, type NavItem, type ShellUser } from "@/components/shell/types";
import { NotificationsButton } from "@/components/shell/notifications-button";
import { UserMenu } from "@/components/shell/user-menu";
import { cn } from "@/lib/utils";

const NAV: NavItem[] = [
  { href: "/client/approvals", label: "Approvals", icon: CircleCheckBig },
  { href: "/client/content", label: "Content", icon: Clapperboard },
  { href: "/client/library", label: "Library", icon: Library },
];

/**
 * Client workspace: intentionally minimal. No internal navigation, people,
 * or operational information ever appears here.
 */
export function ClientShell({ user, unread, children }: { user: ShellUser; unread: number; children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh bg-background">
      <header className="pt-safe sticky top-0 z-30 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4 sm:px-6">
          <Link
            href="/client"
            className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Logo />
          </Link>
          <nav aria-label="Primary" className="hidden h-full md:block">
            <ul className="flex h-full items-stretch gap-1">
              {NAV.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <li key={item.href} className="flex">
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative inline-flex items-center px-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground",
                        active &&
                          "font-medium text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <NotificationsButton key={unread} inboxHref="/client/notifications" initialUnread={unread} />
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl min-w-0 px-4 pt-6 pb-[calc(var(--spacing-bottomnav)+env(safe-area-inset-bottom)+1.5rem)] sm:px-6 md:pt-10 md:pb-12">
        {children}
      </main>

      <nav
        aria-label="Primary"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden"
      >
        <ul className="grid h-(--spacing-bottomnav) grid-cols-3">
          {NAV.map((item) => {
            const active = isActive(pathname, item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground",
                    active && "text-foreground",
                  )}
                >
                  <item.icon className="size-5" strokeWidth={active ? 2 : 1.75} />
                  {item.shortLabel ?? item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
