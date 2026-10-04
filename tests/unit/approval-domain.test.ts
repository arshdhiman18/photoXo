import { describe, expect, it } from "vitest";
import {
  APPROVAL_TRANSITIONS,
  approvalEventFor,
  canApplyApprovalEvent,
  commentVisibilityFor,
} from "@/lib/domain/approvals";
import { CONTENT_STATUSES, PRODUCTION_ROUTES, canTransition, routeReviewGates } from "@/lib/domain/content";

describe("approval state machine", () => {
  it("is the only path into and out of review", () => {
    expect(canApplyApprovalEvent("IN_PRODUCTION", "SUBMIT_INTERNAL")).toBe(true);
    expect(canApplyApprovalEvent("CHANGES_REQUESTED", "SUBMIT_INTERNAL")).toBe(true);
    expect(canApplyApprovalEvent("INTERNAL_REVIEW", "INTERNAL_APPROVED")).toBe(true);
    expect(canApplyApprovalEvent("CLIENT_REVIEW", "CLIENT_APPROVED")).toBe(true);
    // General transitions can never enter review or reach READY_TO_POST.
    for (const from of CONTENT_STATUSES) {
      for (const to of ["INTERNAL_REVIEW", "CLIENT_REVIEW", "CHANGES_REQUESTED", "READY_TO_POST", "POSTED", "COMPLETED"] as const) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("forbids skipping gates", () => {
    const reachesReady = Object.values(APPROVAL_TRANSITIONS).filter((t) => t.to === "READY_TO_POST");
    expect(reachesReady).toEqual([{ from: ["CLIENT_REVIEW"], to: "READY_TO_POST" }]);
    expect(canApplyApprovalEvent("INTERNAL_REVIEW", "CLIENT_APPROVED")).toBe(false);
    expect(canApplyApprovalEvent("CHANGES_REQUESTED", "CLIENT_APPROVED")).toBe(false);
    expect(canApplyApprovalEvent("PLANNED", "SUBMIT_INTERNAL")).toBe(false);
    expect(canApplyApprovalEvent("CLIENT_REVIEW", "SUBMIT_INTERNAL")).toBe(false);
    // Approval never completes or posts.
    expect(Object.values(APPROVAL_TRANSITIONS).some((t) => t.to === "POSTED" || t.to === "COMPLETED")).toBe(false);
  });

  it("maps gate + decision to events", () => {
    expect(approvalEventFor("INTERNAL", "APPROVED")).toBe("INTERNAL_APPROVED");
    expect(approvalEventFor("INTERNAL", "CHANGES_REQUESTED")).toBe("INTERNAL_CHANGES_REQUESTED");
    expect(approvalEventFor("CLIENT", "APPROVED")).toBe("CLIENT_APPROVED");
    expect(approvalEventFor("CLIENT", "CHANGES_REQUESTED")).toBe("CLIENT_CHANGES_REQUESTED");
  });

  it("only a client's own comment is client-visible", () => {
    expect(commentVisibilityFor("CLIENT", "CLIENT_USER")).toBe("CLIENT");
    expect(commentVisibilityFor("CLIENT", "RECORDED_BY_ADMIN")).toBe("INTERNAL");
    expect(commentVisibilityFor("INTERNAL", "REVIEWER")).toBe("INTERNAL");
  });

  it("every route declares its review gates in order (internal before client)", () => {
    for (const r of PRODUCTION_ROUTES) expect(routeReviewGates(r)).toEqual(["INTERNAL", "CLIENT"]);
  });
});
