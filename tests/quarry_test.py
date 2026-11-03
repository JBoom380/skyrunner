"""NR.quarry test: PURSUIT chase target. One headless browser, own server on port 8776 (killed by PID).
Run: python -I tests/quarry_test.py
Covers: gap band over 40 s, boost closing (never below 4 m), quarry boost after player boost, NIGHT DRIVE absence,
tricks, screenshots (tests/out/quarry_*.png), fps before/after (baseline = git HEAD copy served from tests/out/_base),
and a fixed-step collision soak (5 simulated minutes at each speed tier)."""
import os
import shutil
import subprocess
import sys
import tarfile
import io
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "tests", "out")
os.makedirs(OUT, exist_ok=True)
PORT = 8776
fails, errors = [], []


def check(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + (" " + str(info) if info else ""), flush=True)
    if not ok:
        fails.append(name)


# baseline copy of the committed game (no quarry) for the fps comparison
BASE = os.path.join(OUT, "_base")
shutil.rmtree(BASE, ignore_errors=True)
os.makedirs(BASE)
data = subprocess.run(["git", "archive", "HEAD", "src", "assets"], cwd=ROOT, capture_output=True, check=True).stdout
tarfile.open(fileobj=io.BytesIO(data)).extractall(BASE)

FPS_JS = """() => new Promise(r => { const t = []; let last = performance.now(), n = 0;
  function f(now) { t.push(now - last); last = now; if (++n < 300) requestAnimationFrame(f); else {
    r(1000 / (t.reduce((a,b)=>a+b,0) / t.length)); } }
  requestAnimationFrame(f); })"""
WAIT_JS = "(ms) => new Promise(r => { const t0 = performance.now(); (function f(){ performance.now() - t0 > ms ? r() : requestAnimationFrame(f); })(); })"
KEEP_JS = "() => { clearInterval(window.__keep); window.__keep = setInterval(() => { if (NR.player) NR.player.hull = 99; }, 20); }"
LOG_JS = """() => { window.__g = []; clearInterval(window.__log); window.__log = setInterval(() => {
  const q = NR.quarry; window.__g.push([q.gap, q.state().boostT, q.state().trickType]); }, 100); }"""

SOAK_JS = """(args) => {
  const [n, dt] = args, W = NR.world, T = NR.traffic, Q = NR.quarry, P = NR.player, S = window.__soak;
  for (let i = 0; i < n; i++) {
    NR.core.step(dt); P.hull = 99; NR.core.speed = S.speed;
    const b = Q.box(); S.steps++;
    if (W.collide(b).hit) S.world++;
    const cs = T.cars;
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k]; if (!c.def) continue; const h = c.def.half, cy = c.y + c.def.cy;
      const sx = Math.max(b.min.x - (c.x + h[0]), (c.x - h[0]) - b.max.x), sy = Math.max(b.min.y - (cy + h[1]), (cy - h[1]) - b.max.y), sz = Math.max(b.min.z - (c.z + h[2]), (c.z - h[2]) - b.max.z);
      const sep = Math.max(sx, sy, sz);
      if (sep < 0) S.cars++;
      if (sep < S.minCar) S.minCar = sep;
    }
    if (S.steps % 2 === 0) {
      const ob = W.obstacles(), hz = W.hazardBoxes();
      for (let k = 0; k < ob.length + hz.length; k++) { const o = k < ob.length ? ob[k] : hz[k - ob.length];
        const sep = Math.max(b.min.x - o.x1, o.x0 - b.max.x, b.min.y - o.y1, o.y0 - b.max.y, b.min.z - o.z1, o.z0 - b.max.z);
        if (sep < S.minObs) S.minObs = sep; }
    }
    const q = Q.state();
    if (Math.abs(b.min.x + b.max.x) / 2 > 18.01 || b.min.y < NR.cfg.ALT_MIN || b.max.y > NR.cfg.ALT_MAX + 1) S.out++;
    if (Q.gap < S.gmin) S.gmin = Q.gap; if (Q.gap > S.gmax) S.gmax = Q.gap;
    if (q.boostT > 0 && !S.wasB) S.boosts++; S.wasB = q.boostT > 0;
    if (q.trickType && !S.wasT) S.tricks++; S.wasT = q.trickType > 0;
  }
  return Object.assign({ state: NR.core.state, dist: Math.round(NR.core.dist), saves: Q.hits }, S);
}"""

