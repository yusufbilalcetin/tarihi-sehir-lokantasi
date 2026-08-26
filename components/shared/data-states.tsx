import type { LucideIcon } from "lucide-react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The three things a panel shows when it has no rows to show.
 *
 * They are one file because they must look like one system: a screen that
 * skeletons in one shape, empties in another and errors in a third reads as
 * three different products. Copy here is written for the person in the room —
 * a waiter mid-service does not need a status code, they need to know whether
 * to wait, act, or call someone.
 */

/**
 * Which of the four states a data panel is actually in.
 *
 * The bug this exists to prevent is a two-branch ternary: `loading ? "…" :
 * "no records"`. When the request *fails*, `loading` is false, so the screen
 * calmly reports that there is nothing — a 500 rendered as an empty state. The
 * manager then trusts an empty table that is not empty. Failure and emptiness
 * are different answers and must never share a branch.
 */
export function panelState(input: {
  readonly loading: boolean;
  readonly error: unknown;
  readonly empty: boolean;
}): "loading" | "error" | "empty" | "ready" {
  // Error outranks loading: a resource that failed and is being retried is
  // still a resource the user must be told about.
  if (input.error) return "error";
  if (input.loading) return "loading";
  return input.empty ? "empty" : "ready";
}

export function LoadingState({
  rows = 3,
  variant = "list",
  className,
}: {
  readonly rows?: number;
  readonly variant?: "list" | "grid" | "board";
  readonly className?: string;
}) {
  // Skeletons mirror the layout they stand in, so nothing jumps when the real
  // content lands. A spinner cannot do that.
  const shape =
    variant === "grid"
      ? "grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3"
      : variant === "board"
        ? "grid gap-3 md:grid-cols-3"
        : "flex flex-col gap-2.5";
  const block = variant === "list" ? "h-16" : variant === "grid" ? "h-28" : "h-40";

  return (
    <div className={cn(shape, className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Yükleniyor</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "animate-pulse rounded-2xl border border-border-subtle bg-surface-muted/70",
            block,
          )}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly action?: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong bg-surface-raised/60 p-8 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-muted text-text-muted">
        <Icon className="size-5" strokeWidth={1.8} aria-hidden="true" />
      </div>
      <h3 className="mt-4 font-heading text-lg font-semibold text-text-primary">{title}</h3>
      <p className="mt-1 max-w-sm text-sm leading-6 text-text-secondary">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "İşlem şu anda tamamlanamadı",
  description = "Lütfen tekrar deneyin. Sorun devam ederse yöneticinize bildirin.",
  onRetry,
  className,
}: {
  readonly title?: string;
  readonly description?: string;
  readonly onRetry?: () => void;
  readonly className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-52 flex-col items-center justify-center rounded-2xl border border-status-danger/25 bg-status-danger-tint/50 p-8 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-2xl bg-status-danger-tint text-status-danger">
        <AlertTriangle className="size-5" strokeWidth={1.8} aria-hidden="true" />
      </div>
      <h3 className="mt-4 font-heading text-lg font-semibold text-text-primary">{title}</h3>
      <p className="mt-1 max-w-sm text-sm leading-6 text-text-secondary">{description}</p>
      {onRetry ? (
        <Button type="button" variant="outline" className="mt-4" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden="true" /> Tekrar dene
        </Button>
      ) : null}
    </div>
  );
}
