"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether this viewport is wide enough for a centred window rather than a sheet.
 *
 * Panels in the administration screens take one of two shapes: a phone gets a
 * sheet from the bottom edge with its actions above the home indicator, a
 * desktop gets a window in the middle. Several features need that answer, so it
 * lives here rather than inside whichever feature happened to ask first.
 *
 * `useSyncExternalStore` is what makes it safe to render on the server: the
 * server snapshot is returned without touching `window`, and the client
 * subscribes to the media query itself, so a rotation or a resized window
 * re-renders without a listener left behind.
 */

/** Tailwind's `lg`. Kept in one place so the two shapes never disagree. */
export const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

/** Tailwind's `md`: where the waiter panel becomes a three-column cockpit. */
export const TABLET_MEDIA_QUERY = "(min-width: 768px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

/**
 * The server renders the desktop shape. A phone corrects it on hydration, which
 * is the cheaper mistake: the alternative renders a bottom sheet for every
 * crawler and every desktop first paint.
 */
function getServerSnapshot(): boolean {
  return true;
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * The same contract for any breakpoint.
 *
 * `serverDefault` decides which shape is rendered before the browser answers.
 * It is a real choice, not a detail: the waiter panel is used on phones, so it
 * asks for the phone shape and lets a tablet correct on hydration. Guessing
 * "wide" there paints a product grid underneath the table board on a phone for
 * one frame, which is the exact stacking the layout exists to prevent.
 */
export function useMediaQuery(query: string, serverDefault = true): boolean {
  const subscribeToQuery = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const snapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribeToQuery, snapshot, () => serverDefault);
}
