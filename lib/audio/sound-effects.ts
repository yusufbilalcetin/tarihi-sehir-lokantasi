export const SOUND_ASSETS = {
  "new-order": "/sounds/new-order.wav",
  "cashier-notification": "/sounds/cashier-notification.wav",
  "payment-success": "/sounds/payment-success.wav",
  "customer-order-success": "/sounds/customer-order-success.wav",
  success: "/sounds/success.wav",
  error: "/sounds/error.wav",
  warning: "/sounds/warning.wav",
} as const;

export type SoundName = keyof typeof SOUND_ASSETS;

export interface SoundPreferences {
  readonly enabled: boolean;
  readonly volume: number;
}

interface AudioLike {
  currentTime: number;
  preload: string;
  volume: number;
  play(): Promise<void> | void;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SoundEffectsEnvironment {
  readonly createAudio?: (source: string) => AudioLike;
  readonly getStorage?: () => StorageLike | null;
}

export const SOUND_PREFERENCES_STORAGE_KEY = "sehir-lokantasi:sound-preferences:v1";
export const DEFAULT_SOUND_PREFERENCES: SoundPreferences = Object.freeze({
  enabled: true,
  volume: 0.6,
});

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_SOUND_PREFERENCES.volume;
  return Math.min(1, Math.max(0, volume));
}

function parsePreferences(value: string | null): SoundPreferences {
  if (!value) return DEFAULT_SOUND_PREFERENCES;
  try {
    const parsed = JSON.parse(value) as Partial<SoundPreferences>;
    return Object.freeze({
      enabled:
        typeof parsed.enabled === "boolean"
          ? parsed.enabled
          : DEFAULT_SOUND_PREFERENCES.enabled,
      volume:
        typeof parsed.volume === "number"
          ? clampVolume(parsed.volume)
          : DEFAULT_SOUND_PREFERENCES.volume,
    });
  } catch {
    return DEFAULT_SOUND_PREFERENCES;
  }
}

/**
 * Owns audio elements, preferences, and all best-effort playback. Keeping this
 * outside React means every screen uses the same policy and cached elements.
 */
export class SoundEffectsManager {
  private readonly audio = new Map<SoundName, AudioLike>();
  private readonly listeners = new Set<() => void>();
  private preferences: SoundPreferences = DEFAULT_SOUND_PREFERENCES;
  private hydrated = false;

  constructor(private readonly environment: SoundEffectsEnvironment = {}) {}

  getSnapshot = (): SoundPreferences => {
    this.hydrate();
    return this.preferences;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.hydrate();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setEnabled(enabled: boolean): void {
    this.update({ ...this.getSnapshot(), enabled });
  }

  setVolume(volume: number): void {
    this.update({ ...this.getSnapshot(), volume: clampVolume(volume) });
  }

  async play(name: SoundName): Promise<boolean> {
    const preferences = this.getSnapshot();
    if (!preferences.enabled || preferences.volume === 0 || !this.environment.createAudio) {
      return false;
    }

    try {
      let element = this.audio.get(name);
      if (!element) {
        element = this.environment.createAudio(SOUND_ASSETS[name]);
        element.preload = "auto";
        this.audio.set(name, element);
      }
      element.volume = preferences.volume;
      // Reusing an element deliberately coalesces rapid calls of the same kind.
      element.currentTime = 0;
      await Promise.resolve(element.play());
      return true;
    } catch {
      // Missing files and browser autoplay policies are non-business failures.
      return false;
    }
  }

  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const storage = this.environment.getStorage?.();
      this.preferences = parsePreferences(
        storage?.getItem(SOUND_PREFERENCES_STORAGE_KEY) ?? null,
      );
    } catch {
      this.preferences = DEFAULT_SOUND_PREFERENCES;
    }
  }

  private update(preferences: SoundPreferences): void {
    this.preferences = Object.freeze(preferences);
    this.hydrated = true;
    for (const element of this.audio.values()) element.volume = preferences.volume;
    try {
      this.environment.getStorage?.()?.setItem(
        SOUND_PREFERENCES_STORAGE_KEY,
        JSON.stringify(preferences),
      );
    } catch {
      // Private browsing/storage denial must not break an operational action.
    }
    for (const listener of this.listeners) listener();
  }
}

const soundEffects = new SoundEffectsManager({
  createAudio:
    typeof window === "undefined"
      ? undefined
      : (source) => new Audio(source),
  getStorage: () => {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  },
});

export const getSoundPreferences = soundEffects.getSnapshot;
export const subscribeSoundPreferences = soundEffects.subscribe;
export const setSoundEnabled = (enabled: boolean) => soundEffects.setEnabled(enabled);
export const setSoundVolume = (volume: number) => soundEffects.setVolume(volume);

/** Playback is always fire-and-forget safe, including autoplay rejection. */
export function playSound(name: SoundName): Promise<boolean> {
  return soundEffects.play(name);
}
