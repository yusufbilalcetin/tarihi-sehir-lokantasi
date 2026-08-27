"use client";

import { useSyncExternalStore } from "react";

/**
 * The orders this browser actually placed.
 *
 * The server still answers with every unsettled order at the table, because
 * `orders` has no column saying which guest sitting created one — that is
 * `orders.customer_session_nonce`, prepared in migration 0017 and not yet
 * applied. Until it is, the only thing that provably distinguishes "my order"
 * from "the order the last party left open" is that the server handed *this*
 * browser the id when it created it.
 *
 * So this remembers those ids and the screen shows their intersection with the
 * server's list. It is a display scope, not an authorisation boundary — the
 * data still reaches the browser — but it is strictly narrower than what the
 * screen did before, which was to show whichever order happened to be first at
 * the table. It fails closed: an id this browser never saw is never shown.
 *
 * When 0017 is applied the server filters by nonce and this becomes redundant.
 *
 * Session storage, so it survives a reload but not the visit. Cross-table
 * bleed is impossible regardless: the server list is table-scoped, so an id
 * from another table intersects with nothing.
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
