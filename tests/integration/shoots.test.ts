import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../support/next-headers-mock"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { Types } from "mongoose";
import { BrandRole, SystemRole } from "@/lib/domain/roles";
import {
  addCrewAction,
  completeMyPartAction,
  createShootAction,
  startShootAction,
} from "@/features/shoots/actions";
import type { Actor } from "@/server/authz/actor";
import { disconnectDb } from "@/server/db/connect";
import {
  ActivityLogModel,
  AgencyModel,
  BrandMembershipModel,
  ContentModel,
  ProductionTaskModel,
  ShootModel,
} from "@/server/db/models";
import { shootRepo } from "@/server/repositories/shoots.repo";
import { addMember, deactivateMember } from "@/server/services/brand-team.service";
import { createBrand } from "@/server/services/brands.service";
import { cancelContent, createBrief } from "@/server/services/content.service";
import {
  addCrew,
  addShootContent,
  cancelShoot,
  completeCrewOnBehalf,
  completeMyPart,
  createShoot,
  getShootForAdmin,
  getShootForStaff,
  listMyShoots,
  listShootsForAdmin,
  removeCrew,
  removeShootContent,
  rescheduleShoot,
  startShoot,
} from "@/server/services/shoots.service";
import { updateTaskStatus } from "@/server/services/tasks.service";
import { addDays } from "@/lib/dates";
import { bootstrapAgency, createActiveUser, signIn, signInActor, type TestUser } from "../support/fixtures";
import { setRequestCookie } from "../support/next-headers-mock";

let admin: TestUser, rahul: TestUser, karan: TestUser, vikas: TestUser, aman: TestUser, neha: TestUser, priya: TestUser;
let amit: TestUser, foreignAdmin: TestUser;
let A: Actor;
let mamaearth: string, adidas: string, foreignContent: string;
const cookies: Record<string, string> = {};
const as = (u: TestUser) => setRequestCookie(cookies[u.id]!);
const actorOf = async (u: TestUser) => (await signInActor(u)).actor;

const brief = async (brandId: string, contentType = "REEL", actor = A) =>
  (
    await createBrief(actor, {
      brandId,
      title: `${contentType} brief`,
      description: null,
      notes: "INTERNAL",
      contentType,
      origin: "ADMIN_BRIEF",
      priority: "NORMAL",
      dueDate: null,
      referenceIds: [],
      referenceUrl: null,
    } as never)
  ).id;

let day = 1;
/** Each call gets its own date unless one is given, so tests don't conflict accidentally. */
const shoot = (extra: Record<string, unknown> = {}, actor = A) =>
  createShoot(actor, {
    brandId: mamaearth,
    title: "Studio shoot",
    date: addDays("2027-01-01", day++),
    startTime: "10:00",
    endTime: "12:00",
    locationName: "Gurgaon Studio",
    locationAddress: null,
    notes: "Bring the softbox",
    contentIds: [],
    crew: [{ userId: rahul.id, brandRole: "VIDEOGRAPHER", required: true }],
    ...extra,
  } as never);

