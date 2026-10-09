"use client";

import { createAuthClient } from "better-auth/react";

/**
 * The browser's door to Better Auth: sign up, sign in and sign out call /api/auth/* on the same origin. It holds no secret
 * and no session of its own (the session is an httpOnly cookie the browser cannot read).
 */
export const authClient = createAuthClient();
