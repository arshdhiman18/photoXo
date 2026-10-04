import "server-only";
import { Types } from "mongoose";
import type { Actor } from "@/server/authz/actor";
import { connectDb } from "@/server/db/connect";
import { AgencyModel, type AgencyDoc } from "@/server/db/models";

/** An actor can only ever read their own agency. */
export async function getOwnAgency(actor: Actor): Promise<AgencyDoc | null> {
  await connectDb();
  return AgencyModel.findById(new Types.ObjectId(actor.agencyId)).lean<AgencyDoc>().exec();
}

export async function getAgencyById(agencyId: Types.ObjectId): Promise<AgencyDoc | null> {
  await connectDb();
  return AgencyModel.findById(agencyId).lean<AgencyDoc>().exec();
}

/** Bootstrap only. */
export async function countAgencies(): Promise<number> {
  await connectDb();
  return AgencyModel.estimatedDocumentCount();
}

export async function insertAgency(
  data: Pick<AgencyDoc, "name" | "slug" | "timezone" | "currency">,
) {
  await connectDb();
  return (await AgencyModel.create(data)).toObject();
}
