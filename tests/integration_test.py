"""Full-game integration pass: title -> run -> 5 districts -> crash -> results. Screenshots + fps + console errors.
Writes tests/shots/int_*.png and tests/shots/neon_rain_gameplay_sheet.png."""
import pathlib
import socket
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "shots"; OUT.mkdir(parents=True, exist_ok=True)
s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, str(ROOT / "tests" / "range_server.py"), str(PORT)], cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.0)
FPS_JS = """() => new Promise(r => { const t = []; let last = performance.now(), n = 0;
  function f(now) { t.push(now - last); last = now; if (++n < 240) requestAnimationFrame(f); else { t.sort((a,b)=>a-b);
    r({ fps: 1000 / (t.reduce((a,b)=>a+b,0) / t.length), p95: t[Math.floor(t.length*0.95)] }); } }
  requestAnimationFrame(f); })"""
WAIT_JS = "(ms) => new Promise(r => { const t0 = performance.now(); (function f(){ performance.now() - t0 > ms ? r() : requestAnimationFrame(f); })(); })"
AUTO_JS = """() => { // simple autopilot: weave so the shots show movement
  window.__auto = setInterval(() => { const t = performance.now() / 1000, st = NR.controls && NR.controls.state; if (!st) return;
    st.mx = Math.sin(t * 0.9) * 0.8; st.my = Math.sin(t * 0.6) * 0.5; }, 16); }"""
shots, errs = [], []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=d3d11", "--enable-gpu", "--autoplay-policy=no-user-gesture-required"])
        pg = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        pg.goto(f"http://127.0.0.1:{PORT}/src/dev.html")
        pg.wait_for_function("window.READY === true", timeout=30000)
        pg.evaluate(WAIT_JS, 2500)
        pg.screenshot(path=str(OUT / "int_0_title.png")); shots.append(("Title", "int_0_title.png"))
        print("title art:", pg.evaluate("NR.ui && NR.ui.artMode"), "ember", pg.evaluate("NR.ui && NR.ui.ember"))
        pg.touchscreen.tap(195, 600)
        pg.evaluate(WAIT_JS, 500)
        if pg.evaluate("NR.core.state") != "PLAY":
            pg.evaluate("NR.core.start()")
        pg.evaluate(AUTO_JS)
        pg.evaluate("setInterval(() => { NR.controls.state.roll = Math.random() < 0.02 }, 50)")
        pg.evaluate("window.__wc = NR.world.collide; window.__tc = NR.traffic.collide; const nohit = () => ({hit: false}); NR.world.collide = nohit; NR.traffic.collide = nohit;")
        pg.evaluate(WAIT_JS, 3000)
        print("PLAY fps", pg.evaluate(FPS_JS))
        L = 2800
        for d, name in enumerate(["Neon Canyon", "Fire Stacks", "The Arcology", "Dust Sea", "The Sea Wall"]):
            if d:
                pg.evaluate(f"(() => {{ const d = {d * L + 900 + 14000}; if (NR.world && NR.world.jump) NR.world.jump(d); NR.core.dist = d; }})()")
            pg.evaluate(WAIT_JS, 4000)
            fps = pg.evaluate(FPS_JS)
            info = pg.evaluate("({d: NR.core.district, dist: NR.core.dist|0, spd: NR.core.speed|0, cars: NR.traffic && NR.traffic.cars ? NR.traffic.cars.length : -1})")
            print(name, info, "fps %.1f p95 %.1f" % (fps["fps"], fps["p95"]))
            f = f"int_{d + 1}_{name.split()[-1].lower()}.png"; pg.screenshot(path=str(OUT / f)); shots.append((name, f))
        # boost + siren shot
        pg.evaluate("NR.player.boostFuel = 1; NR.controls.state.boost = true")
        pg.evaluate(WAIT_JS, 700)
        pg.screenshot(path=str(OUT / "int_6_boost.png")); shots.append(("Boost", "int_6_boost.png"))
        pg.evaluate("NR.controls.state.boost = false; NR.player.siren = 1")
        pg.evaluate("NR.bus.emit('siren', {}); NR.traffic && NR.traffic.clearAhead && NR.traffic.clearAhead(320)")
        pg.evaluate(WAIT_JS, 300)
        pg.screenshot(path=str(OUT / "int_7_siren.png")); shots.append(("Siren", "int_7_siren.png"))
        # crash
        pg.evaluate("clearInterval(window.__auto); NR.world.collide = window.__wc; NR.traffic.collide = window.__tc; NR.player.invuln = 0; NR.player.hull = 1; NR.player.alive = true")
        pg.evaluate("NR.bus.emit('hit', {hull: 0, kind: 'test'}); NR.player.hull = 0; NR.bus.emit('crash', {pos: NR.player.pos})")
        pg.evaluate(WAIT_JS, 900)
        pg.screenshot(path=str(OUT / "int_8_crash.png")); shots.append(("Crash", "int_8_crash.png"))
        pg.evaluate(WAIT_JS, 2500)
        print("state after crash:", pg.evaluate("NR.core.state"))
        pg.screenshot(path=str(OUT / "int_9_results.png")); shots.append(("Results", "int_9_results.png"))
        print("music:", pg.evaluate("NR.audio && NR.audio.nowPlaying"))
        b.close()
finally:
    srv.terminate()
print("console errors (%d):" % len(errs)); [print("  ", e[:200]) for e in errs[:20]]

font = ImageFont.truetype(r"C:\Windows\Fonts\bahnschrift.ttf", 30)
tw, th, pad, lab = 300, 649, 18, 46
cols = 5; rows = (len(shots) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw + (cols + 1) * pad, rows * (th + lab + pad) + pad + 60), (6, 7, 9))
dr = ImageDraw.Draw(sheet); dr.text((pad, 14), "NEON RAIN  -  gameplay frames (real build, 390x844 phone)", fill=(232, 200, 144), font=font)
for i, (label, f) in enumerate(shots):
    im = Image.open(OUT / f).resize((tw, th), Image.LANCZOS)
    x = pad + (i % cols) * (tw + pad); y = 60 + (i // cols) * (th + lab + pad)
    sheet.paste(im, (x, y)); dr.text((x, y + th + 6), label, fill=(143, 176, 180), font=font)
sheet.save(OUT / "neon_rain_gameplay_sheet.png"); print("sheet ok")
