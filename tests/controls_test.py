"""NR.controls test: real page, Chromium mobile 390x844, CDP multi-touch, keyboard, fps, screenshots."""
import os, socket, subprocess, sys, time, json
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "tests", "shots")
os.makedirs(OUT, exist_ok=True)

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

port = free_port()
srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "tests", "range_server.py"), str(port)], cwd=ROOT,
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
        # ---- ROLL (round 2) ----
        pg.evaluate("NR.player.siren = 0")
        check("roll button >= 64 px", L["rr"] * 2 >= 64, L["rr"])
        rb = pg.evaluate("(() => { const r = NR.controls.els.roll.getBoundingClientRect(), b = NR.controls.els.boost.getBoundingClientRect(), s = NR.controls.els.siren.getBoundingClientRect(); return {r:[r.left,r.top,r.right,r.bottom], b:[b.left,b.top,b.right,b.bottom], s:[s.left,s.top,s.right,s.bottom]}; })()")
        ov = lambda a, c: not (a[2] <= c[0] or c[2] <= a[0] or a[3] <= c[1] or c[3] <= a[1])
        import math
        cdist = lambda a, c: math.hypot((a[0]+a[2]-c[0]-c[2])/2, (a[1]+a[3]-c[1]-c[3])/2) - (a[2]-a[0])/2 - (c[2]-c[0])/2
        check("roll between siren and boost, circles apart", rb["s"][1] < rb["r"][1] < rb["b"][1] and cdist(rb["r"], rb["b"]) > 6 and cdist(rb["r"], rb["s"]) > 6, (rb, round(cdist(rb["r"], rb["b"]),1), round(cdist(rb["r"], rb["s"]),1)))
        realRoll = pg.evaluate("!!(NR.player && 'rollCooldown' in NR.player && typeof NR.player.push === 'function')")
        print("player roll implemented:", realRoll)
        pg.evaluate("""window._roll=[]; (function f(){ const s=NR.controls.state; if(s.roll) window._roll.push([s.rollX,s.rollY,s.boost,+s.mx.toFixed(2),+s.my.toFixed(2)]); requestAnimationFrame(f); })()""")
        def rolls(): return pg.evaluate("window._roll")
        def clear_rolls(): pg.evaluate("window._roll.length=0")
        def cool(v):
            if not realRoll: pg.evaluate(f"NR.player.rollCooldown = {v}")
        def wait_ready():
            pg.wait_for_timeout(100)
            if realRoll: pg.wait_for_function("NR.player.rollCooldown <= 0 && !NR.player.rolling", timeout=4000)
        cool(0)
        rx, ry = ox + L["rx"], oy + L["ry"]
        # tap ROLL with the stick held left -> one frame, dir (-1,0)
        touch("touchStart", [(6, sx, sy)]); touch("touchMove", [(6, sx - 50, sy)])
        touch("touchStart", [(6, sx - 50, sy), (7, rx, ry)])
        pg.wait_for_timeout(120)
        check("touch roll one frame, left", len(rolls()) == 1 and rolls()[0][:2] == [-1, 0], rolls())
        check("roll button pressed look", pg.evaluate("NR.controls.els.roll.classList.contains('dn')"))
        if realRoll:
            pg.wait_for_timeout(60); check("player rolled (real)", pg.evaluate("NR.player.rolling || NR.player.rollCooldown > 0"))
        else:
            pg.evaluate("NR.player.rolling = true; NR.player.rollCooldown = 0.7")
        pg.wait_for_timeout(80)
        pg.screenshot(path=os.path.join(OUT, "controls_roll_press.png"))
        touch("touchEnd", [(6, sx - 50, sy)]); touch("touchEnd", [])
        if not realRoll: pg.evaluate("NR.player.rolling = false; NR.player.rollCooldown = 0.6")
        pg.wait_for_timeout(100)
        check("cooldown look", pg.evaluate("NR.controls.els.roll.classList.contains('cool')"))
        pg.screenshot(path=os.path.join(OUT, "controls_roll_cooldown.png"))
        # press during long cooldown -> no roll, shake
        clear_rolls()
        if not realRoll: pg.evaluate("NR.player.rollCooldown = 0.6")
        else: pg.wait_for_function("NR.player.rollCooldown > 0.3", timeout=200) if pg.evaluate("NR.player.rollCooldown") > 0.3 else None
        if pg.evaluate("NR.player.rollCooldown") > 0.25:
            touch("touchStart", [(8, rx, ry)]); touch("touchEnd", [])
            pg.wait_for_timeout(60)
            check("no roll during cooldown", len(rolls()) == 0, rolls())
        # buffered press near cooldown end fires once when it hits 0
        if not realRoll:
            clear_rolls(); pg.evaluate("NR.player.rollCooldown = 0.1")
            touch("touchStart", [(9, rx, ry)]); touch("touchEnd", [])
            check("buffer holds while cooling", len(rolls()) == 0, rolls())
            pg.evaluate("NR.player.rollCooldown = 0"); pg.wait_for_timeout(80)
            check("buffered roll fires once", len(rolls()) == 1, rolls())
        cool(0); wait_ready()
        # slide from BOOST onto ROLL: roll fires, boost stays held; slide off and back = second roll
        clear_rolls()
        touch("touchStart", [(10, bx, by)])
        touch("touchMove", [(10, (bx + rx) / 2, (by + ry) / 2)])
        touch("touchMove", [(10, rx + 4, ry + 4)]); pg.wait_for_timeout(60)
        r1 = rolls()
        check("slide boost->roll rolls, boost held", len(r1) == 1 and r1[0][2] and pg.evaluate("NR.controls.state.boost"), r1)
        touch("touchMove", [(10, rx + 8, ry + 2)]); pg.wait_for_timeout(60)
        check("staying on roll = no repeat", len(rolls()) == 1, rolls())
        touch("touchEnd", [])
        check("boost released after slide", not pg.evaluate("NR.controls.state.boost"))
        cool(0); wait_ready()
        # keyboard: hold Up then R -> dir (0,1) even on the first frame of the arrow
        clear_rolls()
        pg.keyboard.down("ArrowUp"); pg.keyboard.press("KeyR"); pg.wait_for_timeout(80); pg.keyboard.up("ArrowUp")
        check("R rolls toward held Up", len(rolls()) == 1 and rolls()[0][:2] == [0, 1], rolls())
        cool(0); wait_ready(); pg.wait_for_timeout(300)
        clear_rolls()
        pg.keyboard.down("ArrowRight"); pg.keyboard.press("ControlLeft"); pg.wait_for_timeout(80); pg.keyboard.up("ArrowRight")
        check("Ctrl rolls toward held Right", len(rolls()) == 1 and rolls()[0][:2] == [1, 0], rolls())
        cool(0); wait_ready(); pg.wait_for_timeout(300)
        clear_rolls(); pg.keyboard.press("KeyR"); pg.wait_for_timeout(80)
        check("R with no keys = spin (0,0)", len(rolls()) == 1 and rolls()[0][:2] == [0, 0], rolls())
        check("still PLAY after Ctrl/R", pg.evaluate("NR.core.state") == "PLAY")
        # gamepad B (button 1) with a fake pad
        cool(0); wait_ready(); pg.wait_for_timeout(300); clear_rolls()
        pg.evaluate("""(() => { const mk = p => ({ connected: true, axes: [0.9, 0, 0, 0], buttons: Array.from({length: 17}, (_, i) => ({ pressed: i === 1 && p, value: i === 1 && p ? 1 : 0 })) });
            window._padB = false; navigator.getGamepads = () => [mk(window._padB)]; dispatchEvent(new Event('gamepadconnected')); })()""")
        pg.wait_for_timeout(60); pg.evaluate("window._padB = true"); pg.wait_for_timeout(120)
        check("gamepad B rolls right, once", len(rolls()) == 1 and rolls()[0][:2] == [1, 0], rolls())
        pg.evaluate("window._padB = false; navigator.getGamepads = () => []")
        pg.wait_for_timeout(100)
        # keyboard key panel shows R ROLL
        pg.evaluate("NR.core.isTouch = false")
        ctx2 = b.new_context(viewport={"width": 1280, "height": 800})
        pk = ctx2.new_page(); pk.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pk.goto(f"http://127.0.0.1:{port}/src/dev.html"); pk.wait_for_function("window.READY === true", timeout=20000)
        pk.evaluate("NR.core.start()"); pk.keyboard.press("ArrowLeft"); pk.wait_for_timeout(500)
        txt = pk.evaluate("(document.getElementById('nrkeys')||{}).innerText || ''")
        check("key panel has R ROLL", "R ROLL" in txt.replace("\n", " "), txt)
        pk.screenshot(path=os.path.join(OUT, "keys_roll.png")); ctx2.close()
        pg.evaluate("NR.core.isTouch = true")
        # fps over 5 s in PLAY with stick held
        touch("touchStart", [(5, sx, sy)]); touch("touchMove", [(5, sx - 40, sy + 20)])
        fps = pg.evaluate("""() => new Promise(r => { const t=[]; function f(n){ t.push(n); if (n - t[0] < 5000) requestAnimationFrame(f); else {
            const d=t.slice(1).map((v,i)=>v-t[i]).sort((a,b)=>a-b); r({fps: (t.length-1)/((t[t.length-1]-t[0])/1000), p95: d[Math.floor(d.length*.95)]}); } } requestAnimationFrame(f); })""")
        touch("touchEnd", [])
        check("fps", fps["fps"] > 55, fps)
        pg.evaluate("NR.core.dist = 9500; NR.core.loop = 1"); pg.wait_for_timeout(1500)
        fps2 = pg.evaluate("""() => new Promise(r => { const t=[]; function f(n){ t.push(n); if (n - t[0] < 4000) requestAnimationFrame(f); else r((t.length-1)/((t[t.length-1]-t[0])/1000)); } requestAnimationFrame(f); })""")
        check("fps late (cycle 2)", fps2 > 55 or pg.evaluate("NR.core.state") != "PLAY", (fps2, pg.evaluate("NR.core.state")))
        pg.screenshot(path=os.path.join(OUT, "controls_late.png"))
        mine = [e for e in errors if "controls" in e.lower() or "nrc" in e.lower()]
        check("no controls console errors", not mine, mine)
        print("other console errors:", len(errors) - len(mine), json.dumps(errors[:5])[:600])
        b.close()
finally:
    srv.terminate(); srv.wait(5)
print("RESULT", "OK" if not fails else "FAIL " + ",".join(fails))
