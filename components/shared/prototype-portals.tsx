"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChefHat,
  CookingPot,
  LayoutDashboard,
  ScanLine,
  WalletCards,
} from "lucide-react";

import { DemoTablePicker } from "@/components/shared/demo-table-picker";
import { cn } from "@/lib/utils";

/**
 * The prototype launcher tiles.
 *
 * The customer tile no longer points at a fixed table: where the launcher is
 * switched on it opens the picker, which reads the restaurant's live table
 * list. Every other tile is an ordinary link to a panel that guards itself.
 *
 * Whether it is switched on is `isDemoLauncherEnabled`'s decision alone, taken
 * on the server from that deployment's own switch — this file is a client
 * component and never looks. Where it is off `/api/demo/tables` is shut too,
 * and the tile used to open the picker
 * anyway — the guest pressed it and was handed "Masa seçimi şu anda
 * kullanılamıyor.", an error for a button that could never work. There it is
 * simply not a button: a guest reaches the menu by scanning the code on their
 * table, so that is what it says.
 */

/**
 * Every tile points at the panel it names. Each panel guards itself: an
 * unauthenticated visitor is sent to the login page, and a signed-in account
 * whose role cannot open that panel is sent to its own home instead. The
 * waiter tile used to point at `/staff/login`, which made it behave unlike the
 * other three — signing in there landed on whichever panel the account owned,
 * so the tile appeared to open the wrong screen.
 */
const staffPortals = [
  {
    href: "/staff/dashboard",
    title: "Garson Paneli",
    description: "Personel girişi gerekir",
    icon: ChefHat,
  },
  { href: "/kitchen", title: "Mutfak Ekranı", description: "Personel girişi gerekir", icon: CookingPot },
  { href: "/cashier", title: "Kasa Paneli", description: "Personel girişi gerekir", icon: WalletCards },
  {
    href: "/admin/dashboard",
    title: "Yönetici Paneli",
    description: "Yönetici girişi gerekir",
    icon: LayoutDashboard,
  },
];

/** The card itself, shared by the tiles that act and the one that informs. */
const tileSurface =
  "flex min-h-44 flex-col justify-between rounded-xl border border-white/10 bg-white/[0.055] p-5 text-left";

/** Added only where there is something to press. */
const tileInteractive =
  "group transition-colors hover:border-copper/60 hover:bg-white/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper";

export function PrototypePortals({ demoLauncherEnabled }: { demoLauncherEnabled: boolean }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {demoLauncherEnabled ? (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className={cn(tileSurface, tileInteractive)}
            aria-haspopup="dialog"
          >
            <ScanLine className="size-6 text-copper" strokeWidth={1.6} aria-hidden="true" />
            <div>
              <h2 className="font-heading text-xl font-semibold">Müşteri QR Menü</h2>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[#F5EBDD]/60">
                <span>Aktif masalardan birini seçin</span>
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </button>
        ) : (
          /* Not a button, not disabled, not an error: an ordinary card that
             says how the menu is actually reached. No arrow and no pointer,
             because there is nothing here to press. */
          <div className={tileSurface}>
            <ScanLine className="size-6 text-copper" strokeWidth={1.6} aria-hidden="true" />
            <div>
              <h2 className="font-heading text-xl font-semibold">Müşteri QR Menü</h2>
              <p className="mt-2 text-xs leading-5 text-[#F5EBDD]/60">
                Menüyü görüntülemek için masanızdaki QR kodunu okutun.
              </p>
            </div>
          </div>
        )}

        {staffPortals.map(({ href, title, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${title} (yeni sekmede açılır)`}
            className={cn(tileSurface, tileInteractive)}
          >
            <Icon className="size-6 text-copper" strokeWidth={1.6} aria-hidden="true" />
            <div>
              <h2 className="font-heading text-xl font-semibold">{title}</h2>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[#F5EBDD]/60">
                <span>{description}</span>
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Never mounted where it could not load anything. */}
      {demoLauncherEnabled ? (
        <DemoTablePicker open={pickerOpen} onOpenChange={setPickerOpen} />
      ) : null}
    </>
  );
}
