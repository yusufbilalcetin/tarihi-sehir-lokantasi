"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import type { LucideIcon } from "lucide-react";

import { CenteredAppWindow, type AppWindowSize } from "@/components/shared/app-window";

/**
 * A route rendered as an application window.
 *
 * The operational panels keep their own URLs — `/staff/tables` is still
 * `/staff/tables`, so a deep link, a refresh and the back button all behave the
 * way the browser promises. What changes is what the route *looks* like: the
 * shell stays on screen and the module opens as a focused window over it,
 * rather than replacing the whole page with a document.
 *
 * That matters on a floor: a waiter who opens Orders has not left the floor
 * plan, and closing the window puts them back where they were instead of
 * navigating them somewhere new.
 *
 * Closing routes to `closeHref`, so the window's close button and the browser's
 * own navigation end up in the same place.
 */
export function ModuleWindow({
  title,
  description,
  icon,
  size = "xl",
  closeHref,
  toolbar,
  footer,
  statusBar,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly icon?: LucideIcon;
  readonly size?: AppWindowSize;
  /** Where closing lands. Usually the role's home. */
  readonly closeHref: string;
  readonly toolbar?: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly statusBar?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  const router = useRouter();

  const handleOpenChange = useCallback(
    (next: boolean) => {
      // Only closing is meaningful here: the window is open because the route
      // is open, so "open" has already happened by the time this renders.
      if (!next) router.push(closeHref);
    },
    [closeHref, router],
  );

  return (
    <CenteredAppWindow
      open
      onOpenChange={handleOpenChange}
      title={title}
      description={description}
      icon={icon}
      size={size}
      toolbar={toolbar}
      footer={footer}
      statusBar={statusBar}
    >
      {children}
    </CenteredAppWindow>
  );
}
