import type { LucideIcon } from "lucide-react";
import type { SystemRole } from "@/lib/domain/roles";

/** Serializable identity passed from server layouts to client shells. Display only. */
export interface ShellUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: SystemRole;
}

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Exact match only (for workspace roots). */
  exact?: boolean;
  /** Short label for bottom navigation. */
  shortLabel?: string;
}

export function isActive(pathname: string, item: Pick<NavItem, "href" | "exact">): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
