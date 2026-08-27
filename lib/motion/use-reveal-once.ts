"use client";

import { useEffect, useRef, useState } from "react";

const revealedItems = new Set<string>();

/**
 * One observer for the whole page, not one per card.
 *
 * The customer menu now renders every category and every dish in a single
 * scroll, so a per-card observer meant sixty-odd observers on one screen —
 * sixty separate root/threshold computations for the browser to keep in step
 * while a guest flicks through the menu. They all watched for the same thing
 * with the same options, so they collapse into one.
 *
 * Created lazily and only in the browser: the module is imported during SSR
 * too, where `IntersectionObserver` does not exist.
 */
const revealCallbacks = new WeakMap<Element, () => void>();
let sharedObserver: IntersectionObserver | null = null;

function sharedRevealObserver(): IntersectionObserver {
  sharedObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const reveal = revealCallbacks.get(entry.target);
        if (!reveal) continue;
        // Each element is watched exactly once; stop watching before the state
        // update so a re-render cannot queue a second reveal for it.
        revealCallbacks.delete(entry.target);
        sharedObserver?.unobserve(entry.target);
        reveal();
      }
    },
    { rootMargin: "0px 0px -5%", threshold: 0.08 },
  );
  return sharedObserver;
}

export function useRevealOnce<T extends HTMLElement>(id: string) {
  const ref = useRef<T>(null);
  const [initialState] = useState(() => {
    const alreadyRevealed = revealedItems.has(id);
    return { animate: !alreadyRevealed, revealed: alreadyRevealed };
  });
  const [revealed, setRevealed] = useState(initialState.revealed);

  useEffect(() => {
    if (revealed) return;
    const element = ref.current;
    if (!element) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      let active = true;
      queueMicrotask(() => {
        if (!active) return;
        revealedItems.add(id);
        setRevealed(true);
      });
      return () => { active = false; };
    }

    const observer = sharedRevealObserver();
    revealCallbacks.set(element, () => {
      revealedItems.add(id);
      setRevealed(true);
    });
    observer.observe(element);

    return () => {
      revealCallbacks.delete(element);
      observer.unobserve(element);
    };
  }, [id, revealed]);

  return { ref, revealed, animate: initialState.animate };
}
