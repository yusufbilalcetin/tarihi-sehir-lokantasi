"use client";

import { useSyncExternalStore } from "react";

/**
 * The orders this browser actually placed, in the order it placed them.
 *
 * Ownership itself is settled on the server: an order records the sitting that
 * created it in `orders.customer_session_nonce`, and `/api/orders/active`
 * answers with that sitting's orders rather than the table's. This is not that
 * boundary and never was — it is a display scope, and it fails closed the same
 * way: an id this browser never saw is never shown.
 *
 * What it still carries on its own is the ordinal. "Your second order" is a
 * fact about what this browser submitted, not about what is still unsettled,
 * so it has to survive an earlier order being paid for and leaving the list —
 * which only an append-only local record can do.
 *
 * Session storage, so it survives a reload but not the visit.
 */

const STORAGE_KEY = "sehir-session-orders";
const EMPTY: readonly string[] = [];

/**
 * `useSyncExternalStore` compares snapshots by identity, so the same storage
 * contents must return the same array instance or React re-renders forever.
 */
let cache: { raw: string | null; parsed: readonly string[] } = { raw: null, parsed: EMPTY };
const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode, disabled storage, or a browser that throws on access.
    return null;
  }
}

function getSnapshot(): readonly string[] {
  const raw = readRaw();
  if (raw === cache.raw) return cache.parsed;
  let parsed: readonly string[] = EMPTY;
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (Array.isArray(value)) {
      parsed = value.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    parsed = EMPTY;
  }
  cache = { raw, parsed };
  return parsed;
}

/**
 * The server renders no remembered orders. Returning a stable empty array
 * keeps the first client render identical to the server's, so this cannot
 * reintroduce a hydration mismatch.
 */
function getServerSnapshot(): readonly string[] {
  return EMPTY;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called once, when the server confirms an order this browser submitted. */
export function rememberSessionOrder(orderId: string): void {
  if (!orderId) return;
  const current = getSnapshot();
  if (current.includes(orderId)) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...current, orderId]));
  } catch {
    return;
  }
  for (const listener of listeners) listener();
}

export function useSessionOrderIds(): readonly string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
