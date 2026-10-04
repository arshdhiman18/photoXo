/**
 * Typed domain errors. Services throw these; the action wrapper and pages map
 * them to responses. Messages are safe to show to the user.
 */
import type { ActionErrorCode } from "@/lib/action-result";

export type AppErrorCode = ActionErrorCode;

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super("UNAUTHENTICATED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that.") {
    super("FORBIDDEN", message);
  }
}

/**
 * Used for anything outside the actor's visibility scope — including records
 * that exist but belong to someone else — so existence is never leaked.
 */
export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super("NOT_FOUND", message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super("VALIDATION", message, fieldErrors);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
