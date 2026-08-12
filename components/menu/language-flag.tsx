"use client";

import type { MenuLanguageDefinition } from "@/lib/i18n/languages";
import { useDevicePlatform } from "@/lib/platform/device";
import { cn } from "@/lib/utils";

interface LanguageFlagProps {
  language: MenuLanguageDefinition;
  size?: "sm" | "md";
  className?: string;
}

export function LanguageFlag({ language, size = "md", className }: LanguageFlagProps) {
  const platform = useDevicePlatform();
  const dimensions = size === "sm" ? "h-4 w-5" : "h-5 w-7";

  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", dimensions, className)}
      aria-hidden="true"
    >
      {platform === "windows" && language.flag.countryCode ? (
        // Local SVGs keep desktop flags consistent without preloading the full set.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/images/flags/${language.flag.countryCode}.svg`}
          alt=""
          width={28}
          height={20}
          loading="lazy"
          className="h-full w-full rounded-[4px] border border-black/10 object-contain"
        />
      ) : (
        <span className={cn("leading-none", size === "sm" ? "text-lg" : "text-[26px]")}>{language.flag.emoji}</span>
      )}
    </span>
  );
}
