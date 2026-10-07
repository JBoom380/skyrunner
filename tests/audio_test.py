"""NR.audio test: real page in Playwright Chromium (mobile 390x844, touch).
Checks unlock on first tap, playlist order + preload rule, volume/duck, every SFX event, fps, and renders each
synthesized voice offline to WAV + a spectrogram sheet. Usage: python tests/audio_test.py [outdir]"""
import json, os, socket, subprocess, sys, time, wave
import numpy as np
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, 'tests', 'out')
os.makedirs(OUT, exist_ok=True)

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

port = free_port()
# http.server plus Range support (media seeking); a static host such as GitHub Pages also serves ranges
srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'tests', 'range_server.py'), str(port)], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
results, errors = [], []
def check(name, ok, info=''):
    results.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name + (('  ' + str(info)) if info else ''))

try:
    time.sleep(0.8)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--use-angle=d3d11', '--enable-gpu'])
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, device_scale_factor=1)
        page = ctx.new_page()
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        page.goto(f'http://127.0.0.1:{port}/src/dev.html')
        page.wait_for_function('window.READY === true', timeout=20000)
        st = lambda: page.evaluate('NR.audio._status()')

        s0 = st()
        check('api present', page.evaluate("['init','update','reset','setMusic','setSfx'].every(k => typeof NR.audio[k] === 'function')"))
        check('before tap: no context, track 0 named', s0['ctx'] == 'none' and s0['nowPlaying'] == 'RAINY SAX', s0['nowPlaying'])

        page.touchscreen.tap(195, 420)
        page.wait_for_timeout(2000)
        s1 = st()
        check('tap unlocks WebAudio', s1['ctx'] == 'running', s1['ctx'])
        check('track 0 plays on title', (not s1['paused']) and s1['time'] > 0.3 and 'rainy_sax' in s1['src'], f"t={s1['time']:.2f} {s1['src'][-20:]}")
        check('track 1 preload starts only after track 0 plays', 'old_school_test_1' in s1['preload'], s1['preload'][-24:])
        check('music routed through gain', s1['routed'] and abs(s1['musicGain'] - 0.7) < 0.05, s1['musicGain'])
        check('engine idles on title', 0 < s1['eng'] < 0.1, round(s1['eng'], 3))

        page.evaluate('NR.core.start()'); page.wait_for_timeout(800)
        s2 = st()
        check('PLAY: engine + wind up, music not restarted', s2['eng'] > 0.04 and s2['wind'] > 0.04 and s2['time'] > s1['time'] and 'rainy_sax' in s2['src'],
              f"eng={s2['eng']:.3f} wind={s2['wind']:.3f} t={s2['time']:.1f}")

        # every SFX event
        page.evaluate("""() => { const B = NR.bus, V = THREE.Vector3;
          B.emit('nearMiss', {pos: new V(4, 0, 0), dist: 1.5}); B.emit('hit', {hull: 2, kind: 'car'});
          B.emit('boost', {on: true}); B.emit('siren', {}); B.emit('lightning', {});
          B.emit('district', {index: 1, name: 'FIRE STACKS', loop: 0}); B.emit('ui', {action: 'click'}); B.emit('ui', {action: 'start'}); }""")
        page.wait_for_timeout(120)
        v1 = st()['voices']
        page.wait_for_timeout(500)
        sb = st()
        check('all event voices fire', v1 >= 7, v1)
        check('boost roar sustains while boosting', sb['boost'] > 0.15, round(sb['boost'], 3))
        page.evaluate("NR.bus.emit('boost', {on: false})"); page.wait_for_timeout(1500)
        check('boost roar releases', st()['boost'] < 0.05, round(st()['boost'], 3))
        page.wait_for_timeout(3500)
        check('voices are freed (no leak)', st()['voices'] == 0, st()['voices'])

        # volume + duck
        page.evaluate('NR.audio.setMusic(0.3)'); page.wait_for_timeout(500)
        m1 = st()['musicGain']
        page.evaluate('NR.core.pause(true)'); page.wait_for_timeout(500)
        m2, ep = st()['musicGain'], st()['eng']
        page.evaluate('NR.core.pause(false)'); page.wait_for_timeout(500)
        m3 = st()['musicGain']
        check('setMusic(0.3)', abs(m1 - 0.3) < 0.02, round(m1, 3))
        check('pause ducks 50%, loops silent', abs(m2 - 0.15) < 0.02 and ep < 0.01, f'{m2:.3f} eng={ep:.4f}')
        check('resume restores', abs(m3 - 0.3) < 0.02, round(m3, 3))
        page.evaluate('NR.core.settings.music = 0.5'); page.wait_for_timeout(500)
        check('follows core.settings.music written by ui', abs(st()['musicGain'] - 0.5) < 0.02, round(st()['musicGain'], 3))
        page.evaluate('NR.audio.setSfx(0.4)'); page.wait_for_timeout(300)
        check('setSfx(0.4)', abs(st()['sfxGain'] - 0.4) < 0.02 and abs(page.evaluate('NR.core.settings.sfx') - 0.4) < 1e-6, round(st()['sfxGain'], 3))
        page.evaluate('NR.audio.setSfx(0.8); NR.audio.setMusic(0.7)')

        # fps in PLAY (audio running)
        fps = page.evaluate("""() => new Promise(r => { const a = []; let l = performance.now(), e = l + 5000;
          function f(n) { a.push(n - l); l = n; if (n < e) requestAnimationFrame(f); else { a.sort((x, y) => x - y);
            r({ fps: 1000 / (a.reduce((x, y) => x + y, 0) / a.length), p95: a[Math.floor(a.length * 0.95)] }); } } requestAnimationFrame(f); })""")
        check('fps >= 55 in PLAY', fps['fps'] >= 55, f"{fps['fps']:.1f} fps, p95 frame {fps['p95']:.1f} ms")

        # crash
        page.evaluate("NR.bus.emit('crash', {})"); page.wait_for_timeout(600)
        sc = st(); check('crash: loops fade (DEAD)', page.evaluate('NR.core.state') == 'DEAD' and sc['eng'] < 0.05, f"eng={sc['eng']:.3f}")

        # playlist: 0 -> 1 -> 0 with no restart in between
        page.evaluate("(() => { const e = NR.audio._el(); e.currentTime = e.duration - 1.2; })()")
        page.wait_for_function("NR.audio.nowPlaying === 'OLD SCHOOL TEST 1' && NR.audio._el().currentTime > 0.3", timeout=15000)
        s3 = st(); check('track 0 ends -> track 1', 'old_school_test_1' in s3['src'] and not s3['paused'], s3['nowPlaying'])
        page.evaluate("(() => { const e = NR.audio._el(); e.currentTime = e.duration - 1.2; })()")
        page.wait_for_function("NR.audio.nowPlaying === 'RAINY SAX' && NR.audio._el().currentTime > 0.3", timeout=15000)
        s4 = st(); check('track 1 ends -> track 0 again', 'rainy_sax' in s4['src'] and not s4['paused'], s4['nowPlaying'])
        page.evaluate('NR.core.toTitle()'); page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(OUT, 'audio_title.png'))

        # offline renders of every voice
        voices = [('nearMiss', 0.7, {'pan': 0.6}), ('hit', 0.8, None), ('crash', 3.0, None), ('boost', 0.7, None), ('siren', 1.2, None),
                  ('thunder', 4.3, None), ('ui', 0.3, {'kind': 'click'}), ('ui', 0.3, {'kind': 'confirm'}), ('district', 2.4, None)]
        rend = []
        for name, sec, o in voices:
            data = page.evaluate('([n, s, o]) => NR.audio._render(n, s, o).then(d => Array.from(d))', [name, sec, o])
            x = np.array(data, dtype=np.float32); tag = name + ('_' + o['kind'] if o and 'kind' in o else '')
            peak, rms = float(np.abs(x).max()), float(np.sqrt((x ** 2).mean()))
            bad = bool(np.isnan(x).any())
            check(f'voice {tag}: audible, no NaN', peak > 0.05 and not bad, f'peak={peak:.2f} rms={rms:.3f}')
            with wave.open(os.path.join(OUT, f'sfx_{tag}.wav'), 'wb') as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100); w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
            rend.append((tag, x))
        try:
            import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
            fig, ax = plt.subplots(len(rend), 1, figsize=(8, 1.6 * len(rend)), facecolor='#050609')
            for a, (tag, x) in zip(ax, rend):
                a.specgram(x + 1e-9, NFFT=512, Fs=44100, noverlap=384, cmap='inferno'); a.set_ylim(0, 8000)
                a.set_title(tag, color='#e8c890', fontsize=9, loc='left'); a.tick_params(colors='#8fb0b4', labelsize=7)
            fig.tight_layout(); fig.savefig(os.path.join(OUT, 'sfx_spectrograms.png'), dpi=80); plt.close(fig)
        except ImportError:
            pass
        b.close()

    mine = [e for e in errors if 'audio' in e.lower() or 'NR.audio' in e]
    other = [e for e in errors if e not in mine]
    check('zero console errors from audio', not mine, mine[:3])
    print('other-module console errors (not audio):', len(other), json.dumps(sorted(set(o[:90] for o in other)))[:400])
finally:
    srv.terminate()
    try: srv.wait(5)
    except Exception: srv.kill()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed; out: {OUT}')
sys.exit(1 if fails else 0)
