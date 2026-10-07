"""SKYRUNNER traffic round 2: lane-changers with blinkers, density by core.difficulty.
Serves the repo with tests/range_server.py, drives NR.core, checks lane-cut timing, density ramp, errors, fps, screenshots."""
import os, socket, subprocess, sys, time, json
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SHOTS = os.path.join(ROOT, "tests", "shots", "traffic")
os.makedirs(SHOTS, exist_ok=True)

s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "tests", "range_server.py"), str(PORT)], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
results, errors = {}, []
GOD = "() => { const p = NR.player; if (p) { p.invuln = 1e9; p.hull = 3; } }"
HOOK = """() => { window.__lc = []; const cars = new Map();
  NR.bus.on('laneChange', e => { window.__lc.push({ phase: e.phase, t: NR.core.time, z: e.pos.z, x: e.pos.x, side: e.side, type: e.type, v: NR.core.speed }); }); }"""
FPS = """(ms) => new Promise(r => { let n = 0, t0 = performance.now(), worst = 0, last = t0;
  function f(t) { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else r({ fps: +(n / ((t - t0) / 1000)).toFixed(1), worstMs: +worst.toFixed(1) }); }
  requestAnimationFrame(f); })"""


def phase(pg, name, dist, secs, speed):
    pg.evaluate(f"NR.core.dist = {dist}; NR.core.speed = {speed}; window.__lc.length = 0")
    t_end = time.time() + secs
    while time.time() < t_end:
        pg.evaluate(GOD); pg.wait_for_timeout(500)
    st = pg.evaluate("NR.traffic.stats()")
    ev = pg.evaluate("window.__lc.slice()")
    st["warns"] = sum(1 for e in ev if e["phase"] == "warn")
    st["swerves"] = sum(1 for e in ev if e["phase"] == "swerve")
    results[name] = st
    return ev


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
        pg.wait_for_timeout(1500)
        pg.evaluate(HOOK)
        pg.evaluate("NR.core.start()"); pg.evaluate(GOD)

        ev0 = phase(pg, "d0", 0, 20, 62)
        ev1 = phase(pg, "d1", 8400, 20, 115)
        ev2 = phase(pg, "d17", 2 * 14000 + 400, 20, 140)   # cycle 3: difficulty 1.7
        results["fps_hard"] = pg.evaluate(FPS, 5000)

        # timing: for each warn, the matching swerve comes ~LC_BLINK later; the car must still be well ahead
        allev = ev0 + ev1 + ev2
        gaps = []
        for i, e in enumerate(allev):
            if e["phase"] != "warn": continue
            sw = next((f for f in allev[i + 1:] if f["phase"] == "swerve" and f["type"] == e["type"] and abs(f["x"] - e["x"]) < 0.5), None)
            if sw: gaps.append({"blink_s": round(sw["t"] - e["t"], 2), "z_warn": round(e["z"]), "z_swerve": round(sw["z"])})
        results["timing"] = gaps[:12]
        results["timing_min_blink"] = min((g["blink_s"] for g in gaps), default=None)
        results["timing_max_zswerve"] = max((g["z_swerve"] for g in gaps), default=None)

        # staged close look (Neon Canyon, cycle 2): a car one lane right of the player, closing slowly, cuts toward the player's lane
        pg.evaluate("""() => { for (const el of document.querySelectorAll('#ui *')) if (/TAP TO ENTER/.test(el.textContent || '') && el.children.length === 0) el.style.visibility = 'hidden'; }""")
        pg.evaluate("NR.core.dist = 14000 + 900; NR.core.speed = 80")
        pg.wait_for_timeout(2500)
        pg.evaluate("""() => { const T = NR.traffic, P = NR.player.pos;
          P.x = -4.5; P.y = 4; if (NR.player.vel) NR.player.vel.set(0, 0, 0);
          for (const c of T.cars) if (c.z > -260) { c.x = c.tx = 60; c.lc = 0; }
          const c = T.cars.find(c => c.type === 'wedge' && c.dir > 0 && c.x !== 60) || T.cars.find(c => c.dir > 0 && c.x !== 60);
          c.x = c.tx = 4.5; c.y = 4.2; c.z = -72; c.speed = NR.core.speed - 18; c.lc = 1; c.lcSlack = 0.5; c.hit = false; c.clear = -1; c.done = false; c.laneT = 99;
          window.__stage = c; }""")
        UNGOD = "() => { const p = NR.player; if (p) { p.invuln = 0; p.hull = 3; } }"
        pg.wait_for_function("window.__stage.lc === 2 && window.__stage.lcT > 0.02 && window.__stage.lcT < 0.15", timeout=8000, polling="raf")
        pg.evaluate(UNGOD)
        pg.screenshot(path=os.path.join(SHOTS, "8_lanechange_blink.png"))
        pg.wait_for_function("window.__stage.lc === 2 && window.__stage.lcT > 0.68 && window.__stage.lcT < 0.8", timeout=4000, polling="raf")
        pg.evaluate(UNGOD)
        pg.screenshot(path=os.path.join(SHOTS, "8b_lanechange_blink_late.png"))
        pg.wait_for_function("window.__stage.lc === 3 && window.__stage.lcT > 0.4", timeout=4000, polling="raf")
        pg.evaluate(UNGOD)
        pg.screenshot(path=os.path.join(SHOTS, "9_lanechange_cut.png"))
        results["stage"] = pg.evaluate("(() => { const c = window.__stage; return { type: c.type, lc: c.lc, x: +c.x.toFixed(1), z: +c.z.toFixed(1), to: +c.lcTo.toFixed(1) }; })()")
        pg.wait_for_timeout(1200)
        pg.evaluate(UNGOD)
        pg.screenshot(path=os.path.join(SHOTS, "10_late_traffic.png"))
        results["state_end"] = pg.evaluate("NR.core.state")

        results["traffic_errors"] = [e for e in errors if "traffic" in e.lower()]
        results["other_errors"] = [e[:160] for e in errors if "traffic" not in e.lower()]
        b.close()
finally:
    srv.terminate(); srv.wait(timeout=5)

print(json.dumps(results, indent=1, ensure_ascii=False))
ok = (not results["traffic_errors"] and results["d17"]["warns"] > results["d0"]["warns"] and results["d17"]["lcChance"] > results["d0"]["lcChance"]
      and results["d17"]["desired"] > results["d0"]["desired"] and (results["timing_min_blink"] or 0) >= 1.0
      and results["fps_hard"]["fps"] > 55)
print("PASS" if ok else "FAIL")
