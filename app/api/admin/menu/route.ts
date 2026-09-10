import type { NextResponse } from "next/server";

import { adminRead, createAdminMenuService } from "@/lib/api/admin-route";
import { resolveTranslationProvider } from "@/lib/i18n/translation-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The menu an administrator edits, plus whether automatic translation can be
 * offered at all. The flag rides along with the menu rather than sitting on its
 * own endpoint: the panel already asks for this payload, and a button that is
 * disabled the moment it is drawn beats one that fails when it is pressed.
 */
export function GET(): Promise<NextResponse> {
  return adminRead("api.admin.menu", async ({ principal }) => ({
    ...(await createAdminMenuService().getMenu(principal)),
    autoTranslateAvailable: resolveTranslationProvider().available,
  }));
}