beforeAll(async () => {
  admin = await bootstrapAgency();
  A = await actorOf(admin);
  rahul = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Rahul");
  karan = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Karan");
  vikas = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Vikas");
  aman = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Aman");
  neha = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Neha");
  priya = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Priya");
  amit = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Amit Client");
  for (const u of [admin, rahul, karan, vikas, aman, neha, priya, amit]) cookies[u.id] = await signIn(u);

  mamaearth = (await createBrand(A, { name: "Mamaearth", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
  adidas = (await createBrand(A, { name: "Adidas", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
  const add = (u: TestUser, role: BrandRole, brandId = mamaearth) => addMember(A, { brandId, userId: u.id, role });
  await add(rahul, BrandRole.VIDEOGRAPHER);
  await add(rahul, BrandRole.VIDEOGRAPHER, adidas);
  await add(karan, BrandRole.PHOTOGRAPHER);
  await add(vikas, BrandRole.ASSISTANT);
  await add(aman, BrandRole.EDITOR);
  await add(neha, BrandRole.UPLOADER);
  await add(priya, BrandRole.VIDEOGRAPHER, adidas);
  await add(amit, BrandRole.CLIENT);

  const other = await AgencyModel.create({ name: "Agency B", slug: "agency-b", timezone: "UTC", currency: "USD" });
  foreignAdmin = await createActiveUser(String(other._id), SystemRole.ADMIN, "Foreign Admin");
  const F = await actorOf(foreignAdmin);
  const fb = await createBrand(F, { name: "Foreign", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] });
  foreignContent = await brief(fb.id, "REEL", F);
});

beforeEach(() => setRequestCookie(null));
afterAll(async () => {
  await disconnectDb();
});

// ── Model & content linking ───────────────────────────────────────────────
describe("shoot ↔ content", () => {
  it("one shoot holds many content items (no content data duplicated)", async () => {
    const ids = [await brief(mamaearth), await brief(mamaearth), await brief(mamaearth, "PHOTOGRAPHY")];
    const { id } = await shoot({ contentIds: ids });
    const doc = await ShootModel.findById(id).lean();
    expect(doc!.contentIds.map(String)).toEqual(ids);
    expect(Object.keys(doc!)).not.toContain("contents");
    expect((await getShootForAdmin(A, id)).contents.map((c) => c.id)).toEqual(ids);
    expect(String((await ContentModel.findById(ids[0]).lean())?.activeShootId)).toBe(id);
  });

  it("rejects cross-brand and cross-agency content", async () => {
    await expect(shoot({ contentIds: [await brief(adidas)] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(shoot({ contentIds: [foreignContent] })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects cancelled content and routes without a shoot", async () => {
    const cancelled = await brief(mamaearth);
    await cancelContent(A, cancelled, null);
    await expect(shoot({ contentIds: [cancelled] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(shoot({ contentIds: [await brief(mamaearth, "GRAPHIC")] })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("content can be on at most one active shoot; removal frees it without deleting content", async () => {
    const c = await brief(mamaearth);
    const first = await shoot({ contentIds: [c] });
    await expect(shoot({ contentIds: [c] })).rejects.toMatchObject({ code: "VALIDATION" });
    await removeShootContent(A, first.id, c);
    expect(await ContentModel.exists({ _id: c })).not.toBeNull();
    expect((await ContentModel.findById(c).lean())?.activeShootId).toBeNull();
    const second = await shoot({ contentIds: [c] });
    expect((await getShootForAdmin(A, second.id)).contents).toHaveLength(1);
  });
});

// ── Crew ───────────────────────────────────────────────────────────────────
describe("crew eligibility", () => {
  const crewOf = (userId: string, brandRole = "VIDEOGRAPHER") => ({ crew: [{ userId, brandRole, required: true }] });

  it("multiple people in the same role are allowed", async () => {
    await addMember(A, { brandId: mamaearth, userId: karan.id, role: BrandRole.VIDEOGRAPHER });
    const { id } = await shoot({
      crew: [
        { userId: rahul.id, brandRole: "VIDEOGRAPHER", required: true },
        { userId: karan.id, brandRole: "VIDEOGRAPHER", required: true },
      ],
    });
    expect((await getShootForAdmin(A, id)).crew).toHaveLength(2);
  });

  it("rejects clients, other agencies, invalid ids, non-crew roles and inactive memberships", async () => {
    await expect(shoot(crewOf(amit.id))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(shoot(crewOf(foreignAdmin.id))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(shoot(crewOf(new Types.ObjectId().toHexString()))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(shoot(crewOf(aman.id, "EDITOR"))).rejects.toMatchObject({ code: "VALIDATION" }); // schema/config: editors aren't crew
    await expect(shoot(crewOf(neha.id, "VIDEOGRAPHER"))).rejects.toMatchObject({ code: "VALIDATION" }); // no such membership
    await expect(shoot(crewOf(priya.id))).rejects.toMatchObject({ code: "VALIDATION" }); // Adidas only
    const m = await BrandMembershipModel.findOne({ brandId: mamaearth, userId: vikas.id }).lean();
    await deactivateMember(A, { brandId: mamaearth, membershipId: String(m!._id) });
    await expect(shoot(crewOf(vikas.id, "ASSISTANT"))).rejects.toMatchObject({ code: "VALIDATION" });
    await addMember(A, { brandId: mamaearth, userId: vikas.id, role: BrandRole.ASSISTANT });
  });

  it("rejects duplicate crew assignment", async () => {
    await expect(
      shoot({
        crew: [
          { userId: rahul.id, brandRole: "VIDEOGRAPHER", required: true },
          { userId: rahul.id, brandRole: "VIDEOGRAPHER", required: false },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const { id } = await shoot();
    await expect(addCrew(A, { shootId: id, userId: rahul.id, brandRole: "VIDEOGRAPHER", required: true } as never)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

// ── Scheduling conflicts ──────────────────────────────────────────────────
describe("scheduling conflicts", () => {
  const slot = (date: string, startTime: string, endTime: string, brandId = mamaearth) => ({ date, startTime, endTime, brandId });

  it("detects overlap (even across brands), accepts adjacent and other dates", async () => {
    await shoot(slot("2026-12-01", "10:00", "12:00"));
    const err = await shoot(slot("2026-12-01", "11:00", "13:00", adidas)).catch((e) => e);
    expect(err).toMatchObject({ code: "CONFLICT" });
    expect(err.details.conflicts[0]).toMatchObject({ userId: rahul.id, startTime: "10:00" });
    await expect(shoot(slot("2026-12-01", "12:00", "14:00"))).resolves.toHaveProperty("id"); // touching ≠ overlapping
    await expect(shoot(slot("2026-12-02", "10:00", "12:00"))).resolves.toHaveProperty("id");
  });

  it("an authorised override is allowed and audited per conflict", async () => {
    await shoot(slot("2026-12-05", "10:00", "12:00"));
    const { id } = await shoot({ ...slot("2026-12-05", "11:00", "13:00"), overrideReason: "Rahul covers the first hour only" });
    const log = await ActivityLogModel.findOne({ action: "shoot.conflict_override", "entity.id": id }).lean();
    expect(log?.meta).toMatchObject({ userId: rahul.id, reason: "Rahul covers the first hour only" });
    expect(String(log?.actorId)).toBe(admin.id);
  });

  it("staff cannot create shoots or override conflicts", async () => {
    as(rahul);
    const res = await createShootAction({
      brandId: mamaearth,
      title: "Rogue shoot",
      date: "2026-12-05",
      startTime: "10:00",
      endTime: "11:00",
      locationName: "Somewhere",
      crew: [{ userId: rahul.id, brandRole: "VIDEOGRAPHER", required: true }],
      overrideReason: "trust me",
    });
    expect(res).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("the production board flags conflicts", async () => {
    const board = await listShootsForAdmin(A, { date: "2026-12-05", conflicts: "1" });
    expect(board.items.length).toBeGreaterThanOrEqual(2);
    expect(board.items.every((i) => i.conflicts.length > 0)).toBe(true);
  });

  it("finished shoots no longer double-book anyone (board and scheduling)", async () => {
    const first = await shoot(slot("2026-12-20", "10:00", "12:00"));
    const second = await shoot({ ...slot("2026-12-20", "11:00", "13:00", adidas), overrideReason: "Covering both" });
    const rahulActor = await actorOf(rahul);
    await startShoot(rahulActor, first.id);
    await completeMyPart(rahulActor, first.id);
    const board = await listShootsForAdmin(A, { date: "2026-12-20" });
    expect(board.items.find((i) => i.id === first.id)?.conflicts).toEqual([]);
    expect(board.items.find((i) => i.id === second.id)?.conflicts).toEqual([]);
    await expect(shoot(slot("2026-12-20", "10:30", "11:30"))).rejects.toMatchObject({ code: "CONFLICT" }); // second still active
    await cancelShoot(A, second.id, "Client postponed");
    await expect(shoot(slot("2026-12-20", "10:30", "11:30"))).resolves.toHaveProperty("id");
  });

  it("rescheduling into a conflict is detected; history is preserved on the same shoot", async () => {
    await shoot(slot("2026-12-10", "09:00", "10:00"));
    const { id } = await shoot(slot("2026-12-11", "09:00", "10:00"));
    await expect(
      rescheduleShoot(A, { shootId: id, date: "2026-12-10", startTime: "09:30", endTime: "11:00", locationName: "Gurgaon Studio", locationAddress: null, reason: null } as never),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await rescheduleShoot(A, { shootId: id, date: "2026-12-12", startTime: "14:00", endTime: "16:00", locationName: "Delhi Studio", locationAddress: null, reason: "Client moved" } as never);
    const doc = await ShootModel.findById(id).lean();
    expect(doc).toMatchObject({ date: "2026-12-12", startTime: "14:00", location: { name: "Delhi Studio" } });
    expect(doc!.rescheduleHistory[0]).toMatchObject({ from: { date: "2026-12-11", location: { name: "Gurgaon Studio" } }, reason: "Client moved" });
    expect(await ShootModel.countDocuments({ title: "Studio shoot", date: "2026-12-11" })).toBe(0); // no new shoot
    const log = await ActivityLogModel.findOne({ action: "shoot.rescheduled", "entity.id": id }).lean();
    expect(log?.meta).toMatchObject({ from: { startTime: "09:00" }, to: { startTime: "14:00" } });
  });
});

// ── Lifecycle & task integration ──────────────────────────────────────────
describe("lifecycle and route integration", () => {
  it("route tasks after the SHOOT step wait for the shoot (no fake shoot task)", async () => {
    const c = await brief(mamaearth, "VIDEO"); // SHOOT_THEN_EDIT
    const tasks = await ProductionTaskModel.find({ contentId: c }).sort({ sequence: 1 }).lean();
    expect(tasks.map((t) => [t.taskType, t.status, t.waitingOn])).toEqual([
      ["UPLOAD_RAW", "BLOCKED", "SHOOT"],
      ["EDIT", "BLOCKED", "SHOOT"],
    ]);
    expect(await ProductionTaskModel.countDocuments({ taskType: "SHOOT" as never })).toBe(0);
  });

  it("scheduled → in progress → partially completed → completed; tasks unlocked; content not approved", async () => {
    const video = await brief(mamaearth, "VIDEO");
    const reel = await brief(mamaearth, "REEL");
    const { id } = await shoot({
      contentIds: [video, reel],
      crew: [
        { userId: rahul.id, brandRole: "VIDEOGRAPHER", required: true },
        { userId: karan.id, brandRole: "PHOTOGRAPHER", required: true },
        { userId: vikas.id, brandRole: "ASSISTANT", required: false },
      ],
    });
    const R = await actorOf(rahul);
    await startShoot(R, id);
    expect((await ShootModel.findById(id).lean())?.status).toBe("IN_PROGRESS");
    expect((await ContentModel.findById(video).lean())?.status).toBe("IN_PRODUCTION");

    await completeMyPart(R, id);
    expect((await ShootModel.findById(id).lean())?.status).toBe("PARTIALLY_COMPLETED");
    expect(await ProductionTaskModel.countDocuments({ contentId: video, status: "BLOCKED" })).toBe(2);

    const K = await actorOf(karan);
    await startShoot(K, id); // joins: starts own part
    await completeMyPart(K, id); // final REQUIRED crew (Vikas is optional)
    const done = await ShootModel.findById(id).lean();
    expect(done?.status).toBe("COMPLETED");

    const vt = await ProductionTaskModel.find({ contentId: video }).sort({ sequence: 1 }).lean();
    expect(vt.map((t) => [t.taskType, t.status, t.waitingOn])).toEqual([
      ["UPLOAD_RAW", "TODO", null],
      ["EDIT", "TODO", null],
    ]);
    const rt = await ProductionTaskModel.find({ contentId: reel }).lean();
    expect(rt.map((t) => t.status)).toEqual(["TODO"]);
    for (const c of [video, reel]) {
      const doc = await ContentModel.findById(c).lean();
      expect(doc?.status).toBe("IN_PRODUCTION"); // never approved/posted/completed by a shoot
      expect(doc?.activeShootId).toBeNull();
    }
    const actions = await ActivityLogModel.find({ "entity.id": id }).distinct("action");
    expect(actions).toEqual(
      expect.arrayContaining(["shoot.started", "shoot.crew_started", "shoot.crew_completed", "shoot.partially_completed", "shoot.completed"]),
    );
  });

  it("creates a missing next route task on completion", async () => {
    const c = await brief(mamaearth, "REEL");
    await ProductionTaskModel.updateMany({ contentId: c }, { $set: { status: "CANCELLED" } });
    const { id } = await shoot({ contentIds: [c] });
    const R = await actorOf(rahul);
    await startShoot(R, id);
    await completeMyPart(R, id);
    const live = await ProductionTaskModel.find({ contentId: c, status: { $ne: "CANCELLED" } }).lean();
    expect(live.map((t) => [t.taskType, t.status])).toEqual([["UPLOAD_FINAL", "TODO"]]);
  });

  it("waiting tasks can't be started by assignees before the shoot", async () => {
    const c = await brief(mamaearth, "REEL");
    const t = await ProductionTaskModel.findOne({ contentId: c }).lean();
    await ProductionTaskModel.updateOne({ _id: t!._id }, { $set: { assignedTo: new Types.ObjectId(rahul.id) } });
    await expect(updateTaskStatus(await actorOf(rahul), String(t!._id), "IN_PROGRESS")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cancelled shoots cannot start; completed shoots cannot restart", async () => {
    const a = await shoot();
    await cancelShoot(A, a.id, "Rain");
    await expect(startShoot(A, a.id)).rejects.toMatchObject({ code: "CONFLICT" });
    const b = await shoot();
    const R = await actorOf(rahul);
    await startShoot(R, b.id);
    await completeMyPart(R, b.id);
    await expect(startShoot(A, b.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cancellation preserves content, tasks and crew history; content is freed", async () => {
    const c = await brief(mamaearth, "VIDEO");
    const { id } = await shoot({ contentIds: [c] });
    await cancelShoot(A, id, "Client postponed");
    const doc = await ShootModel.findById(id).lean();
    expect(doc).toMatchObject({ status: "CANCELLED", cancellationReason: "Client postponed" });
    expect(doc!.crew).toHaveLength(1);
    expect(await ProductionTaskModel.countDocuments({ contentId: c })).toBe(2);
    expect((await ContentModel.findById(c).lean())?.activeShootId).toBeNull();
  });

  it("manager can complete on behalf with a reason (audited), never silently", async () => {
    const { id } = await shoot();
    await startShoot(A, id);
    const crewId = String((await ShootModel.findById(id).lean())!.crew[0]!._id);
    await completeCrewOnBehalf(A, id, crewId, "Rahul's phone died");
    expect((await ShootModel.findById(id).lean())?.status).toBe("COMPLETED");
    const log = await ActivityLogModel.findOne({ action: "shoot.crew_completed", "entity.id": id }).lean();
    expect(log?.meta).toMatchObject({ onBehalf: true, reason: "Rahul's phone died" });
  });

  it("removing incomplete optional crew keeps history and may complete the shoot", async () => {
    const { id } = await shoot({
      crew: [
        { userId: rahul.id, brandRole: "VIDEOGRAPHER", required: true },
        { userId: karan.id, brandRole: "PHOTOGRAPHER", required: true },
      ],
    });
    const R = await actorOf(rahul);
    await startShoot(R, id);
    await completeMyPart(R, id);
    const karanEntry = (await ShootModel.findById(id).lean())!.crew.find((c) => String(c.userId) === karan.id)!;
    await removeCrew(A, id, String(karanEntry._id));
    const doc = await ShootModel.findById(id).lean();
    expect(doc?.status).toBe("COMPLETED");
    expect(doc!.crew.find((c) => String(c.userId) === karan.id)?.status).toBe("CANCELLED");
  });
});

// ── Access & security ─────────────────────────────────────────────────────
describe("access and security", () => {
  let mine: string, notMine: string, adidasShoot: string;
  beforeAll(async () => {
    mine = (await shoot()).id;
    notMine = (await shoot({ crew: [{ userId: karan.id, brandRole: "PHOTOGRAPHER", required: true }] })).id;
    adidasShoot = (await shoot({ brandId: adidas, crew: [{ userId: priya.id, brandRole: "VIDEOGRAPHER", required: true }] })).id;
  });

  it("crew can access their shoot; brand membership alone grants nothing", async () => {
    const R = await actorOf(rahul);
    expect((await getShootForStaff(R, mine)).myRole).toBe("VIDEOGRAPHER");
    await expect(getShootForStaff(R, notMine)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(startShoot(R, notMine)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("staff cannot reach another brand's shoot, admin pages, or cross-agency/tampered ids", async () => {
    const R = await actorOf(rahul);
    await expect(getShootForStaff(R, adidasShoot)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getShootForAdmin(R, mine)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const F = await actorOf(foreignAdmin);
    await expect(getShootForAdmin(F, mine)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getShootForAdmin(A, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getShootForAdmin(A, new Types.ObjectId().toHexString())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("clients get no shoot data at all", async () => {
    const C = await actorOf(amit);
    expect(await shootRepo.find(C, {})).toEqual([]);
    await expect(getShootForStaff(C, mine)).rejects.toMatchObject({ code: "NOT_FOUND" });
    as(amit);
    expect(await startShootAction({ shootId: mine })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("staff cannot complete someone else's part or assign crew; actor ids can't be injected", async () => {
    as(rahul);
    expect(await completeMyPartAction({ shootId: notMine })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const spoof = await completeMyPartAction({ shootId: mine, userId: karan.id } as never);
    expect(spoof).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await addCrewAction({ shootId: mine, userId: rahul.id, brandRole: "VIDEOGRAPHER", required: true })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("removed crew lose access immediately; removed membership too", async () => {
    const { id } = await shoot({
      crew: [
        { userId: rahul.id, brandRole: "VIDEOGRAPHER", required: true },
        { userId: karan.id, brandRole: "PHOTOGRAPHER", required: true },
      ],
    });
    const K = await actorOf(karan);
    expect((await getShootForStaff(K, id)).id).toBe(id);
    const entry = (await ShootModel.findById(id).lean())!.crew.find((c) => String(c.userId) === karan.id)!;
    await removeCrew(A, id, String(entry._id));
    await expect(getShootForStaff(K, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("My Day lists only the actor's own crew shoots, even for managers", async () => {
    const R = await actorOf(rahul);
    const list = await listMyShoots(R, "2026-11-01", "2027-12-31");
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((s) => s.myRole)).toBe(true);
    expect(await listMyShoots(A, "2026-11-01", "2027-12-31")).toEqual([]); // admin isn't crew anywhere
  });

  it("staff shoot view exposes no internal audit/notes of other entities or contact details", async () => {
    const dto = await getShootForStaff(await actorOf(rahul), mine);
    const json = JSON.stringify(dto);
    expect(json).not.toContain(rahul.email);
    expect(json).not.toContain("history");
    expect(Object.keys(dto.crew[0]!).sort()).toEqual(["brandRole", "id", "image", "isMe", "name", "status"]);
  });

  it("shoot mutations roll back with their audit entry", async () => {
    const before = await ShootModel.countDocuments();
    const spy = vi.spyOn(ActivityLogModel, "create").mockRejectedValueOnce(new Error("audit store down"));
    await expect(shoot()).rejects.toThrow("audit store down");
    spy.mockRestore();
    expect(await ShootModel.countDocuments()).toBe(before);
  });
});

describe("content removal and re-adding", () => {
  it("content can be re-added after its shoot completes (reshoot)", async () => {
    const c = await brief(mamaearth);
    const first = await shoot({ contentIds: [c] });
    const R = await actorOf(rahul);
    await startShoot(R, first.id);
    await completeMyPart(R, first.id);
    const second = await shoot();
    await addShootContent(A, second.id, c);
    expect(String((await ContentModel.findById(c).lean())?.activeShootId)).toBe(second.id);
  });
});
