import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { model, Schema, Types } from "mongoose";
import { SystemRole } from "@/lib/domain/roles";
import type { Actor } from "@/server/authz/actor";
import { brandVisibility, type BrandAccessResolver } from "@/server/repositories/brand-visibility";
import { connectDb, disconnectDb } from "@/server/db/connect";
import { defineScopedRepository } from "@/server/repositories/scoped-repository";

/**
 * Exercises the visibility architecture that every brand-owned repository
 * (content, shoots, references, expenses…) will use. A probe collection
 * stands in for Content until Stage 3; the rules under test are the real
 * production ones (scoped-repository + brandVisibility).
 */
interface ProbeDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  brandId: Types.ObjectId;
  title: string;
  internalNote: string;
}
const ProbeModel = model<ProbeDoc>(
  "ScopeProbe",
  new Schema<ProbeDoc>({
    agencyId: { type: Schema.Types.ObjectId, required: true },
    brandId: { type: Schema.Types.ObjectId, required: true },
    title: String,
    internalNote: String,
  }),
);

const agencyA = new Types.ObjectId();
const agencyB = new Types.ObjectId();
const mamaearth = new Types.ObjectId();
const adidas = new Types.ObjectId();
const foreignBrand = new Types.ObjectId();

const actor = (role: SystemRole, agencyId = agencyA, userId = new Types.ObjectId()): Actor => ({
  userId: String(userId),
  agencyId: String(agencyId),
  systemRole: role,
  name: role,
  email: `${role}@example.test`,
  image: null,
});

// Stand-in membership table for Stage 2's BrandMembership.
const memberships = new Map<string, string[]>();
const resolver: BrandAccessResolver = { brandIdsFor: async (a) => memberships.get(a.userId) ?? [] };

const repo = defineScopedRepository<ProbeDoc>({
  model: ProbeModel,
  visibility: (a) => brandVisibility<ProbeDoc>(a, resolver),
});

const ids: Record<string, string> = {};

beforeAll(async () => {
  await connectDb();
  const docs = await ProbeModel.insertMany([
    { agencyId: agencyA, brandId: mamaearth, title: "Mamaearth Reel 01", internalNote: "n" },
    { agencyId: agencyA, brandId: adidas, title: "Adidas Reel 01", internalNote: "n" },
    { agencyId: agencyB, brandId: foreignBrand, title: "Other agency post", internalNote: "n" },
  ]);
  ids.mamaearth = String(docs[0]!._id);
  ids.adidas = String(docs[1]!._id);
  ids.foreign = String(docs[2]!._id);
});

afterAll(async () => {
  await disconnectDb();
});

describe("brand visibility", () => {
  it("admin and manager see every brand in their own agency only", async () => {
    for (const role of [SystemRole.ADMIN, SystemRole.MANAGER]) {
      const titles = (await repo.find(actor(role))).map((d) => d.title).sort();
      expect(titles).toEqual(["Adidas Reel 01", "Mamaearth Reel 01"]);
    }
  });

  it("client of Mamaearth sees Mamaearth only and gets 404 for Adidas", async () => {
    const c = actor(SystemRole.CLIENT);
    memberships.set(c.userId, [String(mamaearth)]);
    expect((await repo.find(c)).map((d) => d.title)).toEqual(["Mamaearth Reel 01"]);
    expect(await repo.findById(c, ids.adidas!)).toBeNull();
    await expect(repo.getById(c, ids.adidas!)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("staff without memberships see nothing (fail closed)", async () => {
    const s = actor(SystemRole.STAFF);
    expect(await repo.find(s)).toEqual([]);
    expect(await repo.count(s)).toBe(0);
    expect(await repo.findById(s, ids.mamaearth!)).toBeNull();
  });

  it("a membership in another agency's brand grants nothing", async () => {
    const c = actor(SystemRole.CLIENT);
    memberships.set(c.userId, [String(foreignBrand)]);
    expect(await repo.find(c)).toEqual([]);
    expect(await repo.findById(c, ids.foreign!)).toBeNull();
  });
});

describe("caller filters can narrow but never widen scope", () => {
  it("injecting brandId / agencyId / $or does not escape", async () => {
    const c = actor(SystemRole.CLIENT);
    memberships.set(c.userId, [String(mamaearth)]);
    expect(await repo.find(c, { brandId: adidas })).toEqual([]);
    expect(await repo.find(c, { agencyId: agencyB })).toEqual([]);
    expect(await repo.find(c, { $or: [{ brandId: adidas }, { brandId: foreignBrand }] })).toEqual(
      [],
    );
  });

  it("an admin cannot reach another agency's record by id", async () => {
    expect(await repo.findById(actor(SystemRole.ADMIN), ids.foreign!)).toBeNull();
  });

  it("updates outside scope match nothing and change nothing", async () => {
    const c = actor(SystemRole.CLIENT);
    memberships.set(c.userId, [String(mamaearth)]);
    expect(await repo.updateById(c, ids.adidas!, { $set: { title: "pwned" } })).toBeNull();
    expect((await ProbeModel.findById(ids.adidas).lean())?.title).toBe("Adidas Reel 01");
  });

  it("malformed ids return null rather than throwing", async () => {
    const a = actor(SystemRole.ADMIN);
    for (const bad of ["", "123", "not-an-id", '{"$ne":null}', "zzzzzzzzzzzzzzzzzzzzzzzz"]) {
      expect(await repo.findById(a, bad)).toBeNull();
    }
  });

  it("create() forces agencyId from the actor", async () => {
    const a = actor(SystemRole.ADMIN);
    const doc = await repo.create(a, {
      brandId: mamaearth,
      title: "new",
      internalNote: "",
      agencyId: agencyB,
    } as never);
    expect(String(doc.agencyId)).toBe(String(agencyA));
  });
});
