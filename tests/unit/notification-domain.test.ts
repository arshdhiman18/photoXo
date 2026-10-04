import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_DEFS,
  notificationHref,
  reminderWindow,
} from "@/lib/domain/notifications";
import { renderNotification } from "@/server/notifications/templates";

const ID = "6ac0e3d015146e7ef8c8e957";

describe("notification links", () => {
  it("are internal, role-appropriate paths", () => {
    expect(notificationHref({ type: "CONTENT_READY_FOR_CLIENT_APPROVAL", entityType: "CONTENT", entityId: ID, contentId: ID }, "CLIENT")).toBe(`/client/content/${ID}`);
    expect(notificationHref({ type: "CONTENT_READY_FOR_INTERNAL_REVIEW", entityType: "CONTENT", entityId: ID, contentId: ID }, "MANAGER")).toBe(`/admin/content/${ID}`);
    expect(notificationHref({ type: "CHANGES_REQUESTED_INTERNAL", entityType: "CONTENT", entityId: ID, contentId: ID }, "STAFF")).toBe(`/work/content/${ID}`);
    expect(notificationHref({ type: "CONTENT_READY_TO_POST", entityType: "CONTENT", entityId: ID, contentId: ID }, "STAFF")).toBe(`/work/to-post/${ID}`);
    expect(notificationHref({ type: "SHOOT_ASSIGNED", entityType: "SHOOT", entityId: ID, contentId: null }, "STAFF")).toBe(`/work/shoots/${ID}`);
    expect(notificationHref({ type: "OVERDUE_ITEM", entityType: "SHOOT", entityId: ID, contentId: null }, "ADMIN")).toBe(`/admin/shoots/${ID}`);
  });

  it("never follow injected data outside the app", () => {
    for (const bad of ["//evil.example", "https://evil.example", "../../admin", "javascript:alert(1)", `${ID}/../x`]) {
      for (const role of ["ADMIN", "MANAGER", "STAFF", "CLIENT"] as const) {
        for (const type of NOTIFICATION_TYPES) {
          const href = notificationHref({ type, entityType: "CONTENT", entityId: bad, contentId: bad }, role);
          expect(href).toMatch(/^\/(client|work|admin)\/[a-z0-9/-]*$/);
          expect(href).not.toContain("evil");
          expect(href).not.toContain("..");
        }
      }
    }
  });
});

describe("reminder windows", () => {
  const since = new Date("2026-10-01T00:00:00Z");
  const at = (h: number) => new Date(since.getTime() + h * 3_600_000);
  it("are deterministic: none before the threshold, then one per repeat window", () => {
    expect(reminderWindow(since, at(23), 24, 24)).toBeNull();
    expect(reminderWindow(since, at(24), 24, 24)).toBe(0);
    expect(reminderWindow(since, at(47), 24, 24)).toBe(0);
    expect(reminderWindow(since, at(48), 24, 24)).toBe(1);
    expect(reminderWindow(since, at(5), 0, 2)).toBe(2);
  });
});

describe("client copy", () => {
  it("exists only for client-audience types and never uses internal context", () => {
    const ctx = { contentTitle: "Reel", comment: "INTERNAL-COMMENT", detail: "INTERNAL-DETAIL", shootTitle: "Shoot", versionNumber: 3 };
    for (const type of NOTIFICATION_TYPES) {
      const r = renderNotification(type, "CLIENT", ctx, "Brand", false);
      if (!NOTIFICATION_TYPE_DEFS[type].audiences.includes("CLIENT")) {
        expect(r).toBeNull();
        continue;
      }
      expect(r).not.toBeNull();
      const text = `${r!.title} ${r!.message}`;
      for (const s of ["INTERNAL", "Shoot", "V3"]) expect(text).not.toContain(s);
    }
  });

  it("email is limited to the important actionable types", () => {
    const emailed = NOTIFICATION_TYPES.filter((t) => NOTIFICATION_TYPE_DEFS[t].email).sort();
    expect(emailed).toEqual(
      ["CHANGES_REQUESTED_CLIENT", "CONTENT_READY_FOR_CLIENT_APPROVAL", "CONTENT_READY_TO_POST", "OVERDUE_ITEM", "UPLOADER_ASSIGNMENT_PROBLEM"].sort(),
    );
  });
});
