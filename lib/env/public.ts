import {
  parseOptionalPublicEnvironment,
  type EnvironmentSource,
  type PublicEnvironment,
} from "./validation";

// Keep NEXT_PUBLIC_* access static so Next.js can inline it into browser bundles.
function browserEnvironmentSource(): EnvironmentSource {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}
/**
 * Build-safe accessor for optional integrations. No validation runs at module load.
 * It returns null only when all Supabase public variables are absent; partial or
 * malformed configuration still fails loudly.
 */
export function getOptionalPublicEnvironment(): PublicEnvironment | null {
  return parseOptionalPublicEnvironment(browserEnvironmentSource());
}
