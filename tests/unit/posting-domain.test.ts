import { describe, expect, it } from "vitest";
import { APPROVAL_TRANSITIONS } from "@/lib/domain/approvals";
import { CONTENT_STATUSES, canTransition } from "@/lib/domain/content";
import { POSTING_TRANSITIONS, allRequiredPosted, normalizePostUrl } from "@/lib/domain/postings";

describe("post URL validation", () => {
  it("accepts platform hosts and normalises", () => {
    expect(normalizePostUrl("INSTAGRAM", " http://www.instagram.com/p/abc/#x ")).toEqual({ ok: true, url: "https://www.instagram.com/p/abc/" });
    expect(normalizePostUrl("YOUTUBE", "https://youtu.be/abc")).toMatchObject({ ok: true });
    expect(normalizePostUrl("YOUTUBE", "https://m.youtube.com/watch?v=abc")).toMatchObject({ ok: true });
    expect(normalizePostUrl("TIKTOK", "https://vm.tiktok.com/xyz")).toMatchObject({ ok: true });
    expect(normalizePostUrl("FACEBOOK", "https://fb.watch/abc")).toMatchObject({ ok: true });
    expect(normalizePostUrl("PINTEREST", "https://pin.it/abc")).toMatchObject({ ok: true });
    expect(normalizePostUrl("OTHER", "https://example.com/post")).toMatchObject({ ok: true });
  });

  it("rejects other hosts, look-alikes and non-web links", () => {
    expect(normalizePostUrl("INSTAGRAM", "https://youtube.com/watch?v=1")).toMatchObject({ ok: false });
    expect(normalizePostUrl("INSTAGRAM", "https://instagram.com.evil.io/p/1")).toMatchObject({ ok: false });
    expect(normalizePostUrl("INSTAGRAM", "https://notinstagram.com/p/1")).toMatchObject({ ok: false });
    expect(normalizePostUrl("OTHER", "javascript:alert(1)")).toMatchObject({ ok: false });
    expect(normalizePostUrl("OTHER", "instagram.com/p/1")).toMatchObject({ ok: false });
  });
});

describe("completion rule", () => {
  it("needs every required platform", () => {
    expect(allRequiredPosted(["INSTAGRAM", "YOUTUBE"], ["INSTAGRAM"])).toBe(false);
    expect(allRequiredPosted(["INSTAGRAM", "YOUTUBE"], ["YOUTUBE", "INSTAGRAM"])).toBe(true);
    expect(allRequiredPosted([], ["INSTAGRAM"])).toBe(false); // no configuration → never complete
  });

  it("only posting reaches POSTED/COMPLETED, and only from READY_TO_POST", () => {
    expect(POSTING_TRANSITIONS.ALL_PLATFORMS_POSTED).toEqual({ from: ["READY_TO_POST"], to: "POSTED" });
    expect(POSTING_TRANSITIONS.COMPLETE).toEqual({ from: ["POSTED"], to: "COMPLETED" });
    for (const from of CONTENT_STATUSES) {
      expect(canTransition(from, "POSTED")).toBe(false);
      expect(canTransition(from, "COMPLETED")).toBe(false);
    }
    expect(Object.values(APPROVAL_TRANSITIONS).some((t) => t.to === "POSTED" || t.to === "COMPLETED")).toBe(false);
    expect(APPROVAL_TRANSITIONS.REOPEN_FOR_CHANGES).toEqual({ from: ["READY_TO_POST"], to: "CHANGES_REQUESTED" });
  });
});
