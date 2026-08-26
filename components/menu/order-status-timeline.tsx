"use client";

import { Check, ChefHat, ClipboardCheck, ConciergeBell, Flame, Utensils } from "lucide-react";

import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { cn } from "@/lib/utils";

/**
 * Where the guest's order is, in the guest's words.
 *
 * The database calls these NEW, CONFIRMED, PREPARING, READY and SERVED. None
 * of that appears here: a guest is told about *their* order, and the stage
 * names come from the same translation catalogue as the rest of the menu, so
 * this reads correctly in all 109 languages.
 *
 * Three states, each carried by shape as well as colour — a tick for done, a
 * filled ring for the stage in progress, a hollow one for what is still ahead.
 * Colour alone would fail anyone who cannot separate the olive from the grey.
 */

const STEPS = [
  { key: "orderReceived", icon: ClipboardCheck },
  { key: "waiterConfirmed", icon: ConciergeBell },
  { key: "preparing", icon: Flame },
  { key: "ready", icon: ChefHat },
  { key: "served", icon: Utensils },
] as const;

export function OrderStatusTimeline({ currentStep = 2 }: { currentStep?: number }) {
  const { direction, t } = useMenuPreferences();

  return (
    <ol className="mt-5 space-y-0" aria-label={t("orderStatus")}>
      {STEPS.map((step, index) => {
        const done = index < currentStep;
        const active = index === currentStep;
        const Icon = step.icon;
        const label = t(step.key);

        return (
          <li
            key={step.key}
            // `aria-current` is announced by the screen reader in the user's
            // own language. A hand-written "in progress" string would ship
            // untranslated to 108 of the 109 locales.
            aria-current={active ? "step" : undefined}
            className="relative flex min-h-14 gap-3"
          >
            {index < STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-9 h-6 w-0.5 rounded-full",
                  direction === "rtl" ? "right-[15px]" : "left-[15px]",
                  done ? "bg-order-ready" : "bg-border-strong",
                )}
              />
            ) : null}

            <span
              aria-hidden="true"
              className={cn(
                "relative flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                done && "border-order-ready bg-order-ready text-white",
                active && "border-order-preparing bg-order-preparing-tint text-order-preparing",
                !done && !active && "border-border-strong bg-surface-raised text-text-muted",
              )}
            >
              {done ? <Check className="size-4" strokeWidth={2.6} /> : <Icon className="size-4" strokeWidth={2} />}
            </span>

            <div className="pt-1">
              <p
                className={cn(
                  "text-sm font-semibold",
                  active && "text-order-preparing",
                  done && "text-text-primary",
                  !done && !active && "text-text-muted",
                )}
              >
                {label}
              </p>
              {active ? (
                <p className="mt-0.5 text-xs leading-5 text-text-secondary">{t("preparingDescription")}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
