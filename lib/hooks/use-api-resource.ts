"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiClientError } from "@/lib/api/client";

export interface ApiResourceState<TData> {
  readonly data: TData | null;
  readonly error: ApiClientError | null;
  /** True only while the first load is in flight; refreshes keep prior data. */
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly refetch: () => Promise<void>;
  readonly setData: (updater: (current: TData | null) => TData | null) => void;
}

export interface ApiResourceOptions {
  readonly enabled?: boolean;
  /** Background refresh cadence; paused while the tab is hidden. */
  readonly pollMs?: number;
}

function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  return new ApiClientError("INTERNAL_ERROR", "İşlem tamamlanamadı. Lütfen tekrar deneyin.", 0);
}

export interface Coalescer {
  /** At most one run in flight plus one queued; resolves with the last run. */
  readonly trigger: () => Promise<void>;
}

/**
 * Collapses overlapping refresh requests into one run plus one trailing run.
 *
 * Ten tables ordering at once publishes ten realtime events, and returning to a
 * tab fires `focus` and `visibilitychange` together. Aborting the previous
 * fetch each time keeps the state correct but still sends every request: the
 * server runs each one to completion, and each one is several round trips to a
 * database in another region. One trailing run answers all of them.
 *
 * The trailing run is what a caller awaits, so code that refreshes after its
 * own mutation never resolves on a response that was already in flight before
 * the write — the freshness guarantee is the reason this queues rather than
 * simply dropping the extra calls.
 */
export function createCoalescer(run: () => Promise<void>): Coalescer {
  let inFlight: Promise<void> | null = null;
  let trailingQueued = false;

  const track = (work: Promise<void>): Promise<void> => {
    const tracked = work.finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return tracked;
  };

  const trigger = (): Promise<void> => {
    const pending = inFlight;
    if (!pending) return track(run());
    if (trailingQueued) return pending;
    trailingQueued = true;
    const queued = pending.then(() => {
      trailingQueued = false;
      return track(run());
    });
    inFlight = queued;
    return queued;
  };

  return { trigger };
}

/**
 * Minimal server-state hook: the project has no query library, and a fetch with
 * abort, focus revalidation and optional polling is all these panels need.
 */
export function useApiResource<TData>(
  load: (signal: AbortSignal) => Promise<TData>,
  options: ApiResourceOptions = {},
): ApiResourceState<TData> {
  const { enabled = true, pollMs } = options;
  const [data, setDataState] = useState<TData | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadedOnce = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const start = useCallback(async () => {
    if (!enabled) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    if (loadedOnce.current) setRefreshing(true);

    try {
      const result = await load(controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      setDataState(result);
      setError(null);
    } catch (caught) {
      if (controller.signal.aborted || !mountedRef.current) return;
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(toApiClientError(caught));
    } finally {
      if (mountedRef.current && !controller.signal.aborted) {
        loadedOnce.current = true;
        setLoaded(true);
        setRefreshing(false);
      }
    }
  }, [enabled, load]);

  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  }, [start]);
  // One coalescer for the life of the hook, created on first use and reading
  // the current loader through the ref, so a changed `load` never leaves two
  // queues running side by side.
  const coalescerRef = useRef<Coalescer | null>(null);
  const refetch = useCallback(() => {
    coalescerRef.current ??= createCoalescer(() => startRef.current());
    return coalescerRef.current.trigger();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // Deferred so the initial fetch never sets state inside the effect body.
    // `load` is a dependency in its own right: `refetch` is stable now, and a
    // panel that rebuilds its loader for a new filter still has to re-fetch.
    const timer = window.setTimeout(() => void refetch(), 0);
    return () => window.clearTimeout(timer);
  }, [enabled, load, refetch]);

  useEffect(() => {
    if (!enabled) return;
    // Returning to a tab fires `visibilitychange` and `focus` back to back, and
    // both mean the same thing. `focus` alone still covers coming back from
    // another window while the document never hid, so neither listener goes —
    // the pair is simply counted once.
    let lastRevalidatedAt = 0;
    function revalidate() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRevalidatedAt < 1_000) return;
      lastRevalidatedAt = now;
      void refetch();
    }
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [enabled, refetch]);

  useEffect(() => {
    if (!enabled || !pollMs) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refetch();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [enabled, pollMs, refetch]);

  const setData = useCallback((updater: (current: TData | null) => TData | null) => {
    setDataState((current) => updater(current));
  }, []);

  return { data, error, loading: enabled && !loaded, refreshing, refetch, setData };
}
