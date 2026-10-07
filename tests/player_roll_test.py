"""NR.player round 2 test: ROLL, push(x, y), drainSiren(amount). Real page, Playwright Chromium, phone viewport.
Run: python tests/player_roll_test.py"""
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
srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "tests", "range_server.py"), str(port)], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails, errors = [], []


def check(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + (" " + str(info) if info else ""))
    if not ok:
        fails.append(name)


SETUP = """() => {
  window.EV = []; NR.bus.on('roll', d => EV.push(d));
  window.INP = () => NR.controls && NR.controls.state ? NR.controls.state : NR.core.input;
  // test overrides re-applied after controls.update each frame (controls rewrites the stick/boost every frame in PLAY)
  window.OVR = {};
  if (NR.controls && typeof NR.controls.update === 'function') { const cu = NR.controls.update;
    NR.controls.update = function (dt, core) { const r = cu.apply(this, arguments); const s = INP();
      for (const k in OVR) s[k] = OVR[k]; if (OVR.roll) delete OVR.roll; return r; }; }
  window.SET = o => { Object.assign(OVR, o); Object.assign(INP(), o); };
  // one-frame press, like controls.state.roll + rollX/rollY snapped from the stick at the press
  window.PRESS = () => { const s = INP(), x = s.mx, y = s.my, ax = Math.abs(x), ay = Math.abs(y);
    SET({ roll: true, rollX: ax >= ay && ax > 0.3 ? Math.sign(x) : 0, rollY: ay > ax && ay > 0.3 ? Math.sign(y) : 0 });
    if (!NR.controls) requestAnimationFrame(() => requestAnimationFrame(() => { INP().roll = false; })); };
  // no world/traffic hits unless a test turns them on
  window.__hitOn = false; window.__calls = 0;
  const fn = () => { __calls++; return window.__hitOn ? { hit: true, kind: 'girder', normal: { x: 0, y: 1, z: 0 } } : { hit: false }; };
  for (const m of ['world', 'traffic']) { if (!NR[m]) NR[m] = {}; NR[m].__orig = NR[m].collide; NR[m].collide = fn; }
  // freeze the player at a roll progress for screenshots (dt 0 to the player only)
  window.FREEZE_AT = 2; const up = NR.player.update;
  NR.player.update = (dt, core) => up(NR.player.rolling && NR.player.rollT >= FREEZE_AT ? 0 : dt, core);
}"""

