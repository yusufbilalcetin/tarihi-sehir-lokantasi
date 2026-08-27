"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A dialog that looks like an application window.
 *
 * The window metaphor belongs here and nowhere else: this is something a person
 * deliberately opened on top of the page they are still standing on, so a title
 * bar and a close control are honest. A route is not that — it is a place you
 * navigated to, and the back button is what closes it.
 *
 * Built on the same Base UI primitives as every other dialog, so the focus
 * trap, Escape handling, focus return and aria wiring are the ones that were
 * already working. Only the chrome is new: a title bar separated by a real
 * border, the close control living *in* that bar rather than floating over the
 * content, a defined edge and an elevated shadow.
 *
 * The influence is a modern desktop window, not a Windows reproduction — the
 * olive, cream, burgundy and copper palette is unchanged, and there are no
 * minimise or maximise controls because no such behaviour exists.
 */

export type WindowDialogSize = "sm" | "md" | "lg" | "xl";

/**
 * Sizes are chosen by content, not habit: a confirmation should not open at the
 * width of a product form. None of these approach the route-scale width the old
 * route-as-window shell used.
 */
const SIZE_CLASS: Readonly<Record<WindowDialogSize, string>> = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
};

export function WindowDialogContent({
  title,
  description,
  size = "md",
  showCloseButton = true,
  footer,
  className,
  children,
  ...props
}: Omit<DialogPrimitive.Popup.Props, "title"> & {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly size?: WindowDialogSize;
  /** Off for decisions that must be made explicitly rather than dismissed. */
  readonly showCloseButton?: boolean;
  readonly footer?: React.ReactNode;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="window-dialog"
        className={cn(
          "motion-dialog fixed top-1/2 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden outline-none",
          // A defined edge and a real elevation are what make it read as a
          // window rather than a card lying on the page.
          "rounded-lg border border-copper/45 bg-card text-card-foreground shadow-[var(--shadow-window)]",
          // Phone: a comfortable inset rather than a miniature desktop window,
          // and never taller than the viewport.
          "w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-2rem)]",
          "sm:w-full sm:max-h-[min(44rem,calc(100dvh-4rem))]",
          SIZE_CLASS[size],
          className,
        )}
        {...props}
      >
        {/* Title bar: the close control lives here, not over the content. It is
            screen furniture, so a printed document never carries it. */}
        <div
          data-print-hide
          className="flex shrink-0 items-start gap-3 border-b border-copper/55 bg-surface-inverse px-4 py-3 text-text-inverse"
        >
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="truncate font-heading text-base font-semibold tracking-[-0.01em] text-text-inverse">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 line-clamp-2 text-sm leading-5 text-text-inverse-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {showCloseButton ? (
            <DialogPrimitive.Close
              data-slot="window-dialog-close"
              render={<Button variant="ghost" size="icon-sm" className="-mr-1 shrink-0 text-text-inverse-muted hover:bg-white/10 hover:text-text-inverse" />}
            >
              <XIcon className="size-4" aria-hidden="true" />
              <span className="sr-only">Kapat</span>
            </DialogPrimitive.Close>
          ) : null}
        </div>

        <div data-slot="window-dialog-body" className="min-h-0 flex-1 overflow-y-auto bg-card px-4 py-4">
          {children}
        </div>

        {footer ? (
          <div
            data-print-hide
            className="flex shrink-0 flex-col-reverse gap-2 border-t border-border-strong bg-muted/45 px-4 py-3 sm:flex-row sm:justify-end"
          >
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}
