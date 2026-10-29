#!/usr/bin/env python3
"""Make Orbique's alert sound: a bright three-note rising chime (G5, C6, E6), about 1.3 seconds.

    python3 scripts/alert-sound.py

Standard library only (math, struct, wave), so anyone can re-run it and get the same file byte for byte.
The sound is made from sine waves here, so there is no copyright to worry about. Writes the same
16-bit mono 44.1 kHz WAV to:

  android/app/src/main/res/raw/orbique_alert.wav   the phone notification channel "alerts_loud" (app/native/bridge.js)
                                                   and the FCM payload's android sound "orbique_alert" (api/_lib/alerts.js)
  ios/App/App/orbique_alert.wav                    the APNs sound "orbique_alert.wav" (in the Xcode project's resources)
  public/sounds/orbique_alert.wav                  the in-app player O.alertSound (app/core.js); the phone app gets a
                                                   copy in mobile/www/sounds/ (scripts/build.mjs --mobile)

How it is made, so it cuts through a noisy room without being harsh:
  - each note is a bell: the fundamental plus a soft octave and fifth above it, each fading at its own rate
  - a 3 ms attack gives a clear "ding" start; a 25 ms fade at the very end stops any click
  - a gentle tanh saturation lifts the quieter tail, then the whole sound is normalised to -0.5 dBFS (no clipping)
Change NOTES or the constants below and re-run to change the sound. Android notification channels cannot change
their sound once made, so a new sound file under the same name only reaches phones that install the app fresh.
"""
import math, os, struct, wave

RATE = 44100
LENGTH = 1.3                     # seconds
PEAK = 10 ** (-0.5 / 20)         # -0.5 dBFS
NOTES = [                        # (start in seconds, frequency in Hz, loudness)
    (0.00, 783.99, 0.80),        # G5
    (0.14, 1046.50, 0.90),       # C6
    (0.28, 1318.51, 1.00),       # E6, rings out longest
]
PARTIALS = [                     # (frequency ratio, level, decay in seconds)
    (1.0, 1.00, 0.42),
    (2.0, 0.38, 0.20),
    (3.0, 0.16, 0.10),
    (4.2, 0.07, 0.05),           # a slightly inharmonic shimmer, like a small bell
]
ATTACK = 0.003
TAIL_FADE = 0.025
DRIVE = 1.6                      # tanh saturation: higher is louder but rougher

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUTPUTS = [
    'android/app/src/main/res/raw/orbique_alert.wav',
    'ios/App/App/orbique_alert.wav',
    'public/sounds/orbique_alert.wav',
]


def render():
    n = int(RATE * LENGTH)
    out = [0.0] * n
    for start, freq, level in NOTES:
        s0 = int(start * RATE)
        for i in range(s0, n):
            t = (i - s0) / RATE
            env = min(1.0, t / ATTACK)
            v = 0.0
            for ratio, amp, decay in PARTIALS:
                v += amp * math.exp(-t / decay) * math.sin(2 * math.pi * freq * ratio * t)
            out[i] += level * env * v
    # soft saturation, then fade the last few ms to silence
    out = [math.tanh(DRIVE * x) for x in out]
    fade = int(TAIL_FADE * RATE)
    for k in range(fade):
        out[n - fade + k] *= 1 - (k + 1) / fade
    peak = max(abs(x) for x in out) or 1.0
    return [x * PEAK / peak for x in out]


def write(path, samples):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    frames = b''.join(struct.pack('<h', max(-32767, min(32767, int(round(x * 32767))))) for x in samples)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(frames)


def main():
    samples = render()
    for rel in OUTPUTS:
        write(os.path.join(ROOT, rel), samples)
        print('wrote', rel)
    peak = max(abs(x) for x in samples)
    rms = math.sqrt(sum(x * x for x in samples) / len(samples))
    print('%.2f s, peak %.2f dBFS, RMS %.1f dBFS' % (len(samples) / RATE, 20 * math.log10(peak), 20 * math.log10(rms)))


if __name__ == '__main__':
    main()
