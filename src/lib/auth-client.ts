"use client";

import { createAuthClient } from "better-auth/react";

/** Browser client for Better Auth's HTTP endpoints (same origin). */
export const authClient = createAuthClient();
