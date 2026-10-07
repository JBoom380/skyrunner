"""NEON RAIN traffic.js test: serves the repo, drives NR.core, checks API, near miss, collide, siren clear, fps, screenshots."""
import os, socket, subprocess, sys, time, json
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SHOTS = os.path.join(ROOT, "tests", "shots", "traffic")
os.makedirs(SHOTS, exist_ok=True)

s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
results, errors = {}, []
FAKE_PLAYER = """() => { if (!NR.player) { const V = THREE.Vector3; NR.player = { pos: new V(0, 4, 0),
  box() { return { min: new V(this.pos.x - 1.3, this.pos.y - 0.7, -3.75), max: new V(this.pos.x + 1.3, this.pos.y + 0.7, 3.75) }; } }; NR.__fake = true; } }"""
try:
    time.sleep(0.8)
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=d3d11", "--enable-gpu"])
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
        pg = ctx.new_page()
        pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
        pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        pg.goto(f"http://127.0.0.1:{PORT}/src/dev.html")
        pg.wait_for_function("window.READY === true", timeout=20000)
        pg.wait_for_timeout(2500)
        results["title_stats"] = pg.evaluate("NR.traffic.stats()")
        pg.screenshot(path=os.path.join(SHOTS, "1_title.png"))

        pg.evaluate(FAKE_PLAYER)
        pg.evaluate("NR.core.start()")
        pg.wait_for_timeout(1500)
        results["play_stats"] = pg.evaluate("NR.traffic.stats()")
        pg.screenshot(path=os.path.join(SHOTS, "2_play_start.png"))

        # fps over 5 s in PLAY
        results["fps"] = pg.evaluate("""() => new Promise(r => { let n = 0, t0 = performance.now(), worst = 0, last = t0;
          function f(t) { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < 5000) requestAnimationFrame(f); else r({ fps: n / ((t - t0) / 1000), worstMs: worst }); }
          requestAnimationFrame(f); })""")
        results["draw_calls"] = pg.evaluate("""() => new Promise(r => { const R = NR.core.renderer; R.info.autoReset = false; R.info.reset(); requestAnimationFrame(() => requestAnimationFrame(() => { const c = R.info.render.calls; R.info.autoReset = true; r(c); })); })""")

        # near miss: park one car 1.0 m beside the player, 70 m ahead, same direction
        results["near_miss"] = pg.evaluate("""() => new Promise(r => {
          const got = []; NR.bus.on('nearMiss', d => got.push(+d.dist.toFixed(2)));
          const P = NR.player.pos, T = NR.traffic;
          for (const c of T.cars) if (Math.abs(c.z) < 200) { c.x = c.tx = 40; }
          const c = T.cars.find(c => c.type !== 'hauler' && c.z < -80) || T.cars[0];
          c.dir = 1; c.speed = 10; c.x = c.tx = P.x + 1.3 + c.def.half[0] + 1.0; c.y = P.y - c.def.cy; c.z = -70; c.laneT = 99; c.hit = false; c.clear = -1; c.done = false; c.tracked = false; c.minGap = 1e9;
          setTimeout(() => r({ events: got, car: c.type }), 3500); })""")

        # collide: box overlapping a car -> hit; same car again -> no second hit
        results["collide"] = pg.evaluate("""() => { const T = NR.traffic, V = THREE.Vector3;
          const c = T.cars.find(c => !c.hit && c.clear < 0 && c.z < -50);
          const bx = { min: new V(c.x - 0.5, c.y + c.def.cy - 0.3, c.z - 1), max: new V(c.x + 0.5, c.y + c.def.cy + 0.3, c.z + 1) };
          const a = T.collide(bx); const first = { hit: a.hit, kind: a.kind, normal: a.normal.toArray() };
          const b = T.collide(bx); const far = T.collide({ min: new V(100, 100, 100), max: new V(101, 101, 101) });
          return { first, second: b.hit, far: far.hit }; }""")

        pg.screenshot(path=os.path.join(SHOTS, "3_play_dense_before_siren.png"))
        # siren clear
        results["clear"] = pg.evaluate("""() => new Promise(r => { const T = NR.traffic;
          const n = T.clearAhead(NR.cfg.SIREN_CLEAR); const ids = T.cars.filter(c => c.clear >= 0);
          setTimeout(() => r({ cleared: n, outOfCorridor: ids.filter(c => !c.active || c.clear < 0 || Math.abs(c.x) > 30).length, total: ids.length }), 1300); })""")
        pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(SHOTS, "4_after_siren.png"))

        # late-game density: jump the distance and loop
        pg.evaluate("NR.core.dist = 9000; NR.core.speed = 120")
        pg.wait_for_timeout(5000)
        results["late_stats"] = pg.evaluate("NR.traffic.stats()")
        pg.screenshot(path=os.path.join(SHOTS, "5_late_dense.png"))
        results["late_fps"] = pg.evaluate("""() => new Promise(r => { let n = 0, t0 = performance.now();
          function f(t) { n++; if (t - t0 < 3000) requestAnimationFrame(f); else r(n / ((t - t0) / 1000)); } requestAnimationFrame(f); })""")

        # close look: four designs parked beside/ahead of the player, matching its speed so they hold position
        for name, onc in (("6_closeup_designs.png", False), ("7_closeup_oncoming.png", True)):
            pg.evaluate("""(onc) => { const T = NR.traffic, P = NR.player.pos;
              for (const c of T.cars) { c.x = c.tx = 60; }
              const pick = ['wedge', 'cab', 'dart', 'hauler']; let i = 0;
              const xs = [-5, 5, -6, 8], ys = [1.0, 0.5, 5, -3], zs = [-15, -19, -28, -46];
              for (const k of pick) { const c = T.cars.find(c => c.type === k && c.x === 60); if (!c) continue;
                c.dir = onc ? -1 : 1; c.x = c.tx = P.x + xs[i]; c.y = P.y + ys[i]; c.z = zs[i]; c.hit = false; c.clear = -1; c.laneT = 99; c.done = true;
                c.speed = onc ? 0 : NR.core.speed; i++; }
              if (onc) { NR.core.__spd = NR.core.speed; } }""", onc)
            if onc:
                pg.evaluate("""() => { const T = NR.traffic; for (const c of T.cars) if (c.dir < 0 && c.x !== 60) c.speed = -NR.core.speed; }""")
            pg.wait_for_timeout(120)
            pg.screenshot(path=os.path.join(SHOTS, name))
        results["traffic_errors"] = [e for e in errors if "traffic" in e.lower()]
        results["other_errors"] = [e[:160] for e in errors if "traffic" not in e.lower()]
        b.close()
finally:
    srv.terminate(); srv.wait(timeout=5)

print(json.dumps(results, indent=1, ensure_ascii=False))
ok = (not results.get("traffic_errors") and results["near_miss"]["events"] and results["collide"]["first"]["hit"]
      and not results["collide"]["second"] and not results["collide"]["far"] and results["clear"]["cleared"] > 0
      and results["clear"]["outOfCorridor"] == results["clear"]["total"])
print("PASS" if ok else "FAIL")
