"use client";

import { Store } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LogoutButton } from "@/components/staff/logout-button";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { STAFF_ROLE_LABELS } from "@/lib/domain/display";
import { getInitials } from "@/lib/format";

/**
 * Who is signed in, where, and the way out.
 *
 * The guest-menu entry lives here because it is about this session's
 * restaurant rather than about any one screen. It is absent, not disabled,
 * where the launcher is switched off.
 */
export function AdminProfileDialog({
  open,
  onOpenChange,
  onOpenQrMenu,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenQrMenu: (() => void) | null;
}) {
  const { name, role, restaurantName } = useStaffSession();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-admin-shell className="gap-5 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold">Hesap</DialogTitle>
          <DialogDescription className="sr-only">Oturum açan kişi ve işletmesi.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[13px] font-semibold text-foreground"
          >
            {getInitials(name)}
          </span>
          <p className="min-w-0 truncate text-[15px] font-semibold text-foreground">{name}</p>
        </div>

        <dl className="divide-y divide-border border-y border-border text-[13px]">
          <div className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-muted-foreground">Görevi</dt>
            <dd className="font-medium text-foreground">{STAFF_ROLE_LABELS[role]}</dd>
          </div>
          {restaurantName ? (
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-muted-foreground">İşletme</dt>
              <dd className="min-w-0 truncate font-medium text-foreground">{restaurantName}</dd>
            </div>
          ) : null}
        </dl>

        {onOpenQrMenu ? (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              onOpenChange(false);
              onOpenQrMenu();
            }}
            className="motion-press -mx-3 flex min-h-11 items-center gap-3 rounded-lg px-3 text-[14px] font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Store className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            QR Menüyü Gör
          </button>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-muted-foreground">Bu cihazdaki oturumu kapatın.</p>
          <LogoutButton className="shrink-0 border border-border text-foreground hover:bg-muted [&_svg]:size-4" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
