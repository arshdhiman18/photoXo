import "server-only";
import { isValidObjectId, Types, type Model, type QueryFilter, type UpdateQuery } from "mongoose";
import type { Actor } from "@/server/authz/actor";
import { NotFoundError } from "@/server/authz/errors";
import { connectDb } from "@/server/db/connect";

/**
 * Visibility rule: given the actor, return the extra filter that limits what
 * they may see, or `NONE` when they may see nothing at all. Rules may be
 * async (e.g. to resolve brand memberships).
 */
export const NONE = Symbol("visibility:none");
export type Visibility<T> = QueryFilter<T> | typeof NONE;
export type VisibilityRule<T> = (actor: Actor) => Visibility<T> | Promise<Visibility<T>>;

export interface FindOptions {
  sort?: Record<string, 1 | -1>;
  skip?: number;
  limit?: number;
  projection?: Record<string, 0 | 1>;
}

const MAX_LIMIT = 200;

export function toObjectId(id: string): Types.ObjectId | null {
  return isValidObjectId(id) && Types.ObjectId.isValid(id) && String(new Types.ObjectId(id)) === id
    ? new Types.ObjectId(id)
    : null;
}

/** For already-validated ids (Zod objectIdString). Throws NotFound otherwise. */
export function asObjectId(id: string): Types.ObjectId {
  const oid = toObjectId(id);
  if (!oid) throw new NotFoundError();
  return oid;
}

/**
 * Builds a repository whose every read and write is constrained to
 *   { agencyId: actor.agencyId } AND visibility(actor) AND callerFilter
 * combined with `$and`, so a caller-supplied filter can narrow results but
 * can never widen them (e.g. passing `agencyId` or `_id` of someone else's
 * record simply matches nothing).
 *
 * This is the only sanctioned way to query tenant data; ESLint forbids
 * importing models outside src/server/repositories.
 */
export function defineScopedRepository<T extends { agencyId: Types.ObjectId }>(config: {
  model: Model<T>;
  visibility: VisibilityRule<T>;
}) {
  const { model, visibility } = config;

  async function scope(actor: Actor): Promise<QueryFilter<T> | null> {
    const agencyId = toObjectId(actor.agencyId);
    if (!agencyId) return null;
    const v = await visibility(actor);
    if (v === NONE) return null;
    return { $and: [{ agencyId } as QueryFilter<T>, v] } as QueryFilter<T>;
  }

  async function scoped(actor: Actor, filter?: QueryFilter<T>): Promise<QueryFilter<T> | null> {
    await connectDb();
    const base = await scope(actor);
    if (!base) return null;
    return filter ? ({ $and: [base, filter] } as QueryFilter<T>) : base;
  }

  return {
    async find(actor: Actor, filter?: QueryFilter<T>, options: FindOptions = {}): Promise<T[]> {
      const f = await scoped(actor, filter);
      if (!f) return [];
      const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_LIMIT);
      const q = model.find(f, options.projection).limit(limit);
      if (options.sort) q.sort(options.sort);
      if (options.skip) q.skip(Math.max(options.skip, 0));
      return (await q.lean().exec()) as T[];
    },

    async count(actor: Actor, filter?: QueryFilter<T>): Promise<number> {
      const f = await scoped(actor, filter);
      return f ? model.countDocuments(f).exec() : 0;
    },

    /** Returns null for malformed ids and for records outside scope. */
    async findById(actor: Actor, id: string): Promise<T | null> {
      const _id = toObjectId(id);
      if (!_id) return null;
      const f = await scoped(actor, { _id } as QueryFilter<T>);
      if (!f) return null;
      return (await model.findOne(f).lean().exec()) as T | null;
    },

    /** Like findById but throws NotFoundError (→ 404) when out of scope. */
    async getById(actor: Actor, id: string): Promise<T> {
      const doc = await this.findById(actor, id);
      if (!doc) throw new NotFoundError();
      return doc;
    },

    /**
     * Conditional update constrained by scope. `where` adds optimistic
     * preconditions (e.g. `{ status: "ACTIVE" }`). Returns the updated doc or
     * null if nothing in scope matched.
     */
    async updateById(
      actor: Actor,
      id: string,
      update: UpdateQuery<T>,
      where?: QueryFilter<T>,
      options: { arrayFilters?: Record<string, unknown>[] } = {},
    ): Promise<T | null> {
      const _id = toObjectId(id);
      if (!_id) return null;
      const conditions: QueryFilter<T> = where
        ? ({ $and: [{ _id }, where] } as QueryFilter<T>)
        : ({ _id } as QueryFilter<T>);
      const f = await scoped(actor, conditions);
      if (!f) return null;
      return (await model
        .findOneAndUpdate(f, update, {
          returnDocument: "after",
          runValidators: true,
          ...(options.arrayFilters ? { arrayFilters: options.arrayFilters } : {}),
        })
        .lean()
        .exec()) as T | null;
    },

    /** Insert with `agencyId` forced from the actor (input can never set it). */
    async create(actor: Actor, data: Omit<Partial<T>, "agencyId" | "_id">): Promise<T> {
      await connectDb();
      const agencyId = toObjectId(actor.agencyId);
      if (!agencyId) throw new NotFoundError();
      // Generic Mongoose create typing cannot express "T minus agencyId"; the
      // runtime contract (agencyId forced from the actor) is what matters.
      const [doc] = await model.insertMany([{ ...data, agencyId } as unknown as T]);
      if (!doc) throw new Error("insert failed");
      return (doc as unknown as { toObject(): T }).toObject();
    },
  };
}

export type ScopedRepository<T extends { agencyId: Types.ObjectId }> = ReturnType<
  typeof defineScopedRepository<T>
>;
