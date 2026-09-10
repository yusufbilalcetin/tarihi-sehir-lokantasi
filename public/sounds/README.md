# Sound assets

These notification sounds are original, locally synthesized assets. They were
generated with Python's standard library by `scripts/generate-original-sounds.py`;
no external recording, copyrighted audio source, or third-party package is used.

All files are 44.1 kHz, mono, 16-bit PCM WAV with short attack/release envelopes
and a peak below full scale:

- `new-order.wav` — distinct two-strike service bell for the kitchen
- `cashier-notification.wav` — soft two-note cashier notification
- `payment-success.wav` — short ascending payment confirmation
- `customer-order-success.wav` — warm customer order confirmation
- `success.wav` — lightweight general success tone
- `error.wav` — restrained low two-note operation error
- `warning.wav` — two-pulse attention tone

Run `python scripts/generate-original-sounds.py` from the repository root to
reproduce every asset byte-for-byte.
