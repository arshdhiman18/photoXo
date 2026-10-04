"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FieldError } from "@/components/common/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateReminderSettingsAction } from "@/features/notifications/actions";
import type { ReminderSettings } from "@/lib/domain/notifications";

const FIELDS: [keyof ReminderSettings, string, string][] = [
  ["approvalWaitingHours", "Approval waiting", "Remind reviewers / the client after this many hours."],
  ["readyToPostHours", "Ready to post", "Remind the uploader when approved content is still unposted."],
  ["overdueGraceHours", "Overdue grace", "Hours after a due date or shoot end before it counts as overdue."],
  ["repeatEveryHours", "Repeat every", "An unresolved item is reminded at most once per this many hours."],
  ["readNotificationRetentionDays", "Keep read notifications", "Days to keep notifications people have read. Unread important ones are never removed."],
];

export function ReminderSettingsForm({ value }: { value: ReminderSettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  return (
    <form
      className="flex flex-col gap-4 px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const input = Object.fromEntries(FIELDS.map(([k]) => [k, Number(fd.get(k))])) as unknown as ReminderSettings;
        start(async () => {
          const res = await updateReminderSettingsAction(input);
          if (!res.ok) {
            if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
            else toast.error(res.error.message);
            return;
          }
          setErrors({});
          toast.success("Reminder settings saved");
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map(([key, label, hint]) => (
          <div key={key} className="grid gap-1.5">
            <Label htmlFor={`rs-${key}`}>
              {label} ({key === "readNotificationRetentionDays" ? "days" : "hours"})
            </Label>
            <Input id={`rs-${key}`} name={key} type="number" inputMode="numeric" min={key === "overdueGraceHours" ? 0 : 1} defaultValue={value[key]} aria-invalid={!!errors[key]} />
            <p className="text-xs text-muted-foreground">{hint}</p>
            <FieldError messages={errors[key]} />
          </div>
        ))}
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          Save reminders
        </Button>
      </div>
    </form>
  );
}
