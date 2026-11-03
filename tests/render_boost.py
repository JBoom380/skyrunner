"""SKYRUNNER boost variants: renders NR.audio._renderBoost(3.5, v) for v = 0..3 in one headless Chromium page
(index.html served on port 8774), writes 44.1 kHz 16-bit mono WAVs peak-normalized to -1 dBFS, then reports the
energy share below 150 Hz, 150-3000 Hz and above 3000 Hz over 0.8-2.2 s (boost held 0.4-2.4 s).
Usage: python -I tests/render_boost.py"""
import os, subprocess, sys, time, wave
import numpy as np
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'tests', 'out')
PORT = 8774
SR = 44100
TARGET = 10 ** (-1 / 20)  # -1 dBFS peak
FILES = {0: 'boost_v0_current.wav', 1: 'boost_v1_afterburner.wav', 2: 'boost_v2_heavy.wav', 3: 'boost_v3_roar.wav'}
# afterburner vs v0: low band at least 1.4x, high band at most 0.5x. A 2x low-band share is out of reach: the
# unchanged engine bed already holds ~59 % of v0 below 150 Hz, so the share cannot exceed 1 / 0.59 = 1.69x.
LOW_RATIO, HIGH_RATIO = 1.4, 0.5

def write_wav(path, x):
    x = x / np.abs(x).max() * TARGET
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(np.round(x * 32767).astype('<i2').tobytes())

def read_wav(path):
    with wave.open(path, 'rb') as w:
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32767.0

def stats(x):
    peak = float(np.abs(x).max())
    rms = float(np.sqrt((x ** 2).mean()))
    seg = x[int(0.8 * SR): int(2.2 * SR)]
    seg = seg * np.hanning(len(seg))
    p = np.abs(np.fft.rfft(seg)) ** 2
    f = np.fft.rfftfreq(len(seg), 1 / SR)
    tot = p.sum()
    low = p[f < 150].sum() / tot
    mid = p[(f >= 150) & (f < 3000)].sum() / tot
    high = p[f >= 3000].sum() / tot
    return peak, rms, low, mid, high

os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-I', '-m', 'http.server', str(PORT)], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print('server pid', srv.pid, 'port', PORT)
errors = []
results = {}
try:
    time.sleep(1.0)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--use-angle=d3d11', '--enable-gpu'])
        page = b.new_page()
        page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        page.goto(f'http://127.0.0.1:{PORT}/index.html')
        page.wait_for_function("window.NR && NR.audio && typeof NR.audio._renderBoost === 'function'", timeout=60000)
        for v in range(4):
            data = page.evaluate('v => NR.audio._renderBoost(3.5, v).then(d => Array.from(d))', v)
            x = np.asarray(data, dtype=np.float64)
            if x.size == 0 or np.isnan(x).any():
                errors.append(f'v{v}: empty or NaN render')
                continue
            path = os.path.join(OUT, FILES[v])
            write_wav(path, x)
            results[v] = (path, stats(read_wav(path)))
        b.close()
finally:
    srv.terminate()
    try:
        srv.wait(5)
    except subprocess.TimeoutExpired:
        srv.kill()
    print('server pid', srv.pid, 'stopped')

print(f"{'ver':<4}{'peak dBFS':>10}{'rms dBFS':>10}{'<150 Hz':>10}{'150-3k':>10}{'>3 kHz':>10}  file")
for v in sorted(results):
    path, (peak, rms, low, mid, high) = results[v]
    print(f"v{v:<3}{20 * np.log10(peak):>10.2f}{20 * np.log10(rms):>10.2f}{low:>10.3f}{mid:>10.3f}{high:>10.3f}  {path}")

fails = list(errors)
if 0 in results:
    _, _, l0, _, h0 = results[0][1]
    for v in (1, 2, 3):
        if v not in results:
            continue
        _, _, lv, _, hv = results[v][1]
        ok_low = lv >= LOW_RATIO * l0
        ok_high = hv <= HIGH_RATIO * h0
        print(f"v{v} low {lv / l0:.2f}x v0 ({'PASS' if ok_low else 'FAIL'}), high {hv / h0:.2f}x v0 ({'PASS' if ok_high else 'FAIL'})")
        if not ok_low: fails.append(f'v{v} low band not {LOW_RATIO}x v0')
        if not ok_high: fails.append(f'v{v} high band not below {HIGH_RATIO}x v0')
else:
    fails.append('v0 missing')
if errors:
    print('errors:', errors)
sys.exit(1 if fails else 0)
