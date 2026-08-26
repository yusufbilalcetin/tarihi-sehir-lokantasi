import "server-only";

import { getSupabaseStorageBucket } from "@/lib/env/server";

/** Lazy runtime bucket selection; defaults to `product-images`. */
export function getConfiguredProductImagesBucket(): string {
  return getSupabaseStorageBucket();
}
