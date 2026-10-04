import { describe, expect, it } from "vitest";
import { summarizeContentTypes } from "@/lib/domain/content";
import { crewNextAction, evaluateShootProgress, routeHasShoot, SHOOT_CREW_ROLES } from "@/lib/domain/shoots";
import { addDays, formatClock, zonedDateTimeToUtc } from "@/lib/dates";

const c = (status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED", required = true) => ({ status, required });

describe("shoot completion rule (centralised)", () => {
  it.each([
    [[c("ASSIGNED"), c("ASSIGNED")], "IN_PROGRESS"],
    [[c("COMPLETED"), c("IN_PROGRESS")], "PARTIALLY_COMPLETED"],
    [[c("COMPLETED"), c("COMPLETED")], "COMPLETED"],
    [[c("COMPLETED"), c("ASSIGNED", false)], "COMPLETED"], // optional crew don't block
    [[c("COMPLETED", false), c("ASSIGNED")], "IN_PROGRESS"], // only required count
    [[c("COMPLETED"), c("CANCELLED")], "COMPLETED"], // removed crew ignored
    [[], "IN_PROGRESS"], // no crew never completes
    [[c("CANCELLED")], "IN_PROGRESS"],
  ] as const)("%j → %s", (crew, expected) => {
    expect(evaluateShootProgress([...crew])).toBe(expected);
  });
});

describe("crew next action", () => {
  it("drives My Day buttons", () => {
    expect(crewNextAction("SCHEDULED", "ASSIGNED")).toBe("START_SHOOT");
    expect(crewNextAction("IN_PROGRESS", "ASSIGNED")).toBe("START_MY_PART");
    expect(crewNextAction("IN_PROGRESS", "IN_PROGRESS")).toBe("COMPLETE_MY_PART");
    expect(crewNextAction("PARTIALLY_COMPLETED", "COMPLETED")).toBeNull();
    expect(crewNextAction("CANCELLED", "ASSIGNED")).toBeNull();
    expect(crewNextAction("COMPLETED", "IN_PROGRESS")).toBeNull();
  });
});

describe("crew & route configuration", () => {
  it("only physical-production roles are crew by default", () => {
    expect(SHOOT_CREW_ROLES).not.toContain("CLIENT");
    expect(SHOOT_CREW_ROLES).not.toContain("UPLOADER");
    expect(SHOOT_CREW_ROLES).not.toContain("EDITOR");
  });
  it("route config decides whether content needs a shoot", () => {
    expect(routeHasShoot("SHOOT_AND_EDIT")).toBe(true);
    expect(routeHasShoot("SHOOT_THEN_EDIT")).toBe(true);
    expect(routeHasShoot("DESIGN")).toBe(false);
    expect(routeHasShoot("EXISTING_ASSET")).toBe(false);
  });
});

describe("time handling", () => {
  it("converts agency wall-clock to UTC (IST, no DST)", () => {
    expect(zonedDateTimeToUtc("2026-10-05", "10:00", "Asia/Kolkata").toISOString()).toBe("2026-10-05T04:30:00.000Z");
  });
  it("handles DST zones", () => {
    expect(zonedDateTimeToUtc("2026-07-01", "10:00", "Europe/London").toISOString()).toBe("2026-07-01T09:00:00.000Z");
    expect(zonedDateTimeToUtc("2026-12-01", "10:00", "Europe/London").toISOString()).toBe("2026-12-01T10:00:00.000Z");
  });
  it("formats and shifts calendar dates", () => {
    expect(formatClock("14:30")).toBe("2:30 PM");
    expect(formatClock("00:05")).toBe("12:05 AM");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("summarises content mixes", () => {
    expect(summarizeContentTypes(["REEL", "PHOTOGRAPHY", "REEL", "REEL"])).toBe("3 Reels + 1 Photo set");
    expect(summarizeContentTypes([])).toBe("No content yet");
  });
});
