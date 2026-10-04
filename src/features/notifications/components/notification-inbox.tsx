"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Mail, MailOpen } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import {
  markAllNotificationsReadAction,
  setNotificationPreferencesAction,
  setNotificationReadAction,
} from "@/features/notifications/actions";
import type { NotificationInboxDTO } from "@/features/notifications/types";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";


/** The signed-in user's notifications (server-paginated). Only they can change read state. */
export function NotificationInbox({
  data,
  base,
  unreadOnly,
  timeZone,
}: {
  data: NotificationInboxDTO;
  base: string;
  unreadOnly: boolean;
  /** Agency time zone — fixed locale + zone so server and browser render identical text. */
  timeZone: string;
}) {
  const when = (iso: string) => formatDate(iso, timeZone, { weekday: "short", year: undefined, hour: "numeric", minute: "2-digit" });
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });
  const href = (p: { page?: number; unread?: boolean }) => {
    const q = new URLSearchParams();
    if (p.unread ?? unreadOnly) q.set("filter", "unread");
    if ((p.page ?? 1) > 1) q.set("page", String(p.page));
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Filter" className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {[
            ["All", false],
            [`Unread · ${data.unread}`, true],
          ].map(([label, u]) => (
            <Link
              key={String(label)}
              href={href({ unread: Boolean(u), page: 1 })}
              aria-current={unreadOnly === u ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center rounded-md px-3 text-sm text-muted-foreground [@media(pointer:coarse)]:h-9",
                unreadOnly === u && "bg-card font-medium text-foreground shadow-sm",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        {data.unread > 0 && (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => markAllNotificationsReadAction({}))}>
            <CheckCheck data-icon="inline-start" />
            Mark all read
          </Button>
        )}
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={unreadOnly ? "No unread notifications" : "No notifications yet"}
          description="Updates about your work will appear here."
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
          {data.items.map((n) => (
            <li key={n.id} className={cn("flex items-start gap-3 px-4 py-3", !n.readAt && "bg-tone-info-bg/30")}>
              <span aria-hidden className={cn("mt-2 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-tone-info")} />
              <Link
                href={n.href}
                className="min-w-0 flex-1"
                onClick={() => {
                  if (!n.readAt) void setNotificationReadAction({ notificationId: n.id, read: true });
                }}
              >
                <span className={cn("block text-sm text-pretty", !n.readAt && "font-medium")}>{n.title}</span>
                <span className="mt-0.5 block text-sm text-pretty text-muted-foreground [overflow-wrap:anywhere]">{n.message}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{when(n.createdAt)}</span>
              </Link>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={pending}
                aria-label={n.readAt ? "Mark as unread" : "Mark as read"}
                title={n.readAt ? "Mark as unread" : "Mark as read"}
                onClick={() => run(() => setNotificationReadAction({ notificationId: n.id, read: !n.readAt }))}
              >
                {n.readAt ? <Mail /> : <MailOpen />}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {(data.page > 1 || data.hasMore) && (
        <div className="flex justify-between gap-2">
          {data.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={href({ page: data.page - 1 })}>Newer</Link>
            </Button>
          ) : (
            <span />
          )}
          {data.hasMore && (
            <Button asChild variant="outline" size="sm">
              <Link href={href({ page: data.page + 1 })}>Older</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Minimal preferences: email on/off; non-essential in-app on/off (critical items always arrive). */
export function NotificationPreferences({
  prefs,
  client,
}: {
  prefs: { inAppEnabled: boolean; emailEnabled: boolean };
  /** Client wording (no internal vocabulary). */
  client?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [p, setP] = useState(prefs);
  const save = (next: typeof p) => {
    setP(next);
    start(async () => {
      const res = await setNotificationPreferencesAction(next);
      if (!res.ok) {
        toast.error(res.error.message);
        setP(p);
        return;
      }
      toast.success("Preferences saved");
      router.refresh();
    });
  };
  const rows: [keyof typeof p, string, string][] = client
    ? [
        ["emailEnabled", "Email me when content needs my approval", "We'll only email you about things waiting for you."],
        ["inAppEnabled", "Show other updates", "Approval requests always appear here."],
      ]
    : [
        ["emailEnabled", "Email me about important items", "Approvals waiting, change requests, posting and urgent problems."],
        ["inAppEnabled", "Show non-essential updates", "Assignments, approvals and problems always appear here."],
      ];
  return (
    <section className="rounded-xl border bg-card shadow-xs">
      <h2 className="border-b px-4 py-3 text-sm font-medium">Notification settings</h2>
      <ul className="divide-y">
        {rows.map(([key, label, hint]) => (
          <li key={key} className="flex items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{label}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={p[key]}
              aria-label={label}
              disabled={pending}
              onClick={() => save({ ...p, [key]: !p[key] })}
              className={cn(
                "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
                p[key] ? "bg-primary" : "bg-muted-foreground/30",
              )}
            >
              <span className={cn("inline-block size-5 rounded-full bg-background shadow transition-transform", p[key] ? "translate-x-[18px]" : "translate-x-0.5")} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