PLACE = "(([x, y]) => { NR.player.pos.set(x, y, 0); NR.player.vel.set(0, 0, 0); NR.player.rollCooldown = 0; SET({ mx: 0, my: 0, boost: false }); })"

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
        page.evaluate("NR.core.start()")
        page.wait_for_timeout(300)
        page.evaluate(SETUP)

        r = page.evaluate("({r: NR.player.rolling, t: NR.player.rollT, d: NR.player.rollDir, c: NR.player.rollCooldown, p: typeof NR.player.push, s: typeof NR.player.drainSiren})")
        check("API present after reset", r == {"r": False, "t": 0, "d": {"x": 0, "y": 0}, "c": 0, "p": "function", "s": "function"}, r)

        # barrel roll right: ~6 m in 0.45 s
        page.evaluate(PLACE, [0, 10])
        page.evaluate("SET({mx: 1})")
        page.wait_for_timeout(60)
        page.evaluate("NR.player.pos.x = 0; NR.player.vel.set(0, 0, 0); SET({mx: 0}); PRESS()")
        page.wait_for_timeout(120)
        r = page.evaluate("({r: NR.player.rolling, t: NR.player.rollT, d: NR.player.rollDir, c: NR.player.rollCooldown, ev: EV[EV.length-1]})")
        check("roll starts, event", r["r"] and 0 < r["t"] < 1 and r["c"] == 1 and r["ev"] and r["ev"]["boost"] is False, r)
        page.wait_for_timeout(500)
        r = page.evaluate("({r: NR.player.rolling, x: NR.player.pos.x, y: NR.player.pos.y, c: NR.player.rollCooldown})")
        # stick was nearly centred at press -> spin in place; this checks centre = spin
        check("centred press = flat spin, no travel", (not r["r"]) and abs(r["x"]) < 0.3, r)

        # real right roll: stick held right, velocity zeroed so only roll moves the car
        page.wait_for_timeout(1100)
        page.evaluate(PLACE, [0, 10])
        page.evaluate("SET({mx: 1}); PRESS()")
        page.wait_for_timeout(30)
        page.evaluate("SET({mx: 0}); NR.player.vel.set(0,0,0)")
        page.wait_for_timeout(600)
        r = page.evaluate("({x: NR.player.pos.x, d: EV[EV.length-1].dir, k: EV[EV.length-1].kind})")
        check("barrel roll right ~6 m", 5.2 < r["x"] < 8.5 and r["d"] == {"x": 1, "y": 0} and r["k"] == "barrel", r)

        # cooldown blocks an immediate second roll
        n = page.evaluate("EV.length")
        page.evaluate("PRESS()")
        page.wait_for_timeout(100)
        r = page.evaluate("({n: EV.length, r: NR.player.rolling, c: NR.player.rollCooldown})")
        check("cooldown blocks re-roll", r["n"] == n and not r["r"] and 0 < r["c"] < 1, r)
        page.wait_for_timeout(1000)

        # loop up ~5 m
        page.evaluate(PLACE, [0, 10])
        page.evaluate("SET({my: 1}); PRESS()")
        page.wait_for_timeout(30)
        page.evaluate("SET({my: 0}); NR.player.vel.set(0,0,0)")
        page.wait_for_timeout(600)
        r = page.evaluate("({y: NR.player.pos.y, k: EV[EV.length-1].kind})")
        check("loop up ~5 m", 14.3 < r["y"] < 17.5 and r["k"] == "loop", r)
        page.wait_for_timeout(1100)

        # boost combo: 1.5x distance, 0.35 s
        page.evaluate(PLACE, [0, 10])
        page.evaluate("SET({boost: true})")
        page.wait_for_timeout(100)
        page.evaluate("NR.player.pos.x = 0; SET({mx: -1}); PRESS(); window.__t0 = performance.now(); NR.bus.on('roll', () => {}); window.__tEnd = 0; (function w(){ if (NR.player.rolling || !__tEnd && performance.now() - __t0 < 50) { requestAnimationFrame(w); } else __tEnd = performance.now(); })()")
        page.wait_for_timeout(30)
        page.evaluate("SET({mx: 0}); NR.player.vel.set(0,0,0)")
        page.wait_for_timeout(600)
        r = page.evaluate("({x: NR.player.pos.x, b: EV[EV.length-1].boost, ms: __tEnd - __t0})")
        page.evaluate("SET({boost: false})")
        check("boost roll ~9 m left, ~0.35 s", -12 < r["x"] < -8 and r["b"] is True and 300 < r["ms"] < 460, r)
        page.wait_for_timeout(1100)

        # corridor clamp
        page.evaluate(PLACE, [16.5, 10])
        page.evaluate("SET({mx: 1}); PRESS()")
        page.wait_for_timeout(30)
        page.evaluate("SET({mx: 0})")
        page.wait_for_timeout(600)
        r = page.evaluate("NR.player.pos.x")
        check("roll clamps to corridor", abs(r - 18) < 0.01, r)
        page.wait_for_timeout(1100)

        # no-collision window: collide() always hits during the roll; middle 0.3 s is safe
        page.evaluate(PLACE, [0, 10])
        r = page.evaluate("""() => new Promise(res => {
          const h0 = NR.player.hull; let safeHits = 0, calls0 = 0, inMid = 0;
          SET({mx: 1}); PRESS();
          const f = () => {
            const p = NR.player, tt = p.rollT * 0.45;
            if (p.rolling && tt > 0.09 && tt < 0.36) { if (!__hitOn) { __hitOn = true; calls0 = __calls; } inMid++; if (p.hull !== h0) safeHits++; }
            if (p.rolling || !__hitOn) return requestAnimationFrame(f);
            const midCalls = __calls - calls0;
            setTimeout(() => { __hitOn = false; SET({mx: 0}); res({ safeHits, inMid, midCalls, hullAfter: NR.player.hull, h0 }); }, 120);
          };
          requestAnimationFrame(f);
        })""")
        check("no hits in the safe window, hit after it", r["safeHits"] == 0 and r["inMid"] >= 8 and r["hullAfter"] == r["h0"] - 1, r)
        page.wait_for_timeout(1700)

        # push: eased, moves, fades
        page.evaluate(PLACE, [0, 10])
        page.evaluate("NR.player.push(20, 0)")
        page.wait_for_timeout(40)
        x1 = page.evaluate("NR.player.pos.x")
        page.wait_for_timeout(1500)
        x2 = page.evaluate("NR.player.pos.x")
        page.wait_for_timeout(1500)
        x3 = page.evaluate("NR.player.pos.x")
        check("push eases in, moves, fades out", 0 <= x1 < 0.7 and 4 < x2 < 18 and abs(x3 - x2) < 1.5, [x1, x2, x3])
        page.evaluate("NR.player.push(NaN, 3); NR.player.push(0, -15)")
        page.wait_for_timeout(1500)
        r = page.evaluate("({x: NR.player.pos.x, y: NR.player.pos.y})")
        check("push y + NaN ignored", r["y"] < 9 and r["x"] == r["x"], r)

        # drainSiren
        r = page.evaluate("""() => { let ready = 0; NR.bus.on('sirenReady', () => ready++);
          for (let i = 0; i < 9; i++) NR.bus.emit('nearMiss', { dist: 2 });
          const a = NR.player.siren; NR.player.drainSiren(0.4); const b = NR.player.siren;
          NR.player.drainSiren(-1); NR.player.drainSiren(5); const c = NR.player.siren;
          for (let i = 0; i < 9; i++) NR.bus.emit('nearMiss', { dist: 2 });
          return { a, b: +b.toFixed(3), c, ready }; }""")
        check("drainSiren drains, clamps, re-arms sirenReady", r == {"a": 1, "b": 0.6, "c": 0, "ready": 2}, r)

        # screenshots mid-roll (player frozen at rollT 0.4, world keeps running)
        for name, js in [("barrel", "SET({mx: 1})"), ("loop", "SET({my: 1})"), ("spin", "")]:
            page.wait_for_timeout(1100)
            page.evaluate(PLACE, [0, 8])
            page.evaluate("FREEZE_AT = 0.38;" + js + "; PRESS()")
            page.wait_for_timeout(500)
            page.evaluate("SET({mx: 0}); SET({my: 0})")
            page.screenshot(path=os.path.join(SHOTS, f"player_roll_{name}.png"))
            page.evaluate("FREEZE_AT = 2")
        page.wait_for_timeout(800)
        r = page.evaluate("({r: NR.player.rolling, rz: NR.player.car.group.rotation.z, rx: NR.player.car.group.rotation.x, ry: NR.player.car.group.rotation.y})")
        check("pose returns to level after roll", (not r["r"]) and abs(r["rz"]) < 0.3 and abs(r["rx"]) < 0.3 and abs(r["ry"]) < 0.3, r)

        # later difficulty + fps while rolling every cooldown
        page.evaluate("for (const m of ['world', 'traffic']) NR[m].collide = NR[m].__orig || (() => ({ hit: false }))")
        page.evaluate("NR.core.dist = 2800 * 6 + 100; NR.core.loop = 1; NR.player.invuln = 99")
        page.wait_for_timeout(800)
        fps = page.evaluate("""() => new Promise(res => { const ts = []; let k = 0; const f = t => { ts.push(t);
          if (++k % 40 === 0) { SET({mx: k % 80 ? 1 : -1}); PRESS(); }
          if (t - ts[0] < 5000) requestAnimationFrame(f); else {
          const iv = ts.slice(1).map((x, i) => x - ts[i]); iv.sort((a, b) => a - b); SET({mx: 0});
          res({ fps: (ts.length - 1) / ((ts[ts.length-1] - ts[0]) / 1000), p95: iv[Math.floor(iv.length * 0.95)], rolls: EV.length }); } }; requestAnimationFrame(f); })""")
        check("fps >= 55 while rolling (cycle 2)", fps["fps"] >= 55, fps)
        page.evaluate("NR.player.invuln = 0; for (const m of ['world', 'traffic']) NR[m].collide = () => ({ hit: false }); FREEZE_AT = 0.5; SET({mx: -1}); PRESS()")
        page.wait_for_timeout(1300)
        page.screenshot(path=os.path.join(SHOTS, "player_roll_late.png"))
        page.evaluate("FREEZE_AT = 2; SET({mx: 0}); OVR = {}; for (const m of ['world', 'traffic']) if (NR[m].__orig) NR[m].collide = NR[m].__orig")

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
