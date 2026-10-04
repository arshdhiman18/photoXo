import type { Metadata } from "next";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { Workspace } from "@/lib/domain/roles";
import { formatDate } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { canManageSettings } from "@/server/authz/permissions";
import { getAgencySettings } from "@/server/services/agency.service";
import { getReminderSettings } from "@/server/services/notifications.service";
import { ReminderSettingsForm } from "@/features/notifications/components/reminder-settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canManageSettings(actor)) {
    return (
      <AccessDenied
        description="System settings are limited to administrators."
        backHref="/admin"
      />
    );
  }
  const [agency, reminders] = await Promise.all([getAgencySettings(actor), getReminderSettings(actor)]);
  const rows: [string, string][] = [
    ["Agency name", agency.name],
    ["Time zone", agency.timezone],
    ["Currency", agency.currency],
    ["Created", formatDate(agency.createdAt, agency.timezone)],
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Agency configuration."
      />
      <section className="max-w-2xl rounded-xl border bg-card shadow-xs">
        <h2 className="border-b px-5 py-3.5 text-sm font-medium">Agency</h2>
        <dl className="divide-y">
          {rows.map(([k, v]) => (
            <div
              key={k}
              className="grid grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4"
            >
              <dt className="text-sm text-muted-foreground">{k}</dt>
              <dd className="min-w-0 truncate text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="max-w-2xl rounded-xl border bg-card shadow-xs">
        <h2 className="border-b px-5 py-3.5 text-sm font-medium">Reminders</h2>
        <ReminderSettingsForm value={reminders} />
      </section>
    </div>
  );
}
