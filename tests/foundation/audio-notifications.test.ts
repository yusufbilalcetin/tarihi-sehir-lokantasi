import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

import { NewEntityTracker } from "@/lib/audio/new-entity-tracker";
import {
  SOUND_PREFERENCES_STORAGE_KEY,
  SoundEffectsManager,
} from "@/lib/audio/sound-effects";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

test("entity snapshots stay silent initially and notify once for genuinely new IDs", () => {
  const tracker = new NewEntityTracker();

  assert.equal(tracker.update(["existing-order"]), false, "initial kitchen/cashier load is silent");
  assert.equal(tracker.update(["existing-order", "new-order"]), true, "a new ID notifies");
  assert.equal(tracker.update(["existing-order", "new-order"]), false, "a refetch is silent");
  assert.equal(tracker.update(["new-order"]), false, "a rerender/smaller snapshot is silent");
  assert.equal(tracker.update(["new-order", "batch-a", "batch-b"]), true, "a batch coalesces");
  assert.equal(tracker.update(["batch-a", "batch-b"]), false, "batch IDs remain known");
});

test("mute, volume, and preferences persist through the centralized manager", async () => {
  const storage = memoryStorage();
  let plays = 0;
  let lastVolume = -1;
  const manager = new SoundEffectsManager({
    getStorage: () => storage,
    createAudio: () => ({
      currentTime: 0,
      preload: "none",
      get volume() {
        return lastVolume;
      },
      set volume(value: number) {
        lastVolume = value;
      },
      play: async () => {
        plays += 1;
      },
    }),
  });

  manager.setVolume(0.35);
  assert.equal(await manager.play("warning"), true);
  assert.equal(plays, 1);
  assert.equal(lastVolume, 0.35);

  manager.setEnabled(false);
  assert.equal(await manager.play("warning"), false);
  assert.equal(plays, 1, "muting prevents Audio.play");
  const mutedRestored = new SoundEffectsManager({ getStorage: () => storage });
  assert.deepEqual(mutedRestored.getSnapshot(), { enabled: false, volume: 0.35 });

  manager.setEnabled(true);
  assert.equal(await manager.play("warning"), true);
  assert.equal(plays, 2, "unmuting restores playback");

  const restored = new SoundEffectsManager({ getStorage: () => storage });
  assert.deepEqual(restored.getSnapshot(), { enabled: true, volume: 0.35 });
  assert.ok(storage.getItem(SOUND_PREFERENCES_STORAGE_KEY));
});

test("Audio.play rejection is absorbed and application work can continue", async () => {
  const transactionResult = { status: "accepted" };
  const manager = new SoundEffectsManager({
    createAudio: () => ({
      currentTime: 0,
      preload: "none",
      volume: 1,
      play: () => Promise.reject(new DOMException("Not allowed", "NotAllowedError")),
    }),
  });

  assert.equal(await manager.play("new-order"), false);
  assert.deepEqual(
    transactionResult,
    { status: "accepted" },
    "the caller's business result survives an autoplay rejection",
  );
  assert.doesNotMatch(read("lib/audio/sound-effects.ts"), /console\./, "playback failures stay quiet");
});

test("volume is normalized and sound controls remain keyboard-accessible", () => {
  const manager = new SoundEffectsManager();
  manager.setVolume(4);
  assert.equal(manager.getSnapshot().volume, 1);
  manager.setVolume(-2);
  assert.equal(manager.getSnapshot().volume, 0);

  const control = read("components/shared/sound-control.tsx");
  assert.match(control, /type="button"/);
  assert.match(control, /aria-label=\{enabled \? "Sesleri kapat" : "Sesleri aç"\}/);
  assert.match(control, /type="range"[\s\S]*min="0"[\s\S]*max="1"[\s\S]*step="0\.05"/);
});

test("a missing or unsupported asset remains a non-business failure", async () => {
  let businessCompleted = false;
  const manager = new SoundEffectsManager({
    createAudio: () => ({
      currentTime: 0,
      preload: "none",
      volume: 1,
      play: () => Promise.reject(new DOMException("Media unavailable", "NotSupportedError")),
    }),
  });

  assert.equal(await manager.play("payment-success"), false);
  businessCompleted = true;
  assert.equal(businessCompleted, true);
});

