import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { NotificationInbox, NotificationPreferences } from "@/features/notifications/components/notification-inbox";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { loadInbox } from "@/app/work/inbox/load";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const { data, prefs, unreadOnly, timeZone } = await loadInbox(actor, await searchParams);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Notifications" description="Updates about your shoots, tasks, reviews and posting." />
      <NotificationInbox data={data} base="/work/inbox" unreadOnly={unreadOnly} timeZone={timeZone} />
      <NotificationPreferences prefs={prefs} />
    </div>
  );
}
