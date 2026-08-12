"use client";

import Image from "next/image";
import { useEffect, useState, type CSSProperties } from "react";
import { INTRO_SESSION_KEY } from "@/lib/intro-constants";
import { useMenuPreferences } from "./menu-preferences-provider";

export const INTRO_TIMING = {
  logoDelayMs: 10,
  logoDurationMs: 100,
  fadeDelayMs: 120,
  fadeDurationMs: 60,
} as const;

export const INTRO_DURATION_MS = INTRO_TIMING.fadeDelayMs + INTRO_TIMING.fadeDurationMs;
export const REDUCED_INTRO_DURATION_MS = 80;

type SplashStyle = CSSProperties & {
  "--intro-logo-delay": string;
  "--intro-logo-duration": string;
  "--intro-fade-delay": string;
  "--intro-fade-duration": string;
};

const splashStyle: SplashStyle = {
  "--intro-logo-delay": `${INTRO_TIMING.logoDelayMs}ms`,
  "--intro-logo-duration": `${INTRO_TIMING.logoDurationMs}ms`,
  "--intro-fade-delay": `${INTRO_TIMING.fadeDelayMs}ms`,
  "--intro-fade-duration": `${INTRO_TIMING.fadeDurationMs}ms`,
};

export function SplashIntro({ onComplete }: { onComplete: () => void }) {
  const { t } = useMenuPreferences();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let introSeen = document.documentElement.dataset.sehirIntro === "seen";

    try {
      introSeen ||= sessionStorage.getItem(INTRO_SESSION_KEY) === "true";
    } catch {
      // Privacy modes may block storage. The intro still completes normally.
    }

    if (introSeen) {
      const skipTimer = window.setTimeout(() => {
        setVisible(false);
        onComplete();
      }, 0);
      return () => window.clearTimeout(skipTimer);
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    const timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem(INTRO_SESSION_KEY, "true");
      } catch {
        // The visual transition should never depend on storage availability.
      }
      document.documentElement.dataset.sehirIntro = "seen";
      setVisible(false);
      document.documentElement.style.overflow = previousOverflow;
      onComplete();
    }, reducedMotion ? REDUCED_INTRO_DURATION_MS : INTRO_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [onComplete]);

  if (!visible) return null;

  return (
    <div className="menu-splash" style={splashStyle} aria-label={t("splashLabel")}>
      <Image
        src="/images/brand/wordmark-transparent.png"
        alt="Tarihi Şehir Lokantası"
        width={2172}
        height={724}
        preload
        className="menu-splash-logo"
      />
    </div>
  );
}
