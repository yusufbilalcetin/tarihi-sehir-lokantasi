"use client";

import { useSyncExternalStore } from "react";

import {
  DEFAULT_SOUND_PREFERENCES,
  getSoundPreferences,
  setSoundEnabled,
  setSoundVolume,
  subscribeSoundPreferences,
} from "@/lib/audio/sound-effects";

export function useSoundPreferences() {
  const preferences = useSyncExternalStore(
    subscribeSoundPreferences,
    getSoundPreferences,
    () => DEFAULT_SOUND_PREFERENCES,
  );

  return {
    ...preferences,
    setEnabled: setSoundEnabled,
    setVolume: setSoundVolume,
  };
}
