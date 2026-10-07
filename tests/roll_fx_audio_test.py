"""Round 2 test for fx.js + audio.js: roll ribbons/whoosh, lightning ring + bolt, roll whoosh sound, hazard sounds.
Usage: python tests/roll_fx_audio_test.py"""
import json
import math
import os
import socket
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "shots", "round2_fx_audio")
os.makedirs(OUT, exist_ok=True)


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


port = free_port()
srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "tests", "range_server.py"), str(port)], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
results, fails = {}, []


def check(name, ok, info=""):
    results[name] = ("PASS" if ok else "FAIL") + (f" ({info})" if info else "")
    if not ok:
        fails.append(name)


FPS_JS = """() => new Promise(res => { const a = []; let l = performance.now(); const t0 = l;
    function f(n) { a.push(n - l); l = n; if (n - t0 < 5000) requestAnimationFrame(f); else {
      a.sort((x, y) => x - y); res({ fps: 1000 / (a.reduce((s, x) => s + x, 0) / a.length), p95: a[Math.floor(a.length * .95)] }); } }
    requestAnimationFrame(f); })"""
# press ROLL through the controls state (player reads it next frame); fall back to fx/audio direct calls if player has no roll
ROLL_JS = """([x, y, boost]) => { const s = NR.controls && NR.controls.state; const P = NR.player;
    if (P) P.rollCooldown = 0;
    if (s && P && 'rolling' in P) { s.roll = true; s.rollX = x; s.rollY = y; s.mx = x; s.my = y; if (boost) s.boost = true; return 'player'; }
    NR.bus.emit('roll', { dir: { x, y }, boost }); return 'event'; }"""

