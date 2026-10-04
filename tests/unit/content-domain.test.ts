import { describe, expect, it } from "vitest";
import {
  CONTENT_TYPE_KEYS,
  CONTENT_TYPES,
  PRODUCTION_ROUTE_DEFS,
  TASK_TYPE_DEFS,
  canTransition,
  detectAssetProvider,
  routeTaskSteps,
} from "@/lib/domain/content";
import { parseReferenceUrl } from "@/lib/domain/references";
import { BrandRole } from "@/lib/domain/roles";

describe("reference URL classification (no network)", () => {
  it.each([
    ["https://www.instagram.com/reel/C1a2B3c4D5e/", "INSTAGRAM", "C1a2B3c4D5e"],
    ["https://instagram.com/p/AbC_123/?igsh=x", "INSTAGRAM", "AbC_123"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "YOUTUBE", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "YOUTUBE", "dQw4w9WgXcQ"],
    ["https://youtube.com/shorts/abcDEF12345", "YOUTUBE", "abcDEF12345"],
    ["https://www.tiktok.com/@brand/video/7234567890123456789", "TIKTOK", "7234567890123456789"],
    ["https://in.pinterest.com/pin/123456789/", "PINTEREST", "123456789"],
    ["https://brand.example.com/campaign", "WEBSITE", null],
  ])("%s → %s", (url, platform, id) => {
    expect(parseReferenceUrl(url)).toMatchObject({ platform, externalId: id });
  });

  it("YouTube gets a deterministic thumbnail; others don't fetch anything", () => {
    expect(parseReferenceUrl("https://youtu.be/dQw4w9WgXcQ").thumbnailUrl).toContain(
      "i.ytimg.com/vi/dQw4w9WgXcQ",
    );
    expect(parseReferenceUrl("https://instagram.com/p/abc/").thumbnailUrl).toBeNull();
  });

  it("unparseable social URLs still classify by platform with no id (link fallback)", () => {
    expect(parseReferenceUrl("https://www.instagram.com/mamaearth.in/")).toMatchObject({
      platform: "INSTAGRAM",
      externalId: null,
    });
  });
});

describe("central content configuration", () => {
  it("every content type has a valid default route", () => {
    for (const t of CONTENT_TYPE_KEYS)
      expect(PRODUCTION_ROUTE_DEFS[CONTENT_TYPES[t].defaultRoute]).toBeDefined();
  });

  it("routes never generate shoot tasks; shoot steps are for the Shoot entity", () => {
    expect(routeTaskSteps("SHOOT_THEN_EDIT").map((s) => s.taskType)).toEqual([
      "UPLOAD_RAW",
      "EDIT",
    ]);
    expect(routeTaskSteps("DESIGN").map((s) => s.taskType)).toEqual(["DESIGN"]);
    for (const def of Object.values(PRODUCTION_ROUTE_DEFS)) {
      expect(def.steps.at(-1)?.kind).toBe("REVIEW");
    }
  });

  it("clients are never eligible for any task type", () => {
    for (const def of Object.values(TASK_TYPE_DEFS))
      expect(def.eligibleBrandRoles).not.toContain(BrandRole.CLIENT);
    expect(TASK_TYPE_DEFS.EDIT.eligibleBrandRoles).not.toContain(BrandRole.UPLOADER);
  });

  it("only Stage 3 transitions are enabled (no approval/posting shortcuts)", () => {
    expect(canTransition("PROPOSED", "PLANNED")).toBe(true);
    expect(canTransition("PLANNED", "IN_PRODUCTION")).toBe(true);
    expect(canTransition("IN_PRODUCTION", "INTERNAL_REVIEW")).toBe(false);
    expect(canTransition("CLIENT_REVIEW", "READY_TO_POST")).toBe(false);
    expect(canTransition("READY_TO_POST", "POSTED")).toBe(false);
    expect(canTransition("POSTED", "COMPLETED")).toBe(false);
  });

  it("detects external asset providers", () => {
    expect(detectAssetProvider("https://www.canva.com/design/x")).toBe("CANVA");
    expect(detectAssetProvider("https://www.figma.com/file/x")).toBe("FIGMA");
    expect(detectAssetProvider("https://drive.google.com/file/d/x")).toBe("GOOGLE_DRIVE");
    expect(detectAssetProvider("https://example.com/x")).toBe("OTHER");
  });
});
