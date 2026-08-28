"use client";

import { useSyncExternalStore } from "react";

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