try:
    time.sleep(0.8)
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=["--use-angle=d3d11", "--enable-gpu"])
        ctx = br.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
        page = ctx.new_page()
        errs, mine = [], []

        def on_console(m):
            if m.type == "error":
                errs.append(m.text)
                if "nr.fx" in m.text.lower() or "nr.audio" in m.text.lower():
                    mine.append(m.text)
        page.on("console", on_console)
        page.on("pageerror", lambda e: (errs.append(str(e)), mine.append(str(e)) if ("fx.js" in (e.stack or "") or "audio.js" in (e.stack or "")) else None))
        page.goto(f"http://127.0.0.1:{port}/src/dev.html")
        page.wait_for_function("window.READY === true", timeout=20000)
        page.wait_for_timeout(1200)
        page.touchscreen.tap(195, 420)  # unlock audio
        page.wait_for_timeout(500)
        check("audio running", page.evaluate("NR.audio._status().ctx") == "running")
        check("fx api", page.evaluate("!!(NR.fx.roll && NR.fx.strike && NR.fx.bolt && NR.fx.stats().hasOwnProperty('ribbon'))"))
        check("audio api", page.evaluate("typeof NR.audio.hazard === 'function'"))

        page.evaluate("NR.core.start()")
        page.wait_for_timeout(1500)
        page.evaluate("NR.core.dist = 1.5 * NR.cfg.DISTRICT_LEN; NR.core.speed = 110")
        page.wait_for_timeout(800)

        # ---- roll right ----
        v0 = page.evaluate("NR.audio._status().voices")
        how = page.evaluate(ROLL_JS, [1, 0, False])
        page.wait_for_timeout(140)
        page.screenshot(path=os.path.join(OUT, "01_roll_right_140ms.png"))
        st = page.evaluate("NR.fx.stats()")
        v1 = page.evaluate("NR.audio._status().voices")
        check("roll ribbon visible", st["ribbon"] > 3, f"via {how}, {json.dumps(st)}")
        check("roll whoosh voice plays", v1 > v0, f"voices {v0} -> {v1}")
        page.wait_for_timeout(160)
        page.screenshot(path=os.path.join(OUT, "02_roll_right_300ms.png"))
        page.wait_for_timeout(1200)
        st = page.evaluate("NR.fx.stats()")
        check("ribbon gone after roll", st["ribbon"] == 0, json.dumps(st))
        page.evaluate("NR.controls && (NR.controls.state.mx = 0, NR.controls.state.my = 0)")

        # ---- boost roll up ----
        page.evaluate(ROLL_JS, [0, 1, True])
        page.wait_for_timeout(180)
        page.screenshot(path=os.path.join(OUT, "03_roll_up_boost_180ms.png"))
        page.wait_for_timeout(1200)
        page.evaluate("NR.controls && (NR.controls.state.boost = false, NR.controls.state.mx = 0, NR.controls.state.my = 0)")

        # ---- centred spin, left roll ----
        page.evaluate(ROLL_JS, [-1, 0, False])
        page.wait_for_timeout(220)
        page.screenshot(path=os.path.join(OUT, "04_roll_left_220ms.png"))
        page.wait_for_timeout(1200)
        page.evaluate("NR.controls && (NR.controls.state.mx = 0, NR.controls.state.my = 0)")

        # ---- lightning: ring then bolt, through hazard events ----
        page.evaluate("NR.core.dist = 4 * NR.cfg.DISTRICT_LEN + 100")
        page.wait_for_timeout(1500)
        page.evaluate("""() => { const p = NR.player.pos; window._lp = new THREE.Vector3(p.x + 4, p.y + 1, -(NR.core.speed + 40) * 1.2); window._ld = NR.core.dist;
            NR.bus.emit('hazard', { kind: 'lightning', phase: 'warn', pos: window._lp }); }""")
        page.wait_for_timeout(900)
        page.screenshot(path=os.path.join(OUT, "05_lightning_ring_900ms.png"))
        st = page.evaluate("NR.fx.stats()")
        check("lightning ring shown", st["strikes"] >= 1, json.dumps(st))
        page.evaluate("window._lp.z += NR.core.dist - window._ld; NR.bus.emit('hazard', { kind: 'lightning', phase: 'active', pos: window._lp })")
        page.wait_for_timeout(50)
        page.screenshot(path=os.path.join(OUT, "06_lightning_bolt_50ms.png"))
        st = page.evaluate("NR.fx.stats()")
        check("bolt spawns lines, ring cleared", st["lines"] > 15 and st["strikes"] == 0, json.dumps(st))

        # ---- hazard sounds: every kind, warn + active ----
        kinds = ["spotted", "drone", "flame", "steam", "laser", "shutter", "gantry", "dust", "debris", "lightning", "wave"]
        res = page.evaluate("""async (kinds) => { const out = {}; const p = NR.player.pos;
            for (const k of kinds) for (const ph of ['warn', 'active']) {
              const a = NR.audio._status().voices;
              NR.bus.emit('hazard', { kind: k, phase: ph, pos: { x: p.x + 5, y: p.y, z: -30 } });
              out[k + ':' + ph] = NR.audio._status().voices - a;
              await new Promise(r => setTimeout(r, 450));
            } return out; }""", kinds)
        silent = [k for k, v in res.items() if v < 1 and not k.startswith(("spotted:active", "drone:active", "drone:warn"))]
        check("every hazard kind/phase starts a voice", not silent, json.dumps(res))
        # spotted spam every frame for 1 s: hum up, chirps throttled
        spam = page.evaluate("""() => new Promise(res => { const a = NR.audio._status().voices; let n = 0, mx = 0;
            function f() { NR.bus.emit('hazard', { kind: 'spotted', pos: NR.player.pos }); mx = Math.max(mx, NR.audio._status().voices - a);
              if (++n < 60) requestAnimationFrame(f); else setTimeout(() => res({ mx, drone: NR.audio._status().drone, spotted: NR.audio._status().spotted }), 100); }
            requestAnimationFrame(f); })""")
        check("spotted: drone hum up, chirps throttled", spam["drone"] > 0.03 and spam["mx"] <= 3, json.dumps(spam))
        page.wait_for_timeout(1500)
        check("drone hum fades after spotted ends", page.evaluate("NR.audio._status().drone") < 0.01)

        # ---- offline renders: level + sanity for every new voice ----
        voices = [("roll", 0.8, {"pan": 1}), ("roll", 0.7, {"pan": -1, "boost": True}), ("hzChirp", 0.3, {}),
                  ("hzFlame", 1.3, {"phase": "warn"}), ("hzFlame", 1.3, {"phase": "active"}), ("hzLaser", 0.7, {"phase": "warn"}),
                  ("hzLaser", 0.4, {"phase": "active"}), ("hzClank", 0.8, {"phase": "warn"}), ("hzClank", 1.0, {"phase": "active"}),
                  ("hzGust", 1.8, {"phase": "active"}), ("hzGust", 1.0, {"phase": "warn", "steam": True}), ("hzDebris", 1.4, {"phase": "warn"}),
                  ("hzDebris", 0.8, {"phase": "active"}), ("hzLightning", 1.3, {"phase": "warn"}), ("hzLightning", 0.8, {"phase": "active"}),
                  ("hzWave", 1.4, {"phase": "warn"}), ("hzWave", 1.8, {"phase": "active"})]
        levels, bad = {}, []
        for name, sec, o in voices:
            d = page.evaluate("([n, s, o]) => NR.audio._render(n, s, o).then(d => { let pk = 0, ss = 0, nan = false; for (const x of d) { if (x !== x) nan = true; pk = Math.max(pk, Math.abs(x)); ss += x * x; } return { pk, rms: Math.sqrt(ss / d.length), nan, end: Math.abs(d[d.length - 1]) }; })", [name, sec, o])
            key = name + ":" + (o.get("phase") or ("boost" if o.get("boost") else "")) + ("/steam" if o.get("steam") else "")
            levels[key] = f"pk {d['pk']:.2f} rms {d['rms']:.3f}"
            if d["nan"] or d["pk"] < 0.03 or d["pk"] > 1.6 or d["end"] > 0.05:
                bad.append(key + " " + json.dumps(d))
        check("offline renders audible, finite, decay to silence", not bad, "; ".join(bad))
        results["levels (info)"] = ", ".join(f"{k} {v}" for k, v in levels.items())
        rb = page.evaluate("Promise.all([NR.audio._render('roll', 0.8, {pan: 0}), NR.audio._render('roll', 0.7, {pan: 0, boost: true})]).then(([a, b]) => { const r = d => Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length); return [r(a), r(b)]; })")
        check("boost roll louder", rb[1] > rb[0] * 1.15, f"rms {rb[0]:.3f} vs {rb[1]:.3f}")

        # ---- fps: later difficulty, rolling every 1.1 s + hazards ----
        page.evaluate("NR.core.loop = 1; NR.core.dist = 5 * NR.cfg.DISTRICT_LEN + 2 * NR.cfg.DISTRICT_LEN + 50; NR.core.speed = 140")
        page.wait_for_timeout(1000)
        page.evaluate("""() => { let i = 0; window._rt = setInterval(() => { const s = NR.controls && NR.controls.state; const d = [[1,0],[-1,0],[0,1],[0,-1]][i++ % 4];
            if (NR.player) NR.player.rollCooldown = 0; if (s) { s.roll = true; s.rollX = d[0]; s.rollY = d[1]; } else NR.fx.roll({x: d[0], y: d[1]});
            const p = NR.player.pos; NR.bus.emit('hazard', { kind: 'lightning', phase: i % 2 ? 'warn' : 'active', pos: { x: p.x, y: p.y, z: -60 } }); }, 1100); }""")
        fps = page.evaluate(FPS_JS)
        check("fps rolling + hazards >= 55", fps["fps"] >= 55, f"{fps['fps']:.1f} fps, p95 {fps['p95']:.1f} ms")
        page.screenshot(path=os.path.join(OUT, "07_cycle2_rolling.png"))
        page.evaluate("clearInterval(window._rt)")

        # reset clears ribbons + rings
        page.evaluate("NR.bus.emit('hazard', { kind: 'lightning', phase: 'warn', pos: { x: 0, y: 5, z: -60 } }); NR.core.start()")
        page.wait_for_timeout(100)
        st = page.evaluate("NR.fx.stats()")
        check("reset clears ribbon + rings", st["ribbon"] == 0 and st["strikes"] == 0, json.dumps(st))
        check("zero fx/audio console errors", not mine, "; ".join(mine)[:400])
        results["all console errors (info)"] = str(len(errs)) + (": " + " | ".join(e[:140] for e in errs[:6]) if errs else "")
        br.close()
finally:
    srv.terminate()
    try:
        srv.wait(5)
    except Exception:
        srv.kill()

for k, v in results.items():
    print(f"{k}: {v}")
print("shots:", OUT)
print("RESULT:", "FAIL " + ", ".join(fails) if fails else "ALL PASS")
sys.exit(1 if fails else 0)
