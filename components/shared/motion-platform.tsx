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
  }, []);

  return null;
}
