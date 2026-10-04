"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  getNotificationSummaryAction,
  markAllNotificationsReadAction,
  setNotificationReadAction,
} from "@/features/notifications/actions";
import type { NotificationDTO } from "@/features/notifications/types";
import { cn } from "@/lib/utils";

const POLL_MS = 60_000;
const when = (iso: string) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/**
 * Bell with the server-derived unread count. V1 keeps it simple: the count
 * comes from the layout, then refreshes by polling (every minute, on focus
 * and whenever the menu opens). No websockets.
 */
export function NotificationsButton({ inboxHref, initialUnread = 0 }: { inboxHref: string; initialUnread?: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [recent, setRecent] = useState<NotificationDTO[] | null>(null);
  const [pending, start] = useTransition();

  const refresh = useCallback(async () => {
    const res = await getNotificationSummaryAction({});
    if (res.ok) {
      setUnread(res.data.unread);
      setRecent(res.data.recent);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void refresh();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className="relative">
          <Bell className="size-[18px]" strokeWidth={1.75} />
          {unread > 0 && (
            <span className="absolute top-1 right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-tone-danger px-1 text-[10px] leading-none font-semibold text-white tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={16} className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <p className="text-sm font-medium">Notifications</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await markAllNotificationsReadAction({});
                  await refresh();
                  router.refresh();
                })
              }
            >
              <CheckCheck data-icon="inline-start" />
              Mark all read
            </Button>
          )}
        </div>
        {recent === null ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : recent.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <Bell className="mb-2 size-5 text-muted-foreground" strokeWidth={1.75} />
            <p className="text-sm font-medium">You&apos;re all caught up</p>
          </div>
        ) : (
          <ul className="max-h-[min(24rem,60dvh)] divide-y overflow-y-auto">
            {recent.map((n) => (
              <li key={n.id}>
                <Link
                  href={n.href}
                  onClick={() => {
                    setOpen(false);
                    if (!n.readAt) void setNotificationReadAction({ notificationId: n.id, read: true }).then(refresh);
                  }}
                  className={cn("flex gap-2.5 px-4 py-3 hover:bg-subtle", !n.readAt && "bg-tone-info-bg/40")}
                >
                  <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-tone-info")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-pretty">{n.title}</span>
                    <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{n.message}</span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">{when(n.createdAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t p-1.5">
          <Button asChild variant="ghost" className="w-full justify-center" onClick={() => setOpen(false)}>
            <Link href={inboxHref}>Open inbox</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
