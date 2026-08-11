"use client";

import { useSyncExternalStore } from "react";

export type DevicePlatform = "ios" | "android" | "desktop";

export function detectDevicePlatform(userAgent: string, maxTouchPoints = 0): DevicePlatform {
  if (/iPad|iPhone|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

export function useDevicePlatform() {
  return useSyncExternalStore(
    () => () => undefined,
    () => detectDevicePlatform(window.navigator.userAgent, window.navigator.maxTouchPoints),
    () => "ios",
  );
}
