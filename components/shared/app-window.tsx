"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/shared/data-states";
import { cn } from "@/lib/utils";

/**
 * The centred application window.
 *
 * Staff work is modal by nature: a waiter is *at* a table, a cashier is *on* a
 * bill. Giving each module a window rather than a page keeps the floor plan
 * behind it — you never lose your place — while the task in front of you owns
 * the screen. That is why this is not a small modal: it is sized as a working
 * surface, with its own header, toolbar, scrolling body and pinned actions.
 *
 * Scrolling is the part that decides whether this feels like software or like
 * a web page: the header and toolbar stay put, the body is the only thing that
 * moves, and the footer holds the actions. One scroll region, never nested.
 *
 * On a phone the centred geometry stops making sense, so the window becomes a
 * near-fullscreen sheet. Tablet and desktop get the real thing — tablets are a
 * first-class target here, not a fallback.
 *
 * Base UI supplies the portal, the focus trap, the Escape handling and the
 * aria wiring; the motion classes are the ones the rest of the product already
 * animates with, including its reduced-motion behaviour.
 */

export type AppWindowSize = "md" | "lg" | "xl" | "workspace";

/** Width is a working-surface decision, not a decoration one. */
const SIZE_CLASS: Readonly<Record<AppWindowSize, string>> = {
  // A focused task: one form, one confirmation, one short list.
  md: "sm:max-w-xl",
  // A list plus its detail.
  lg: "sm:max-w-3xl",
  // A module with a toolbar and a wide table.
  xl: "sm:max-w-5xl",
  // The till and the reports: multi-pane, uses the room it is given.
  workspace: "sm:max-w-[min(96rem,95vw)]",
};

export interface CenteredAppWindowProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly icon?: LucideIcon;
  readonly size?: AppWindowSize;
  /** Replaces the body with a matching skeleton while first data loads. */
  readonly loading?: boolean;
  /** Replaces the body with a recoverable error, in the person's language. */
  readonly error?: string | null;
  readonly onRetry?: () => void;
  readonly toolbar?: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly statusBar?: React.ReactNode;
  readonly headerAside?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
}

export function CenteredAppWindow({
  open,
  onOpenChange,
  title,
  description,
  icon: Icon,
  size = "lg",
  loading = false,
  error = null,
  onRetry,
  toolbar,
  footer,
  statusBar,
  headerAside,
  children,
  className,
}: CenteredAppWindowProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Dim plus a light blur: enough to push the floor plan back without
            turning the window into frosted glass. */}
        <DialogPrimitive.Backdrop className="motion-dialog-overlay fixed inset-0 z-[var(--z-overlay)] bg-[#1B1813]/45 backdrop-blur-[2px]" />
        <DialogPrimitive.Popup
          aria-modal="true"
          className={cn(
            "motion-dialog fixed top-1/2 left-1/2 z-[var(--z-window)] flex w-full flex-col overflow-hidden outline-none",
            // Phone: a sheet that owns the screen. Tablet and up: a window.
            "h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] rounded-2xl",
            "sm:h-auto sm:max-h-[min(52rem,calc(100dvh-3rem))] sm:max-w-[calc(100%-3rem)] sm:rounded-3xl",
            "border border-border-strong bg-surface-elevated text-text-primary shadow-[var(--shadow-window)]",
            SIZE_CLASS[size],
            className,
          )}
        >
          <WindowHeader
            title={title}
            description={description}
            icon={Icon}
            aside={headerAside}
            onClose={() => onOpenChange(false)}
          />

          {toolbar ? <WindowToolbar>{toolbar}</WindowToolbar> : null}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {error ? (
              <div className="p-4 sm:p-6">
                <ErrorState title={`${title} yüklenemedi`} description={error} onRetry={onRetry} />
              </div>
            ) : loading ? (
              <div className="p-4 sm:p-6">
                <LoadingState rows={4} />
              </div>
            ) : (
              children
            )}
          </div>

          {footer ? <WindowFooter>{footer}</WindowFooter> : null}
          {statusBar ? <WindowStatusBar>{statusBar}</WindowStatusBar> : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function WindowHeader({
  title,
  description,
  icon: Icon,
  aside,
  onClose,
}: {
  readonly title: string;
  readonly description?: string;
  readonly icon?: LucideIcon;
  readonly aside?: React.ReactNode;
  readonly onClose: () => void;
}) {
  return (
    <header className="flex shrink-0 items-start gap-3 border-b border-border-subtle bg-surface-raised px-4 py-3.5 sm:px-6 sm:py-4">
      {Icon ? (
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary">
          <Icon className="size-[18px]" strokeWidth={1.9} aria-hidden="true" />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <DialogPrimitive.Title className="truncate font-heading text-lg font-semibold text-text-primary sm:text-xl">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-0.5 line-clamp-2 text-sm text-text-secondary">
            {description}
          </DialogPrimitive.Description>
        ) : null}
      </div>
      {aside ? <div className="hidden shrink-0 sm:block">{aside}</div> : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Pencereyi kapat"
        // Waiters, cooks and cashiers close this with a thumb on a tablet, so
        // it meets the same touch floor as every other critical control.
        className="-mr-1 size-11 shrink-0 text-text-muted hover:text-text-primary"
      >
        <X className="size-5" />
      </Button>
    </header>
  );
}

/** Filters and actions that must stay reachable while the body scrolls. */
export function WindowToolbar({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle bg-surface-muted/60 px-4 py-2.5 sm:px-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Ordinary padded content. Panes that manage their own layout skip it. */
export function WindowBody({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return <div className={cn("p-4 sm:p-6", className)}>{children}</div>;
}

/**
 * A fixed rail beside the body — the module list of a workspace window.
 * Hidden below `lg`, where the body needs the whole width.
 */
export function WindowSidebar({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <aside
      className={cn(
        "hidden w-56 shrink-0 overflow-y-auto border-r border-border-subtle bg-surface-muted/40 p-3 lg:block",
        className,
      )}
    >
      {children}
    </aside>
  );
}

/** Primary actions, pinned so a long body never scrolls them out of reach. */
export function WindowFooter({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <footer
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t border-border-subtle bg-surface-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-6",
        // Clears the home indicator on a phone held in one hand.
        "pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3",
        className,
      )}
    >
      {children}
    </footer>
  );
}

/** Quiet, always-true context: counts, totals, last-updated. Never actions. */
export function WindowStatusBar({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 border-t border-border-subtle bg-surface-muted/70 px-4 py-2 text-xs text-text-secondary sm:px-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
