#!/usr/bin/env python3
"""Make Orbique's alert sounds: one tone for each kind of alert, so a glance at the phone is not needed to know what came in.

    python3 scripts/alert-sound.py

Standard library only (math, struct, wave), so anyone can re-run it and get the same files byte for byte.
The sounds are made from sine waves here, so there is no copyright to worry about. Each tone is 16-bit mono 44.1 kHz:

  booking   orbique_alert.wav    new booking: a bright rising bell chime (G5, C6, E6). Unchanged since the first build,
                                  so phones keep their "alerts_loud" channel.
  change    orbique_change.wav   cancellation or date change: two falling bells (E6, B5), a "heads up"
  message   orbique_message.wav  new guest message: a quick double "ding ding" (G6, G6)
  team      orbique_team.wav     new Team chat message: a soft rising "bloop", like a chat app
  task      orbique_task.wav     new task for you: two short wooden marimba knocks (A4, E5)

Each file is written to:
  android/app/src/main/res/raw/<name>.wav   the phone notification channels (app/native/bridge.js) and the FCM sound
                                            (api/_lib/alerts.js)
  ios/App/App/<name>.wav                    the APNs sound (in the Xcode project's resources)
  public/sounds/<name>.wav                  the in-app player O.alertSound (app/core.js); the phone app gets a copy in
                                            mobile/www/sounds/ (scripts/build.mjs --mobile)

How the bells are made, so they cut through a noisy room without being harsh:
  - each note is a bell: the fundamental plus a soft octave and fifth above it, each fading at its own rate
  - a 3 ms attack gives a clear "ding" start; a 25 ms fade at the very end stops any click
  - a gentle tanh saturation lifts the quieter tail, then the whole sound is normalised to -0.5 dBFS (no clipping)
Change TONES below and re-run to change a sound. Android notification channels cannot change their sound once made,
so a changed file under the same name only reaches phones that install the app fresh: give it a new name and channel.
The same notes are in O.alertSound (app/core.js TONES) for when the file cannot be loaded; keep them in step.
"""
import math, os, struct, wave

RATE = 44100
PEAK = 10 ** (-0.5 / 20)         # -0.5 dBFS
ATTACK = 0.003
TAIL_FADE = 0.025
DRIVE = 1.6                      # tanh saturation: higher is louder but rougher

BELL = [                         # (frequency ratio, level, decay in seconds)
    (1.0, 1.00, 0.42),
    (2.0, 0.38, 0.20),
    (3.0, 0.16, 0.10),
    (4.2, 0.07, 0.05),           # a slightly inharmonic shimmer, like a small bell
]
SHORT_BELL = [(1.0, 1.00, 0.22), (2.0, 0.30, 0.10), (3.0, 0.12, 0.06)]
MARIMBA = [(1.0, 1.00, 0.16), (4.0, 0.30, 0.03), (9.8, 0.10, 0.012)]
BLOOP = [(1.0, 1.00, 0.12), (2.0, 0.12, 0.06)]

# name -> (file, length in seconds, notes); a note is (start s, frequency Hz, loudness, partials, glide to Hz or None)
PLUCK = [(1.0, 1.00, 0.30), (2.0, 0.45, 0.12), (3.0, 0.20, 0.06), (4.0, 0.10, 0.03)]
BEEP = [(1.0, 1.00, 0.06), (3.0, 0.15, 0.03)]
GLASS = [(1.0, 1.00, 0.60), (2.76, 0.30, 0.25), (5.4, 0.12, 0.10)]
PAD = [(1.0, 1.00, 0.55), (2.0, 0.20, 0.30)]