test("all mapped WAV assets are valid, bounded PCM audio", () => {
  const expectedDurations: Readonly<Record<string, number>> = {
    "new-order.wav": 1.0,
    "cashier-notification.wav": 0.65,
    "payment-success.wav": 0.72,
    "customer-order-success.wav": 0.8,
    "success.wav": 0.48,
    "error.wav": 0.62,
    "warning.wav": 0.68,
  };
  const source = read("lib/audio/sound-effects.ts");

  for (const [filename, expectedDuration] of Object.entries(expectedDurations)) {
    const url = new URL(`../../public/sounds/${filename}`, import.meta.url);
    const wav = readFileSync(url);
    assert.ok(statSync(url).size > 44, `${filename} has PCM data`);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF", `${filename} has a RIFF header`);
    assert.equal(wav.toString("ascii", 8, 12), "WAVE", `${filename} has a WAVE header`);
    assert.equal(wav.readUInt16LE(20), 1, `${filename} uses PCM encoding`);
    assert.equal(wav.readUInt16LE(22), 1, `${filename} is mono`);
    assert.equal(wav.readUInt32LE(24), 44_100, `${filename} sample rate is supported`);
    assert.equal(wav.readUInt16LE(34), 16, `${filename} is 16-bit`);
    const duration = wav.readUInt32LE(40) / 2 / wav.readUInt32LE(24);
    assert.ok(Math.abs(duration - expectedDuration) < 0.001, `${filename} duration matches`);
    let peak = 0;
    for (let offset = 44; offset + 1 < wav.length; offset += 2) {
      peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
    }
    assert.ok(peak > 0, `${filename} contains audible samples`);
    assert.ok(peak < 32_767, `${filename} does not clip`);
    assert.match(source, new RegExp(`/sounds/${filename.replace(".", "\\.")}`));
  }
});

test("kitchen and cashier wire snapshot tracking to their dedicated sounds", () => {
  const kitchen = read("components/kitchen/kitchen-board.tsx");
  const cashier = read("components/cashier/cashier-dashboard.tsx");

  assert.match(kitchen, /newOrderTracker\.current\.update[\s\S]*playSound\("new-order"\)/);
  assert.match(cashier, /notificationTracker\.current\.update[\s\S]*playSound\("cashier-notification"\)/);
  assert.match(cashier, /bill-request:\$\{call\.id\}/);
  assert.match(kitchen, /<SoundControl/);
  assert.match(cashier, /<SoundControl/);
});

test("success sounds occur only after accepted payment and customer-order requests", () => {
  const cashier = read("components/cashier/cashier-dashboard.tsx");
  const operations = read("components/cashier/bill-operations-sheet.tsx");
  const customer = read("components/menu/menu-experience.tsx");

  assert.match(cashier, /await paymentApi\.collect\([\s\S]*?playSound\("payment-success"\)/);
  assert.match(operations, /await paymentApi\.collect\([\s\S]*?playSound\("payment-success"\)/);
  assert.match(customer, /await orderApi\.create\([\s\S]*?playSound\("customer-order-success"\)/);
  assert.match(cashier, /void playSound\("payment-success"\)/);
  assert.match(customer, /void playSound\("customer-order-success"\)/);
  assert.match(cashier, /catch \(error\)[\s\S]*?playSound\("error"\)/);
  assert.match(customer, /function reportFailure[\s\S]*?playSound\("error"\)/);

  const paymentCatch = cashier.slice(
    cashier.indexOf("} catch (error)", cashier.indexOf("async function takePayment")),
    cashier.indexOf("} finally", cashier.indexOf("async function takePayment")),
  );
  const customerCatch = customer.slice(
    customer.indexOf("} catch (error)", customer.indexOf("async function sendOrder")),
    customer.indexOf("} finally", customer.indexOf("async function sendOrder")),
  );
  assert.doesNotMatch(paymentCatch, /payment-success/, "payment failure has no success sound");
  assert.doesNotMatch(
    customerCatch,
    /customer-order-success/,
    "customer-order failure has no success sound",
  );
});
