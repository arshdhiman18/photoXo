/** Result shape returned by every Server Action (safe to import from client code). */
export type ActionErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: ActionErrorCode;
        message: string;
        fieldErrors?: Record<string, string[]>;
        /** Machine-readable details (e.g. scheduling conflicts) — never secrets. */
        details?: unknown;
      };
    };
