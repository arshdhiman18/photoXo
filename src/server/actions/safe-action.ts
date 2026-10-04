import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import type { Actor } from "@/server/authz/actor";
import type { ActionResult } from "@/lib/action-result";
import { ForbiddenError, isAppError, type AppErrorCode } from "@/server/authz/errors";
import { requireActor } from "@/server/auth/session";

function fail(
  code: AppErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
  details?: unknown,
): ActionResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(fieldErrors ? { fieldErrors } : {}),
      ...(details !== undefined ? { details } : {}),
    },
  };
}

function toFailure(error: unknown): ActionResult<never> {
  unstable_rethrow(error); // let redirect()/notFound() propagate
  if (isAppError(error)) return fail(error.code, error.message, error.fieldErrors, error.details);
  console.error("[action] unexpected error", error);
  return fail("INTERNAL", "Something went wrong. Please try again.");
}

function parse<S extends z.ZodType>(schema: S, raw: unknown) {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true as const, data: parsed.data };
  const { fieldErrors } = z.flattenError(parsed.error);
  return {
    ok: false as const,
    failure: fail(
      "VALIDATION",
      "Please check the highlighted fields.",
      fieldErrors as Record<string, string[]>,
    ),
  };
}

export interface AuthedActionOptions {
  /**
   * Coarse capability check evaluated BEFORE input validation, so callers
   * without the capability learn nothing about the input schema (they get
   * FORBIDDEN, never field-level VALIDATION details). Fine-grained,
   * target-aware checks still happen in the service.
   */
  authorize?: (actor: Actor) => boolean;
}

/**
 * The only sanctioned way to define an authenticated Server Action.
 *
 *   1. Resolves the Actor from the verified session (never from input).
 *   2. Applies the coarse capability check (options.authorize), if any.
 *   3. Validates input with a strict Zod schema (unknown keys such as
 *      `userId`, `role` or `agencyId` are rejected, not ignored).
 *   4. Runs the handler, mapping domain errors to a typed result.
 *
 * Server Actions are public HTTP endpoints; authorization is enforced inside
 * the action/service, never by the page that renders the form.
 */
export function authedAction<S extends z.ZodType, R>(
  schema: S,
  handler: (actor: Actor, input: z.output<S>) => Promise<R>,
  options: AuthedActionOptions = {},
): (input: z.input<S>) => Promise<ActionResult<R>> {
  return async (raw) => {
    try {
      const actor = await requireActor();
      if (options.authorize && !options.authorize(actor)) throw new ForbiddenError();
      const parsed = parse(schema, raw);
      if (!parsed.ok) return parsed.failure;
      return { ok: true, data: await handler(actor, parsed.data) };
    } catch (error) {
      return toFailure(error);
    }
  };
}

/** For unauthenticated flows (e.g. invitation acceptance). Same validation and error mapping. */
export function publicAction<S extends z.ZodType, R>(
  schema: S,
  handler: (input: z.output<S>) => Promise<R>,
): (input: z.input<S>) => Promise<ActionResult<R>> {
  return async (raw) => {
    try {
      const parsed = parse(schema, raw);
      if (!parsed.ok) return parsed.failure;
      return { ok: true, data: await handler(parsed.data) };
    } catch (error) {
      return toFailure(error);
    }
  };
}

export type { ActionResult };
