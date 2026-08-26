/**
 * Supabase SSR deliberately keeps Auth cookies browser-readable so its client
 * can refresh the session. Production transport is still HTTPS-only, while
 * authorization always verifies the user server-side with auth.getUser().
 */
export const SUPABASE_AUTH_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  httpOnly: false,
  secure: process.env.NODE_ENV === "production",
} as const;