# The tune library: name -> (file, length in seconds, notes); a note is (start s, frequency Hz, loudness, partials,
# glide to Hz or None). Every alert type can use any tune (Automations, Booking alerts); the defaults per type are the
# first five, so phones that have not chosen keep their first channels.
TONES = {
    'chime':    ('orbique_alert', 1.3, [(0.00, 783.99, 0.80, BELL, None), (0.14, 1046.50, 0.90, BELL, None), (0.28, 1318.51, 1.00, BELL, None)]),
    'falling':  ('orbique_change', 1.1, [(0.00, 1318.51, 1.00, BELL, None), (0.20, 987.77, 0.95, BELL, None)]),
    'dingding': ('orbique_message', 0.9, [(0.00, 1567.98, 0.90, SHORT_BELL, None), (0.16, 1567.98, 1.00, SHORT_BELL, None)]),
    'bloop':    ('orbique_team', 0.5, [(0.00, 520.00, 1.00, BLOOP, 880.00)]),
    'marimba':  ('orbique_task', 0.7, [(0.00, 440.00, 0.90, MARIMBA, None), (0.15, 659.25, 1.00, MARIMBA, None)]),
    'sparkle':  ('orbique_sparkle', 0.9, [(0.00, 2093.00, 0.8, SHORT_BELL, None), (0.07, 1760.00, 0.8, SHORT_BELL, None), (0.14, 1567.98, 0.85, SHORT_BELL, None), (0.21, 1318.51, 1.0, SHORT_BELL, None)]),
    'doorbell': ('orbique_doorbell', 1.4, [(0.00, 659.25, 1.00, BELL, None), (0.42, 523.25, 1.00, BELL, None)]),
    'harp':     ('orbique_harp', 1.2, [(0.00, 523.25, 0.7, PLUCK, None), (0.06, 659.25, 0.75, PLUCK, None), (0.12, 783.99, 0.8, PLUCK, None), (0.18, 1046.50, 0.9, PLUCK, None), (0.24, 1318.51, 1.0, PLUCK, None)]),
    'beeps':    ('orbique_beep', 0.7, [(0.00, 1760.00, 1.0, BEEP, None), (0.18, 1760.00, 1.0, BEEP, None), (0.36, 1760.00, 1.0, BEEP, None)]),
    'glass':    ('orbique_glass', 1.4, [(0.00, 1174.66, 1.0, GLASS, None), (0.25, 1567.98, 0.9, GLASS, None)]),
    'pad':      ('orbique_pad', 1.3, [(0.00, 523.25, 0.8, PAD, None), (0.00, 783.99, 0.6, PAD, None), (0.30, 659.25, 0.8, PAD, None)]),
    'urgent':   ('orbique_urgent', 1.0, [(0.00, 880.00, 1.0, SHORT_BELL, None), (0.15, 1318.51, 1.0, SHORT_BELL, None), (0.30, 880.00, 1.0, SHORT_BELL, None), (0.45, 1318.51, 1.0, SHORT_BELL, None)]),
}
FOLDERS = ['android/app/src/main/res/raw', 'ios/App/App', 'public/sounds']
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))


def render(length, notes):
    n = int(RATE * length)
    out = [0.0] * n
    for start, freq, level, partials, glide in notes:
        s0 = int(start * RATE)
        phase = [0.0] * len(partials)
        for i in range(s0, n):
            t = (i - s0) / RATE
            env = min(1.0, t / ATTACK)
            f = freq if glide is None else freq + (glide - freq) * min(1.0, t / 0.12)
            v = 0.0
            for k, (ratio, amp, decay) in enumerate(partials):
                if glide is None:
                    v += amp * math.exp(-t / decay) * math.sin(2 * math.pi * freq * ratio * t)
                else:            # a sliding pitch: add up the phase step by step
                    phase[k] += 2 * math.pi * f * ratio / RATE
                    v += amp * math.exp(-t / decay) * math.sin(phase[k])
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
    for kind, (name, length, notes) in TONES.items():
        samples = render(length, notes)
        for folder in FOLDERS:
            write(os.path.join(ROOT, folder, name + '.wav'), samples)
        rms = math.sqrt(sum(x * x for x in samples) / len(samples))
        print('%-9s %s.wav  %.2f s, RMS %.1f dBFS' % (kind, name, len(samples) / RATE, 20 * math.log10(rms)))


if __name__ == '__main__':
    main()
