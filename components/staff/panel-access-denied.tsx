import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";

const PANEL_NAMES: Record<string, string> = {
  admin: "Yönetim paneli",
  staff: "Garson paneli",
  kitchen: "Mutfak ekranı",
  cashier: "Kasa paneli",
};

const HOME_NAMES: Record<string, string> = {
  "/admin/dashboard": "Yönetim paneline",
  "/staff/dashboard": "Garson paneline",
  "/kitchen": "Mutfak ekranına",
  "/cashier": "Kasa paneline",
};

/**
 * Shown in place of a panel the signed-in account may not open.
 *
 * It deliberately stays on the requested URL and offers a way out instead of
 * redirecting: bouncing someone to a different panel makes a permission
 * boundary look like a broken link, and the panel they were denied would flash
 * on screen first while the redirect resolved on the client.
 */
export function PanelAccessDenied({
  area,
  roleLabel,
  home,
}: {
  area: string;
  roleLabel: string;
  home: string;
}) {
  const panel = PANEL_NAMES[area] ?? "Bu panel";
  const homeName = HOME_NAMES[home] ?? "kendi panelinize";

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-olive px-4 py-10 text-[#FFFDF8]">
      <section className="w-full max-w-md rounded-3xl border border-gold/25 bg-[#FFF9EF] p-7 text-center text-foreground shadow-2xl shadow-black/20 sm:p-9">
        <BrandMark className="mx-auto max-w-[17rem]" />
        <div className="mx-auto mt-7 flex size-14 items-center justify-center rounded-2xl border border-copper/30 bg-copper/10 text-burgundy">
          <ShieldAlert className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-5 font-heading text-2xl font-semibold">
          Bu panele erişim yetkiniz yok
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {panel}, {roleLabel} hesabınıza kapalı. Yetkiniz olması gerekiyorsa
          yöneticinize başvurun.
        </p>
        <Button
          render={<Link href={home} />}
          nativeButton={false}
          className="mt-6 h-11 w-full"
        >
          {homeName} dön
        </Button>
      </section>
    </main>
  );
}
