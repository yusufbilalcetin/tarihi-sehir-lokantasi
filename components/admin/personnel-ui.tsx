"use client";

import { Menu } from "@base-ui/react/menu";
import { ChevronLeft, ChevronRight, Ellipsis } from "lucide-react";
import type { ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_TONES = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-status-success-tint text-status-success",
  warning: "bg-status-warning-tint text-status-warning",
  danger: "bg-status-danger-tint text-status-danger",
  info: "bg-status-info-tint text-status-info",
} as const;

export type PersonnelStatusTone = keyof typeof STATUS_TONES;

export function PersonnelAvatar({ name, size = "default" }: { name: string; size?: "default" | "lg" }) {
  return (
    <Avatar size={size}>
      <AvatarFallback className="bg-surface-muted font-semibold text-foreground">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function AdminStatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: PersonnelStatusTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        STATUS_TONES[tone],
      )}
    >
      {label}
    </span>
  );
}

export interface PersonnelAction {
  readonly label: string;
  readonly onSelect: () => void;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}

export function PersonnelActionMenu({ label, actions }: { label: string; actions: readonly PersonnelAction[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        className="motion-press inline-flex size-11 items-center justify-center rounded-lg border border-transparent text-muted-foreground outline-none transition-colors hover:border-border hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 md:size-9"
      >
        <Ellipsis className="size-4" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="z-[70] outline-none" sideOffset={6} align="end">
          <Menu.Popup className="min-w-44 origin-[var(--transform-origin)] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none transition-[scale,opacity] duration-100 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
            {actions.map((action) => (
              <Menu.Item
                key={action.label}
                disabled={action.disabled}
                onClick={action.onSelect}
                className={cn(
                  "flex min-h-9 cursor-default items-center gap-2 rounded-md px-2.5 text-[13px] font-medium outline-none select-none data-disabled:opacity-45 data-highlighted:bg-muted",
                  action.danger && "text-destructive data-highlighted:bg-destructive/10",
                )}
              >
                {action.icon}
                <span>{action.label}</span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function AdminPagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav
      aria-label="Sayfalama"
      className="flex flex-col gap-3 border-t border-border px-4 py-3 text-[13px] min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between sm:px-5"
    >
      <span className="text-muted-foreground">
        {total.toLocaleString("tr-TR")} kayıt · Sayfa {page}/{totalPages}
      </span>
      <div className="grid grid-cols-2 gap-2 min-[430px]:flex">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-4" aria-hidden="true" /> Önceki
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Sonraki <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