srv = subprocess.Popen([sys.executable, "-I", "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(1.0)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-angle=d3d11", "--enable-gpu", "--autoplay-policy=no-user-gesture-required"])
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)

        def load(url):
            pg = ctx.new_page()
            pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.goto(url)
            pg.wait_for_function("window.READY === true", timeout=30000)
            pg.evaluate(WAIT_JS, 1200)
            return pg

        def fps_run(pg):
            pg.evaluate("NR.core.start('pursuit')")
            pg.evaluate(KEEP_JS)
            pg.evaluate("window.__auto = setInterval(() => { const t = performance.now()/1000, st = NR.controls.state; st.mx = Math.sin(t*0.9)*0.8; st.my = Math.sin(t*0.6)*0.5; }, 16)")
            pg.evaluate(WAIT_JS, 2500)
            v = [pg.evaluate(FPS_JS) for _ in range(3)]
            pg.close()
            return sum(v) / len(v)

        # ---- fps: baseline (HEAD) then new, same setup, interleaved twice to cancel drift ----
        base_url = f"http://127.0.0.1:{PORT}/tests/out/_base/src/dev.html"
        new_url = f"http://127.0.0.1:{PORT}/src/dev.html"
        fb1 = fps_run(load(base_url)); fn1 = fps_run(load(new_url)); fb2 = fps_run(load(base_url)); fn2 = fps_run(load(new_url))
        fb, fn = (fb1 + fb2) / 2, (fn1 + fn2) / 2
        print("fps before %.1f after %.1f" % (fb, fn))
        check("fps after >= before - 3", fn >= fb - 3, "before %.1f after %.1f" % (fb, fn))

        pg = load(new_url)
        # ---- title: no quarry ----
        check("title: quarry hidden", pg.evaluate("!NR.quarry.active || !NR.scene && true") and pg.evaluate("document.getElementById('nrq').style.display") in ("none", ""))

        # ---- PURSUIT, 40 s, no input ----
        pg.evaluate("NR.core.start('pursuit')")
        pg.evaluate(KEEP_JS)
        pg.evaluate(LOG_JS)
        pg.evaluate(WAIT_JS, 1500)
        check("pursuit: quarry active", pg.evaluate("NR.quarry.active === true && NR.core.mode === 'pursuit'"))
        pg.evaluate("window.__pose = setInterval(() => NR.quarry.setPose(2, 9, 75), 8)")  # pin it for a repeatable framing
        pg.evaluate(WAIT_JS, 600)
        pg.screenshot(path=os.path.join(OUT, "quarry_far.png"))
        pg.evaluate("clearInterval(window.__pose)")
        pg.evaluate(WAIT_JS, 38500)
        g = pg.evaluate("window.__g")
        gs = [r[0] for r in g]
        print("gap over 40 s: min %.1f max %.1f mean %.1f samples %d" % (min(gs), max(gs), sum(gs) / len(gs), len(gs)))
        check("pursuit: gap stays in 20..130 m", min(gs) >= 19.99 and max(gs) <= 130.01, "%.1f..%.1f" % (min(gs), max(gs)))
        check("pursuit: rests far ahead (mean gap 50..100 m)", 50 < sum(gs) / len(gs) < 100, "mean %.1f" % (sum(gs) / len(gs)))
        check("pursuit: HUD tag visible", pg.evaluate("document.getElementById('nrq').style.display") == "block")
        pg.screenshot(path=os.path.join(OUT, "quarry_tag.png"))

        # ---- tricks via hook (quarry pinned close so the shots read) ----
        pg.evaluate("window.__pose = setInterval(() => NR.quarry.setPose(0, 9, 30), 8)")
        pg.evaluate("NR.quarry.trick('roll', true)")
        pg.evaluate(WAIT_JS, 500)
        check("trick: roll runs", pg.evaluate("NR.quarry.state().trickType === 1 && Math.abs(NR.quarry.state().rollAng) > 1"), pg.evaluate("NR.quarry.state().rollAng"))
        pg.screenshot(path=os.path.join(OUT, "quarry_roll.png"))
        pg.evaluate("NR.quarry.trick(null)")
        pg.evaluate(WAIT_JS, 700)
        check("trick: roll ends", pg.evaluate("NR.quarry.state().trickType === 0 && NR.quarry.state().rollAng === 0"))
        pg.evaluate("NR.quarry.trick('juke')")
        pg.evaluate(WAIT_JS, 200)
        check("trick: juke moves sideways", pg.evaluate("Math.abs(NR.quarry.state().offX) > 1"), pg.evaluate("NR.quarry.state().offX"))
        pg.evaluate(WAIT_JS, 600)

        # ---- quarry boost flame ----
        pg.evaluate("NR.quarry.boost()")
        pg.evaluate(WAIT_JS, 600)
        check("quarry boost: flame on", pg.evaluate("NR.quarry.state().boostT > 0 && NR.quarry.state().boostVis > 0.5"))
        pg.screenshot(path=os.path.join(OUT, "quarry_boostflame.png"))
        pg.evaluate("clearInterval(window.__pose)")
        pg.evaluate(WAIT_JS, 3000)

        # ---- player boost held 5 s: gap shrinks, never under 4; quarry boosts after the player ----
        for attempt in range(3):  # the quarry only boosts when its look-ahead is clear, so allow a retry
            pg.evaluate(WAIT_JS, 6000)  # let the player's fuel refill and the quarry settle
            pg.evaluate("NR.player.boostFuel = 1")
            for _ in range(30):  # start from the rest band (60 to 90 m), not from a slip at 120 m
                if pg.evaluate("NR.quarry.gap") <= 90:
                    break
                pg.evaluate(WAIT_JS, 500)
            g0 = pg.evaluate("NR.quarry.gap")
            pg.evaluate(LOG_JS)
            pg.keyboard.down("Space")
            shot = False
            for _ in range(40):
                pg.evaluate(WAIT_JS, 100)
                if not shot and attempt == 0 and pg.evaluate("NR.quarry.gap") <= 32:
                    pg.screenshot(path=os.path.join(OUT, "quarry_closing.png")); shot = True
            pg.evaluate(WAIT_JS, 1000)
            pg.keyboard.up("Space")
            g = pg.evaluate("window.__g")
            gs = [r[0] for r in g]
            print("boost 5 s attempt %d: start gap %.1f min %.1f" % (attempt + 1, g0, min(gs)))
            if any(r[1] > 0 for r in g) and min(gs) < 35:
                break
        check("boost: gap closes below 35 m", min(gs) < 35, "start %.1f min %.1f" % (g0, min(gs)))
        check("boost: gap never under 20 m", min(gs) >= 19.99, "min %.2f" % min(gs))
        check("boost: quarry boosted after the player", any(r[1] > 0 for r in g))

        # ---- off-screen marker ----
        pg.evaluate("window.__pose = setInterval(() => NR.quarry.setPose(14, 24, 40), 8)")
        pg.evaluate(WAIT_JS, 600)
        mk = pg.evaluate("({chev: document.querySelector('#nrq').children[1].style.display, tag: document.querySelector('#nrq').children[0].style.display})")
        check("marker: chevron shown when off screen", mk["chev"] == "block", mk)
        pg.screenshot(path=os.path.join(OUT, "quarry_marker.png"))
        pg.evaluate("clearInterval(window.__pose)")


        # ---- hub image: real play in NEON CANYON, 16:9 composed from the 9:16 frame ----
        hp = ctx.new_page()
        hp.set_viewport_size({"width": 405, "height": 720})
        hp.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        hp.goto(new_url)
        hp.wait_for_function("window.READY === true", timeout=30000)
        hp.evaluate(WAIT_JS, 1200)
        hp.add_style_tag(content="#nrc,#nrkeys{display:none!important}")
        hp.evaluate("NR.core.start('pursuit')")
        hp.evaluate(KEEP_JS)
        hp.evaluate("window.__auto = setInterval(() => { const t = performance.now()/1000, st = NR.controls.state; st.mx = Math.sin(t*0.5)*0.35; st.my = 0; }, 16)")
        PROBE = """() => { const q = NR.quarry, v = q.pos.clone().project(NR.core.camera); return { gap: q.gap, x: v.x, y: v.y, hid: q.hidden(), st: q.state(), d: NR.core.district, dist: NR.core.dist }; }"""
        hp.evaluate(WAIT_JS, 4000)
        best = None
        for _ in range(34):
            pr = hp.evaluate(PROBE)
            if pr["d"] == 0 and 55 <= pr["gap"] <= 95 and abs(pr["x"]) < 0.5 and 0.0 < pr["y"] < 0.5 and not pr["hid"] and pr["st"]["trickType"] == 0 and pr["st"]["boostT"] == 0:
                best = pr
                break
            hp.evaluate(WAIT_JS, 400)
        print("hub frame probe:", best)
        check("hub: found a clear frame in NEON CANYON", best is not None)
        hp.screenshot(path=os.path.join(OUT, "_hub_raw.png"))
        hp.close()
        from PIL import Image, ImageFilter, ImageEnhance
        raw = Image.open(os.path.join(OUT, "_hub_raw.png")).convert("RGB")
        col = raw.resize((405, 720), Image.LANCZOS)
        bg = raw.resize((1280, 1280 * raw.height // raw.width), Image.LANCZOS)
        top = (bg.height - 720) // 2
        bg = bg.crop((0, top, 1280, top + 720)).filter(ImageFilter.GaussianBlur(22))
        bg = ImageEnhance.Brightness(bg).enhance(0.4)
        bg.paste(col, ((1280 - 405) // 2, 0))
        bg.save(os.path.join(OUT, "hub_skyrunner.jpg"), quality=85, optimize=True)
        os.remove(os.path.join(OUT, "_hub_raw.png"))
        print("hub image bytes:", os.path.getsize(os.path.join(OUT, "hub_skyrunner.jpg")))
        check("hub image under 300 KB", os.path.getsize(os.path.join(OUT, "hub_skyrunner.jpg")) < 300 * 1024)

        # ---- NIGHT DRIVE ----
        pg.evaluate("NR.core.start('night')")
        pg.evaluate(WAIT_JS, 1500)
        check("night: quarry absent", pg.evaluate("NR.quarry.active === false") and pg.evaluate("document.getElementById('nrq').style.display") == "none")

        # ---- fixed-step soak, 5 simulated minutes per speed tier ----
        pg.evaluate("NR.cfg.MODES.pursuit.ramp = 0")
        for name, spd in (("SPEED_START", 60), ("mid", 125), ("SPEED_MAX", 190)):
            pg.evaluate("NR.core.start('pursuit')")
            pg.evaluate(KEEP_JS)
            pg.evaluate("(s) => { window.__soak = { speed: s, steps: 0, world: 0, cars: 0, out: 0, minCar: 1e9, minObs: 1e9, gmin: 1e9, gmax: 0, boosts: 0, tricks: 0 }; }", spd)
            total, res = 18000, None
            t0 = time.time()
            for _ in range(total // 3000):
                res = pg.evaluate(SOAK_JS, [3000, 1 / 60])
            print("soak %s (%d m/s): %s  [%.0f s wall]" % (name, spd, res, time.time() - t0), flush=True)
            check("soak %s: steps run" % name, res["steps"] == total and res["state"] == "PLAY", res["steps"])
            check("soak %s: no world collision" % name, res["world"] == 0, res["world"])
            check("soak %s: no traffic collision" % name, res["cars"] == 0, res["cars"])
            check("soak %s: inside corridor" % name, res["out"] == 0, res["out"])
            check("soak %s: clearance to traffic >= 1.5 m" % name, res["minCar"] >= 1.5 - 1e-3, "%.2f" % res["minCar"])
            check("soak %s: clearance to world geometry >= 1.0 m" % name, res["minObs"] >= 1.0 - 1e-3, "%.2f" % res["minObs"])
            print("   near clearance: traffic %.2f m, obstacles %.2f m; gap %.1f..%.1f; quarry boosts %d tricks %d; safety slides %d" % (res["minCar"], res["minObs"], res["gmin"], res["gmax"], res["boosts"], res["tricks"], res["saves"]))
        b.close()
finally:
    srv.terminate()
    try:
        srv.wait(5)
    except Exception:
        srv.kill()
    shutil.rmtree(BASE, ignore_errors=True)

check("no console errors", not errors, errors[:5])
print("FAILED: %s" % fails if fails else "ALL PASS")
sys.exit(1 if fails else 0)
