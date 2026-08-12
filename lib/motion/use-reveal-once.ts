"use client";

import { useEffect, useRef, useState } from "react";

const revealedItems = new Set<string>();

export function useRevealOnce<T extends HTMLElement>(id: string) {
  const ref = useRef<T>(null);
  const [animate] = useState(() => !revealedItems.has(id));
  const [revealed, setRevealed] = useState(() => revealedItems.has(id));

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

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      revealedItems.add(id);
      setRevealed(true);
      observer.disconnect();
    }, { rootMargin: "0px 0px -5%", threshold: 0.08 });

    observer.observe(element);
    return () => observer.disconnect();
  }, [id, revealed]);

  return { ref, revealed, animate };
}
