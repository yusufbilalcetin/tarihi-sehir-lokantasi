"use client";

import { useLayoutEffect } from "react";
import { detectDevicePlatform } from "@/lib/platform/device";

export function MotionPlatform() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.platform = detectDevicePlatform(
      window.navigator.userAgent,
      window.navigator.maxTouchPoints,
    );
    root.dataset.motionReady = "true";

    // Motion doc §51: iOS Safari only applies :active once the document has a
    // touch listener. Without this the pressed state waits for click, which
    // reads as lag. Passive + empty, so it costs nothing per touch.
    document.addEventListener("touchstart", () => {}, { passive: true });
  }, []);

  return null;
}
