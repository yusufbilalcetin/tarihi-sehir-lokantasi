import { cn } from "@/lib/utils";
import type { OrderStatus, ProductStatus, TableStatus } from "@/types";

/**
 * The one place a state becomes a colour and a word.
 *
 * It used to reach for whatever Tailwind hue was nearest — emerald, sky,
 * violet, cyan, rose — which is what made every panel read as a generic admin
 * template and let a status shout louder than the restaurant's own colours.
 * Every tone below now comes from the order/status tokens, so "hazır" is the
 * same green on the floor, in the kitchen and in a report, and no status can
 * out-shout the brand.
 *
 * Colour is never the only carrier: each badge states its meaning in words,
 * and the shape carries a dot for the states that need finding at a glance.
 */

type Status =
  | OrderStatus
  | ProductStatus
  | TableStatus
  | "open"
  | "assigned"
  | "resolved"
  | "paid";

type Tone =
  | "new"
  | "preparing"
  | "ready"
  | "served"
  | "settled"
  | "void"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral";

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  new: "border-order-new/25 bg-order-new-tint text-order-new",
  preparing: "border-order-preparing/25 bg-order-preparing-tint text-order-preparing",
  ready: "border-order-ready/25 bg-order-ready-tint text-order-ready",
  served: "border-order-served/25 bg-order-served-tint text-order-served",
  settled: "border-order-settled/25 bg-order-settled-tint text-order-settled",
  void: "border-order-void/25 bg-order-void-tint text-order-void",
  success: "border-status-success/25 bg-status-success-tint text-status-success",
  warning: "border-status-warning/25 bg-status-warning-tint text-status-warning",
  danger: "border-status-danger/25 bg-status-danger-tint text-status-danger",
  info: "border-status-info/25 bg-status-info-tint text-status-info",
  neutral: "border-border-strong bg-surface-muted text-text-secondary",
};

/**
 * Wording follows lib/domain/display.ts. These are the *view* statuses the
 * panel adapters emit (lowercase), not the database enums, so the two maps
 * cannot simply be merged — but they must never disagree, which is what
 * tests/foundation/phase36-status-badge.test.ts holds them to.
 */
const STATUS: Readonly<Record<Status, { label: string; tone: Tone; dot?: boolean }>> = {
  // Tables
  available: { label: "Boş", tone: "success" },
  occupied: { label: "Dolu", tone: "neutral" },
  ordering: { label: "Sipariş veriyor", tone: "new" },
  waiting: { label: "Sipariş bekliyor", tone: "new" },
  dining: { label: "Yemekte", tone: "served" },
  "waiter-call": { label: "Garson çağırdı", tone: "danger", dot: true },
  "bill-requested": { label: "Hesap istedi", tone: "warning", dot: true },
  cleaning: { label: "Temizleniyor", tone: "info" },
  // Orders and items
  pending: { label: "Bekliyor", tone: "new" },
  confirmed: { label: "Onaylandı", tone: "new" },
  preparing: { label: "Hazırlanıyor", tone: "preparing", dot: true },
  ready: { label: "Hazır", tone: "ready", dot: true },
  served: { label: "Servis edildi", tone: "served" },
  completed: { label: "Tamamlandı", tone: "settled" },
  cancelled: { label: "İptal edildi", tone: "void" },
  // Catalogue
  active: { label: "Aktif", tone: "success" },
  inactive: { label: "Pasif", tone: "neutral" },
  "sold-out": { label: "Tükendi", tone: "void" },
  // Service requests
  open: { label: "Yeni", tone: "danger", dot: true },
  assigned: { label: "İlgileniliyor", tone: "warning" },
  resolved: { label: "Çözüldü", tone: "success" },
  paid: { label: "Ödendi", tone: "success" },
};

export interface StatusBadgeProps {
  readonly status: Status;
  readonly label?: string;
  readonly size?: "sm" | "md";
  readonly className?: string;
}

export function StatusBadge({ status, label, size = "md", className }: StatusBadgeProps) {
  const config = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        TONE_CLASS[config.tone],
        className,
      )}
    >
      {config.dot ? (
        <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {label ?? config.label}
    </span>
  );
}

/** Exported so the display-language tests can walk every state this can show. */
export const STATUS_BADGE_STATES = STATUS;
