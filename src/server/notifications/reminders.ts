import "server-only";
import type { Types } from "mongoose";
import { NotificationType as T, reminderWindow } from "@/lib/domain/notifications";
import {
  activeOpsUserIds,
  agencyIds,
  brandPrimaryUploader,
  clientIdsOfBrand,
  contentTitles,
  contentWaitingSince,
  overdueContent,
  overdueShoots,
  overdueTasks,
  reminderSettingsFor,
  versionNumbers,
} from "@/server/repositories/notifications.repo";
import { resolveEffectiveUploader } from "@/server/repositories/postings.repo";
import { notifyReadyToPost, uploaderProblem } from "./events";
import { notify } from "./notify";

const H = 3_600_000;
const days = (from: Date, now: Date) => {
  const d = Math.floor((now.getTime() - from.getTime()) / (24 * H));
  return d <= 0 ? "less than a day" : d === 1 ? "1 day" : `${d} days`;
};

/**
 * One deterministic reminder pass. For every unresolved item past its
 * threshold, a reminder is created for the current window only:
 *   eventKey = TYPE : entity : R : <anchor> : <window index>
 * so running the job any number of times inside a window produces exactly
 * one reminder; the next window may produce the next one; a resolved item
 * (state left) is no longer scanned; re-entering a state (new anchor)
 * starts a fresh series. Archived content is not scanned and archived
 * brands / inactive users are filtered by notify().
 */
export async function runReminders(opts: { now?: Date; agencyId?: Types.ObjectId } = {}) {
  const now = opts.now ?? new Date();
  const agencies = opts.agencyId ? [opts.agencyId] : await agencyIds();
  let created = 0;
  for (const agencyId of agencies) {
    const s = await reminderSettingsFor(agencyId);
    const rep = s.repeatEveryHours;
    const ops = await activeOpsUserIds(agencyId);

    // Approval waiting — internal reviewers.
    for (const c of await contentWaitingSince(agencyId, "INTERNAL_REVIEW", new Date(now.getTime() - s.approvalWaitingHours * H))) {
      const w = reminderWindow(c.statusChangedAt, now, s.approvalWaitingHours, rep);
      if (w === null) continue;
      created += await notify({
        agencyId,
        brandId: c.brandId,
        contentId: c._id,
        entity: { type: "CONTENT", id: c._id },
        type: T.CONTENT_READY_FOR_INTERNAL_REVIEW,
        recipients: ops,
        eventVersion: `R:${c.statusChangedAt.getTime()}:${w}`,
        reminder: true,
        ctx: { contentTitle: c.title, versionNumber: c.reviewSubmission?.versionNumber, detail: `waiting ${days(c.statusChangedAt, now)}` },
      });
    }

    // Approval waiting — the brand's clients (client-safe copy).
    for (const c of await contentWaitingSince(agencyId, "CLIENT_REVIEW", new Date(now.getTime() - s.approvalWaitingHours * H))) {
      const w = reminderWindow(c.statusChangedAt, now, s.approvalWaitingHours, rep);
      if (w === null) continue;
      created += await notify({
        agencyId,
        brandId: c.brandId,
        contentId: c._id,
        entity: { type: "CONTENT", id: c._id },
        type: T.CONTENT_READY_FOR_CLIENT_APPROVAL,
        recipients: await clientIdsOfBrand(agencyId, c.brandId),
        eventVersion: `R:${c.statusChangedAt.getTime()}:${w}`,
        reminder: true,
        ctx: { contentTitle: c.title },
      });
    }

    // Ready to post — uploader problems right away (repeating), unposted backlog after the threshold.
    const ready = await contentWaitingSince(agencyId, "READY_TO_POST", now);
    const numbers = await versionNumbers(agencyId, ready.flatMap((c) => (c.clientApprovedVersionId ? [c.clientApprovedVersionId] : [])));
    for (const c of ready) {
      const u = await resolveEffectiveUploader(agencyId, { _id: c.brandId, primaryUploaderId: await brandPrimaryUploader(agencyId, c.brandId) }, c);
      const version = c.clientApprovedVersionId ? { _id: c.clientApprovedVersionId, versionNumber: numbers.get(String(c.clientApprovedVersionId)) ?? 0 } : null;
      if (!u.valid) {
        const w = reminderWindow(c.statusChangedAt, now, 0, rep);
        if (w !== null) await uploaderProblem(c, version, u.problem, true, `${c.statusChangedAt.getTime()}:${w}`);
        continue;
      }
      const w = reminderWindow(c.statusChangedAt, now, s.readyToPostHours, rep);
      if (w !== null && version) await notifyReadyToPost(c, version, true, `${c.statusChangedAt.getTime()}:${w}`);
    }

    // Overdue tasks — their assignee.
    const grace = s.overdueGraceHours * H;
    const tasks = await overdueTasks(agencyId, new Date(now.getTime() - grace));
    const titles = await contentTitles(agencyId, [...new Set(tasks.map((t) => String(t.contentId)))].map((id) => tasks.find((t) => String(t.contentId) === id)!.contentId));
    for (const t of tasks) {
      const w = reminderWindow(t.dueDate!, now, s.overdueGraceHours, rep);
      if (w === null || !t.assignedTo) continue;
      created += await notify({
        agencyId,
        brandId: t.brandId,
        contentId: t.contentId,
        entity: { type: "TASK", id: t._id },
        type: T.OVERDUE_ITEM,
        recipients: [t.assignedTo],
        eventVersion: `R:${t.dueDate!.getTime()}:${w}`,
        reminder: true,
        ctx: { contentTitle: titles.get(String(t.contentId)), detail: `your task "${t.title}" is overdue by ${days(t.dueDate!, now)}.` },
      });
    }

    // Shoots still open after they ended — crew who haven't finished their part.
    for (const sh of await overdueShoots(agencyId, new Date(now.getTime() - grace))) {
      const w = reminderWindow(sh.endAt, now, s.overdueGraceHours, rep);
      if (w === null) continue;
      created += await notify({
        agencyId,
        brandId: sh.brandId,
        contentId: null,
        entity: { type: "SHOOT", id: sh._id },
        type: T.OVERDUE_ITEM,
        recipients: sh.crew.filter((c) => c.status === "ASSIGNED" || c.status === "IN_PROGRESS").map((c) => c.userId),
        eventVersion: `R:${sh.endAt.getTime()}:${w}`,
        reminder: true,
        ctx: { shootTitle: sh.title, detail: "the shoot has ended but isn't marked complete — mark your part done." },
      });
    }

    // Content past its due date — operations (the dashboard remains the source of truth).
    for (const c of await overdueContent(agencyId, new Date(now.getTime() - grace))) {
      const w = reminderWindow(c.dueDate!, now, s.overdueGraceHours, rep);
      if (w === null) continue;
      created += await notify({
        agencyId,
        brandId: c.brandId,
        contentId: c._id,
        entity: { type: "CONTENT", id: c._id },
        type: T.OVERDUE_ITEM,
        recipients: ops,
        eventVersion: `R:${c.dueDate!.getTime()}:${w}`,
        reminder: true,
        ctx: { contentTitle: c.title, detail: `past its due date by ${days(c.dueDate!, now)}.` },
      });
    }
  }
  return { created };
}
