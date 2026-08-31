"use client";

import { Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSoundPreferences } from "@/lib/hooks/use-sound-preferences";
import { cn } from "@/lib/utils";

export function SoundControl({ className }: { readonly className?: string }) {
  const { enabled, volume, setEnabled, setVolume } = useSoundPreferences();
  const muted = !enabled || volume === 0;

  return (
    <div
      role="group"
      aria-label="Ses ayarları"
      className={cn("flex items-center gap-1.5", className)}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 text-current hover:bg-white/10 hover:text-current"
        aria-label={enabled ? "Sesleri kapat" : "Sesleri aç"}
        aria-pressed={!enabled}
        onClick={() => setEnabled(!enabled)}
      >
        {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      </Button>
      <label className="sr-only" htmlFor="notification-volume">
        Bildirim sesi seviyesi
      </label>
      <input
        id="notification-volume"
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={volume}
        onChange={(event) => setVolume(event.currentTarget.valueAsNumber)}
        aria-label="Bildirim sesi seviyesi"
        className="h-9 w-16 cursor-pointer accent-current sm:w-20"
      />
    </div>
  );
}
