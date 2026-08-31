"""Generate the restaurant's original notification sounds using only Python stdlib."""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path
from typing import Callable


SAMPLE_RATE = 44_100
TARGET_PEAK = 0.68
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "public" / "sounds"


def smooth_note(
    time: float,
    start: float,
    duration: float,
    frequency: float,
    amplitude: float,
    warmth: float = 0.12,
) -> float:
    local = time - start
    if local < 0.0 or local >= duration:
        return 0.0
    attack = min(1.0, local / 0.012)
    release = min(1.0, (duration - local) / 0.09)
    envelope = attack * release * (0.92 + 0.08 * math.cos(math.pi * local / duration))
    fundamental = math.sin(2.0 * math.pi * frequency * local)
    harmonic = math.sin(2.0 * math.pi * frequency * 2.0 * local) * warmth
    return amplitude * envelope * (fundamental + harmonic) / (1.0 + warmth)


def bell_strike(time: float, start: float, amplitude: float) -> float:
    local = time - start
    duration = 0.48
    if local < 0.0 or local >= duration:
        return 0.0
    attack = min(1.0, local / 0.004)
    tail = max(0.0, 1.0 - local / duration)
    envelope = attack * tail * tail * math.exp(-2.4 * local)
    partials = (
        math.sin(2.0 * math.pi * 659.25 * local)
        + 0.44 * math.sin(2.0 * math.pi * 987.77 * local)
        + 0.22 * math.sin(2.0 * math.pi * 1_318.51 * local)
    )
    return amplitude * envelope * partials / 1.66


def new_order(time: float) -> float:
    return bell_strike(time, 0.055, 1.0) + bell_strike(time, 0.43, 0.82)


def cashier_notification(time: float) -> float:
    return smooth_note(time, 0.055, 0.29, 493.88, 0.62) + smooth_note(
        time, 0.30, 0.29, 622.25, 0.58
    )


def payment_success(time: float) -> float:
    return (
        smooth_note(time, 0.045, 0.25, 523.25, 0.45)
        + smooth_note(time, 0.22, 0.27, 659.25, 0.46)
        + smooth_note(time, 0.40, 0.27, 783.99, 0.48)
    )


def customer_order_success(time: float) -> float:
    return (
        smooth_note(time, 0.05, 0.34, 392.00, 0.42, 0.18)
        + smooth_note(time, 0.26, 0.36, 493.88, 0.43, 0.18)
        + smooth_note(time, 0.47, 0.28, 587.33, 0.38, 0.18)
    )


def success(time: float) -> float:
    return smooth_note(time, 0.045, 0.24, 587.33, 0.38) + smooth_note(
        time, 0.20, 0.23, 739.99, 0.36
    )


def error(time: float) -> float:
    return smooth_note(time, 0.055, 0.29, 220.00, 0.52, 0.07) + smooth_note(
        time, 0.31, 0.25, 174.61, 0.48, 0.07
    )


def warning(time: float) -> float:
    return smooth_note(time, 0.055, 0.24, 329.63, 0.48, 0.09) + smooth_note(
        time, 0.36, 0.24, 329.63, 0.46, 0.09
    )


SOUNDS: dict[str, tuple[float, Callable[[float], float]]] = {
    "new-order.wav": (1.00, new_order),
    "cashier-notification.wav": (0.65, cashier_notification),
    "payment-success.wav": (0.72, payment_success),
    "customer-order-success.wav": (0.80, customer_order_success),
    "success.wav": (0.48, success),
    "error.wav": (0.62, error),
    "warning.wav": (0.68, warning),
}


def render(duration: float, generator: Callable[[float], float]) -> list[int]:
    frame_count = round(duration * SAMPLE_RATE)
    samples = [generator(index / SAMPLE_RATE) for index in range(frame_count)]
    for index, sample in enumerate(samples):
        time = index / SAMPLE_RATE
        edge_fade = min(1.0, time / 0.008, (duration - time) / 0.025)
        samples[index] = sample * max(0.0, edge_fade)

    peak = max(abs(sample) for sample in samples)
    scale = TARGET_PEAK / peak if peak else 1.0
    pcm = [round(max(-1.0, min(1.0, sample * scale)) * 32_767) for sample in samples]
    pcm[0] = 0
    pcm[-1] = 0
    return pcm


def write_sound(filename: str, duration: float, generator: Callable[[float], float]) -> None:
    samples = render(duration, generator)
    path = OUTPUT_DIR / filename
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    print(f"{filename}: {len(samples) / SAMPLE_RATE:.3f}s, peak={max(map(abs, samples)) / 32767:.3f}")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for filename, (duration, generator) in SOUNDS.items():
        write_sound(filename, duration, generator)


if __name__ == "__main__":
    main()
