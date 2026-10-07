"""NEON RAIN fx.js test: serves the repo, drives states and fx events in dev.html, checks errors, API, fps, screenshots.
Usage: python tests/fx_test.py [--alone]   (--alone blocks every other gameplay module to prove fx works by itself)"""
import json
import os
import socket
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALONE = "--alone" in sys.argv
OUT = os.path.join(ROOT, "tests", "shots", "fx" + ("_alone" if ALONE else ""))
os.makedirs(OUT, exist_ok=True)
OTHERS = ["audio.js", "world.js", "traffic.js", "player.js", "controls.js", "ui.js"]


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


port = free_port()
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
results, fails = {}, []


def check(name, ok, info=""):
    results[name] = ("PASS" if ok else "FAIL") + (f" ({info})" if info else "")
    if not ok:
        fails.append(name)


try:
    time.sleep(0.8)
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=["--use-angle=d3d11", "--enable-gpu"])
        ctx = br.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
        page = ctx.new_page()
        errs, fx_errs = [], []

        def on_console(m):
            if m.type == "error":
                errs.append(m.text)
                if "fx" in m.text.lower():
                    fx_errs.append(m.text)
        page.on("console", on_console)
        page.on("pageerror", lambda e: (errs.append(str(e)), fx_errs.append(str(e)) if "fx" in (e.stack or str(e)) else None))
        if ALONE:
            for f in OTHERS:
                page.route(f"**/src/{f}", lambda r: r.fulfill(status=200, content_type="text/javascript", body="// blocked"))
        page.goto(f"http://127.0.0.1:{port}/src/dev.html")
        page.wait_for_function("window.READY === true", timeout=20000)
        page.wait_for_timeout(1500)
        check("fx api", page.evaluate("!!(NR.fx && NR.fx.stats && NR.fx.explode && NR.fx.sirenPulse && NR.fx.sparks && NR.fx.nearMiss)"))
        page.screenshot(path=os.path.join(OUT, "01_title.png"))
        st = page.evaluate("NR.fx.stats()")
        check("title rain on", st["rain"] > 300, json.dumps(st))

        page.evaluate("NR.core.start()")
        page.wait_for_timeout(2000)
        page.screenshot(path=os.path.join(OUT, "02_play_rain.png"))
        fps = page.evaluate("""() => new Promise(res => { const a = []; let l = performance.now(); const t0 = l;
            function f(n) { a.push(n - l); l = n; if (n - t0 < 5000) requestAnimationFrame(f); else {
              a.sort((x, y) => x - y); res({ fps: 1000 / (a.reduce((s, x) => s + x, 0) / a.length), p95: a[Math.floor(a.length * .95)] }); } }
            requestAnimationFrame(f); })""")
        check("fps play >= 55", fps["fps"] >= 55, f"{fps['fps']:.1f} fps, p95 {fps['p95']:.1f} ms")

        # near miss flash at a passed car beside the player
        page.evaluate("""(() => { const p = NR.player && NR.player.pos ? NR.player.pos : {x:0,y:0,z:0};
            NR.bus.emit('nearMiss', { pos: new THREE.Vector3(p.x + 3, p.y + 0.5, p.z - 1), dist: 2.1 }); })()""")
        page.wait_for_timeout(60)
        page.screenshot(path=os.path.join(OUT, "04_near_miss.png"))
        st = page.evaluate("NR.fx.stats()")
        check("near miss spawns", st["lines"] > 0 and st["add"] > 0, json.dumps(st))

        # high speed + boost streaks
        page.evaluate("NR.core.speed = 150; if (NR.player) { NR.player.boosting = true; } NR.bus.emit('boost', {on: true})")
        page.wait_for_timeout(700)
        st = page.evaluate("NR.fx.stats()")
        check("speed lines at top speed", st["speed"] > 0.3, f"speedLevel {st['speed']:.2f}")
        page.screenshot(path=os.path.join(OUT, "03_speed_boost.png"))

        page.evaluate("NR.bus.emit('siren', {})")
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(OUT, "05_siren.png"))
        check("siren active", page.evaluate("NR.fx.stats().siren"))
        page.wait_for_timeout(1000)
        check("siren ends after 1 s", not page.evaluate("NR.fx.stats().siren"))

        page.evaluate("NR.bus.emit('hit', {hull: 2, kind: 'test'})")
        page.wait_for_timeout(80)
        page.screenshot(path=os.path.join(OUT, "06_hit.png"))

        # districts: dust sea has no rain, sea wall is heaviest
        page.evaluate("NR.core.dist = 3 * NR.cfg.DISTRICT_LEN + 5; NR.core.speed = 90")
        page.wait_for_timeout(4000)
        st = page.evaluate("NR.fx.stats()")
        check("dust sea rain off", st["rain"] < 15, f"rain {st['rain']}, level {st['rainLevel']:.2f}")
        page.screenshot(path=os.path.join(OUT, "07_dust_no_rain.png"))
        page.evaluate("NR.core.dist = 4 * NR.cfg.DISTRICT_LEN + 5")
        page.wait_for_timeout(4000)
        st = page.evaluate("NR.fx.stats()")
        check("sea wall heavy rain", st["rain"] > 700, f"rain {st['rain']}")
        page.screenshot(path=os.path.join(OUT, "08_seawall_rain.png"))

        # crash
        page.evaluate("NR.bus.emit('crash', {})")
        page.wait_for_timeout(120)
        page.screenshot(path=os.path.join(OUT, "09_crash_0120ms.png"))
        st = page.evaluate("NR.fx.stats()")
        check("crash spawns fire, smoke, debris", st["add"] > 20 and st["smoke"] > 20 and st["debris"] > 0, json.dumps(st))
        check("state DEAD after crash", page.evaluate("NR.core.state") == "DEAD")
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(OUT, "10_crash_0600ms.png"))
        fps2 = page.evaluate("""() => new Promise(res => { let n = 0; const t0 = performance.now();
            function f(t) { n++; if (t - t0 < 2000) requestAnimationFrame(f); else res(n / ((t - t0) / 1000)); } requestAnimationFrame(f); })""")
        check("fps during crash >= 55", fps2 >= 55, f"{fps2:.1f} fps")
        page.screenshot(path=os.path.join(OUT, "11_crash_2600ms.png"))

        # reset on a new run clears pools
        page.evaluate("NR.core.start()")
        page.wait_for_timeout(100)
        st = page.evaluate("NR.fx.stats()")
        check("reset clears crash fx", st["debris"] == 0 and st["smoke"] < 10, json.dumps(st))
        page.evaluate("NR.core.toTitle()")
        page.wait_for_timeout(300)
        check("zero fx console errors", not fx_errs, "; ".join(fx_errs)[:300])
        results["all console errors (info)"] = str(len(errs)) + (": " + " | ".join(e[:120] for e in errs[:5]) if errs else "")
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
