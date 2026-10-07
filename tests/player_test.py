"""NR.player test: real page, Playwright Chromium, phone viewport. Run: python tests/player_test.py"""
import os
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SHOTS = os.path.join(ROOT, "tests", "shots")
os.makedirs(SHOTS, exist_ok=True)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


port = free_port()
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails, errors = [], []


def check(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + (" " + str(info) if info else ""))
    if not ok:
        fails.append(name)


try:
    time.sleep(0.8)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-angle=d3d11", "--enable-gpu"])
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{port}/src/dev.html")
        page.wait_for_function("window.READY === true", timeout=20000)
        page.wait_for_timeout(1200)
        page.screenshot(path=os.path.join(SHOTS, "player_title.png"))
        r = page.evaluate("({ok: !!NR.player.car, y: NR.player.pos.y, hull: NR.player.hull, state: NR.core.state})")
        check("title: car built, hovering", r["ok"] and r["state"] == "TITLE", r)

        # events log; controls may be absent, so drive NR.core.input directly when it is the core's own object
        page.evaluate("""() => {
          window.EV = []; for (const e of ['hit','crash','boost','siren','sirenReady']) NR.bus.on(e, d => EV.push(e));
          // controls rewrites the stick/boost every PLAY frame, so test writes are re-applied after controls.update
          window.OV = {}; const raw = () => NR.controls && NR.controls.state ? NR.controls.state : NR.core.input;
          if (NR.controls && typeof NR.controls.update === 'function') { const cu = NR.controls.update;
            NR.controls.update = function () { const r = cu.apply(this, arguments); Object.assign(raw(), OV); return r; }; }
          window.INP = () => new Proxy(raw(), { set(t, k, v) { t[k] = v; OV[k] = v; return true; } });
          // only stubbed hits in this test (real hazards/traffic would hit the car at the corridor edge)
          for (const m of ['world', 'traffic']) if (NR[m] && typeof NR[m].collide === 'function') { NR[m].__real = NR[m].collide; NR[m].collide = () => ({ hit: false }); }
          NR.core.start();
        }""")
        page.wait_for_timeout(300)
        r = page.evaluate("({hull: NR.player.hull, fuel: NR.player.boostFuel, siren: NR.player.siren, alive: NR.player.alive, state: NR.core.state})")
        check("reset on start", r == {"hull": 3, "fuel": 1, "siren": 0, "alive": True, "state": "PLAY"}, r)

        # box size
        r = page.evaluate("(() => { const b = NR.player.box(); return [b.max.x-b.min.x, b.max.y-b.min.y, b.max.z-b.min.z]; })()")
        check("box ~2.6 x 1.4 x 7.5", abs(r[0] - 2.6) < 0.01 and abs(r[1] - 1.4) < 0.01 and abs(r[2] - 7.5) < 0.01, r)

        # steering right + up, bank negative, clamped to corridor
        page.evaluate("INP().mx = 1; INP().my = 1")
        page.wait_for_timeout(250)
        bank = page.evaluate("NR.player.bank")
        page.screenshot(path=os.path.join(SHOTS, "player_bank_right.png"))
        page.wait_for_timeout(2500)
        r = page.evaluate("({x: NR.player.pos.x, y: NR.player.pos.y, z: NR.player.pos.z})")
        check("steer right/up clamps to corridor", abs(r["x"] - 18) < 0.01 and abs(r["y"] - 30) < 0.01 and r["z"] == 0, r)
        check("banks into right turn", bank < -0.2, bank)
        page.evaluate("INP().mx = -1; INP().my = -0.4")
        page.wait_for_timeout(1100)
        page.screenshot(path=os.path.join(SHOTS, "player_bank_left.png"))
        page.evaluate("INP().mx = 0; INP().my = 0")
        page.wait_for_timeout(1500)

        # boost: drains, emits, recharges
        page.evaluate("INP().boost = true")
        page.wait_for_timeout(600)
        r = page.evaluate("({b: NR.player.boosting, f: NR.player.boostFuel})")
        page.screenshot(path=os.path.join(SHOTS, "player_boost.png"))
        check("boost on + draining", r["b"] and r["f"] < 0.85, r)
        page.wait_for_timeout(2200)
        r = page.evaluate("({b: NR.player.boosting, f: NR.player.boostFuel})")
        check("boost ends when empty", (not r["b"]) and r["f"] == 0, r)
        page.evaluate("INP().boost = false")
        page.wait_for_timeout(1000)
        r = page.evaluate("({f: NR.player.boostFuel, ev: EV.filter(e => e === 'boost').length})")
        check("fuel recharges, boost events", 0.1 < r["f"] < 0.25 and r["ev"] >= 2, r)

        # siren: 9 near misses fill it (0.12 each), sirenReady once, siren press calls clearAhead
        r = page.evaluate("""() => {
          const had = NR.traffic; let cleared = null;
          const shim = { clearAhead(d) { cleared = d; } };
          if (!NR.traffic) NR.traffic = shim; else { shim.orig = NR.traffic.clearAhead; NR.traffic.clearAhead = d => { cleared = d; }; }
          for (let i = 0; i < 9; i++) NR.bus.emit('nearMiss', { pos: null, dist: 2 });
          window.__restore = () => { if (!had) delete NR.traffic; else NR.traffic.clearAhead = shim.orig; };
          window.__cleared = () => cleared;
          return { s: NR.player.siren, ready: EV.filter(e => e === 'sirenReady').length };
        }""")
        check("siren fills, sirenReady once", r["s"] == 1 and r["ready"] == 1, r)
        page.evaluate("INP().siren = true")
        page.wait_for_timeout(50)
        page.evaluate("INP().siren = false")
        page.wait_for_timeout(50)
        r = page.evaluate("({c: __cleared(), s: NR.player.siren, ev: EV.filter(e => e === 'siren').length})")
        page.evaluate("__restore()")
        check("siren fires clearAhead(320), resets", r["c"] == 320 and r["s"] == 0 and r["ev"] == 1, r)

        # fps in PLAY over 5 s
        fps = page.evaluate("""() => new Promise(res => { const ts = []; const f = t => { ts.push(t); if (t - ts[0] < 5000) requestAnimationFrame(f); else {
          const iv = ts.slice(1).map((x, i) => x - ts[i]); iv.sort((a, b) => a - b); res({ fps: (ts.length - 1) / ((ts[ts.length-1] - ts[0]) / 1000), p95: iv[Math.floor(iv.length * 0.95)] }); } }; requestAnimationFrame(f); })""")
        check("fps >= 55", fps["fps"] >= 55, fps)

        # hits: stub world.collide; 3 hits -> crash -> DEAD
        page.evaluate("""() => {
          window.__hitOn = true; const had = NR.world;
          const fn = () => window.__hitOn ? { hit: true, kind: 'girder', normal: { x: 1, y: 0.2, z: 0 } } : { hit: false };
          if (!NR.world) NR.world = { collide: fn }; else { NR.world.__orig = NR.world.collide; NR.world.collide = fn; }
        }""")
        page.wait_for_timeout(120)
        r = page.evaluate("({hull: NR.player.hull, inv: NR.player.invuln, vis: NR.player.car.group.visible})")
        check("hit: hull 2 + invuln", r["hull"] == 2 and r["inv"] > 1.2, r)
        page.wait_for_timeout(150)
        page.screenshot(path=os.path.join(SHOTS, "player_hit.png"))
        page.wait_for_timeout(1000)
        r = page.evaluate("NR.player.hull")
        check("invuln protects (no second hit within 1.5 s)", r == 2, r)
        page.wait_for_timeout(600)
        r = page.evaluate("NR.player.hull")
        check("second hit after invuln", r == 1, r)
        page.evaluate("window.__hitOn = false")
        page.wait_for_timeout(1700)
        page.screenshot(path=os.path.join(SHOTS, "player_damaged.png"))
        page.evaluate("window.__hitOn = true")
        page.wait_for_timeout(150)
        r = page.evaluate("({hull: NR.player.hull, alive: NR.player.alive, state: NR.core.state, hits: EV.filter(e => e === 'hit').length, crash: EV.filter(e => e === 'crash').length})")
        check("third hit -> crash, DEAD", r == {"hull": 0, "alive": False, "state": "DEAD", "hits": 3, "crash": 1}, r)
        page.evaluate("window.__hitOn = false")
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(SHOTS, "player_crash.png"))
        page.wait_for_timeout(4000)
        r = page.evaluate("NR.player.car.group.visible")
        check("crashed car falls away", r is False, r)

        # restart resets fully
        page.evaluate("NR.core.start()")
        page.wait_for_timeout(300)
        r = page.evaluate("({hull: NR.player.hull, alive: NR.player.alive, vis: NR.player.car.group.visible, rx: NR.player.car.group.rotation.x})")
        check("restart resets car", r["hull"] == 3 and r["alive"] and r["vis"] and abs(r["rx"]) < 0.2, r)
        page.evaluate("for (const m of ['world', 'traffic']) if (NR[m] && NR[m].__real) NR[m].collide = NR[m].__real")

        mine = [e for e in errors if "player" in e.lower()]
        check("no console errors from player", not mine, mine)
        others = [e for e in errors if e not in mine]
        if others:
            print("NOTE other-module errors:", len(others), [e[:120] for e in others[:5]])
        b.close()
finally:
    srv.terminate()
    srv.wait()
print("RESULT", "OK" if not fails else "FAILED " + ", ".join(fails))
sys.exit(1 if fails else 0)
