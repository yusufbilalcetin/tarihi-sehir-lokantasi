"use client";

import Link from "next/link";
import { KeyRound, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogoutButton } from "@/components/staff/logout-button";
import { StaffAttendanceCard } from "@/components/staff/staff-attendance-card";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { STAFF_ROLE_LABELS } from "@/lib/domain/staff-accounts";
import { getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Everything about the person, and nothing about the floor.
 *
 * Clocking in and next week's shifts used to sit directly underneath the table
 * grid, so scrolling past the last table on a busy service landed a waiter on
 * "Mesaiye Başla". They are personal, not operational: they belong behind this
 * tab, where looking at them is a decision rather than an accident.
 *
 * `StaffAttendanceCard` is reused exactly as it was — the attendance and
 * schedule calls are untouched, only where they are shown has moved.
 */
export function StaffProfileView({ className }: { readonly className?: string }) {
  const { name, role } = useStaffSession();

  return (
    <div className={cn("space-y-4", className)}>
      <section
        className="flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface-raised p-4"
        aria-label="Hesap"
      >
        <Avatar className="size-12 border border-copper/30">
          <AvatarFallback className="bg-sidebar-accent text-gold">{getInitials(name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate font-heading text-lg font-semibold text-text-primary">{name}</p>
          <p className="text-sm text-text-muted">{STAFF_ROLE_LABELS[role]}</p>
        </div>
      </section>

      {/* Mesai + Yaklaşan vardiyalarım, unchanged. */}
      <StaffAttendanceCard />

      <section className="space-y-2" aria-label="Hesap işlemleri">
        <Link
          href="/staff/set-password"
          className={cn(
            "motion-press flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-border-subtle bg-surface-raised px-4 text-sm font-semibold text-text-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
          )}
        >
          <KeyRound className="size-4 shrink-0 text-olive" strokeWidth={1.9} aria-hidden="true" />
          Şifremi değiştir
        </Link>
        <LogoutButton className="min-h-12 w-full justify-center rounded-xl border border-border-subtle" />
      </section>
    </div>
  );
}

/** The tab's icon, kept beside the view it opens. */
export const PROFILE_TAB_ICON = UserRound;
