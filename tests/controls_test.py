"""NR.controls test: real page, Chromium mobile 390x844, CDP multi-touch, keyboard, fps, screenshots."""
import os, socket, subprocess, sys, time, json
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "tests", "shots")
os.makedirs(OUT, exist_ok=True)

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

port = free_port()
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails, errors = [], []
def check(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + (" :: " + str(info) if info else ""))
    if not ok: fails.append(name)

try:
    time.sleep(0.8)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-angle=d3d11", "--enable-gpu"])
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
        pg = ctx.new_page()
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(f"http://127.0.0.1:{port}/src/dev.html")
        pg.wait_for_function("window.READY === true && window.NR && NR.controls && NR.core", timeout=20000)
        cdp = ctx.new_cdp_session(pg)
        def touch(kind, pts):
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, x, y in pts]})
            pg.wait_for_timeout(50)
        view = pg.evaluate("NR.core.view"); L = pg.evaluate("({...NR.controls.touchLayout})")
        ox, oy = view["left"], view["top"]
        check("api", pg.evaluate("['state','init','update','reset'].every(k => k in NR.controls)"))
        check("hidden on title", pg.evaluate("!document.getElementById('nrc').classList.contains('on')"))
        # any on title tap
        pg.evaluate("window._any=0; NR.bus.on('x',()=>{}); (function f(){ if(NR.controls.state.any) window._any++; requestAnimationFrame(f); })()")
        touch("touchStart", [(0, 200, 300)]); touch("touchEnd", [])
        pg.wait_for_timeout(100)
        check("any on title tap", pg.evaluate("window._any") >= 1, pg.evaluate("window._any"))
        pg.evaluate("NR.core.start()"); pg.wait_for_timeout(300)
        check("shown in PLAY", pg.evaluate("document.getElementById('nrc').classList.contains('on')"))
        pg.screenshot(path=os.path.join(OUT, "controls_idle.png"))
        # stick: thumb lands at left, drags up-right
        sx, sy = ox + 110, oy + view["h"] - 160
        touch("touchStart", [(1, sx, sy)])
        touch("touchMove", [(1, sx + 45, sy - 30)])
        st = pg.evaluate("({...NR.controls.state})")
        check("stick right/up", st["mx"] > 0.5 and st["my"] > 0.3, st)
        # multitouch: hold boost while stick held
        bx, by = ox + L["bx"], oy + L["by"]
        touch("touchStart", [(1, sx + 45, sy - 30), (2, bx, by)])
        st = pg.evaluate("({...NR.controls.state})")
        check("boost + stick together", st["boost"] and st["mx"] > 0.5, st)
        pg.screenshot(path=os.path.join(OUT, "controls_active.png"))
        # overshoot: base follows
        touch("touchMove", [(1, sx + 300, sy - 30), (2, bx, by)])
        base = pg.evaluate("NR.controls.stick.bx")
        check("base follows overshoot", base > 110 + 60, base)
        touch("touchEnd", [(2, bx, by)])
        check("boost released", not pg.evaluate("NR.controls.state.boost"))
        touch("touchEnd", [])
        st = pg.evaluate("({...NR.controls.state})")
        check("stick released -> 0", st["mx"] == 0 and st["my"] == 0, st)
        # deadzone
        touch("touchStart", [(3, sx, sy)]); touch("touchMove", [(3, sx + 5, sy)])
        check("deadzone", pg.evaluate("NR.controls.state.mx") == 0); touch("touchEnd", [])
        # siren: one frame only
        pg.evaluate("window._sir=0; (function f(){ if(NR.controls.state.siren) window._sir++; requestAnimationFrame(f); })()")
        touch("touchStart", [(4, ox + L["sx"], oy + L["sy"])]); pg.wait_for_timeout(300); touch("touchEnd", [])
        check("siren one frame", pg.evaluate("window._sir") == 1, pg.evaluate("window._sir"))
        # siren ready look (fake player)
        pg.evaluate("NR.player = NR.player || {}; NR.player.siren = 1; NR.player.boostFuel = 0.45")
        pg.wait_for_timeout(200)
        check("siren ready class", pg.evaluate("NR.controls.els.siren.classList.contains('ready')"))
        pg.screenshot(path=os.path.join(OUT, "controls_ready.png"))
        pg.evaluate("NR.player.siren = 0.4; NR.player.boostFuel = 1")
        # keyboard
        pg.keyboard.down("ArrowLeft"); pg.keyboard.down("Space"); pg.wait_for_timeout(400)
        st = pg.evaluate("({...NR.controls.state})")
        check("keys left+boost", st["mx"] < -0.9 and st["boost"], st)
        pg.keyboard.up("ArrowLeft"); pg.keyboard.up("Space"); pg.wait_for_timeout(400)
        check("keys release", pg.evaluate("NR.controls.state.mx") == 0)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(150)
        check("Esc pauses", pg.evaluate("NR.core.state") == "PAUSE", pg.evaluate("NR.core.state"))
        check("hidden in PAUSE", pg.evaluate("!document.getElementById('nrc').classList.contains('on')"))
        pg.keyboard.press("KeyP"); pg.wait_for_timeout(150)
        check("P resumes", pg.evaluate("NR.core.state") == "PLAY")
        # fps over 5 s in PLAY with stick held
        touch("touchStart", [(5, sx, sy)]); touch("touchMove", [(5, sx - 40, sy + 20)])
        fps = pg.evaluate("""() => new Promise(r => { const t=[]; function f(n){ t.push(n); if (n - t[0] < 5000) requestAnimationFrame(f); else {
            const d=t.slice(1).map((v,i)=>v-t[i]).sort((a,b)=>a-b); r({fps: (t.length-1)/((t[t.length-1]-t[0])/1000), p95: d[Math.floor(d.length*.95)]}); } } requestAnimationFrame(f); })""")
        touch("touchEnd", [])
        check("fps", fps["fps"] > 55, fps)
        mine = [e for e in errors if "controls" in e.lower() or "nrc" in e.lower()]
        check("no controls console errors", not mine, mine)
        print("other console errors:", len(errors) - len(mine), json.dumps(errors[:5])[:600])
        b.close()
finally:
    srv.terminate(); srv.wait(5)
print("RESULT", "OK" if not fails else "FAIL " + ",".join(fails))
