"""NR.ui test: real page, Playwright Chromium, phone viewport. Run: python tests/ui_test.py [painted_art.png]
With an argument, a second pass serves that image as assets/title.png (painted title art path)."""
import os
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SHOTS = os.path.join(ROOT, "tests", "shots")
os.makedirs(SHOTS, exist_ok=True)
ART = sys.argv[1] if len(sys.argv) > 1 else None


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
sys.stdout.reconfigure(encoding='utf-8')
FPS_JS = """() => new Promise(r => { const t = []; let last = performance.now(); const t0 = last;
  function f(n) { t.push(n - last); last = n; if (n - t0 < 5000) requestAnimationFrame(f); else {
    t.shift(); const avg = t.reduce((a, b) => a + b, 0) / t.length; const s = t.slice().sort((a, b) => a - b);
    r({fps: +(1000 / avg).toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), n: t.length}); } }
  requestAnimationFrame(f); })"""


def check(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + (" " + str(info) if info else ""))
    if not ok:
        fails.append(name)


def shot(page, name):
    page.screenshot(path=os.path.join(SHOTS, name))


def visible(page, sel):
    return page.evaluate(f"""(() => {{ const e = document.querySelector('{sel}'); if (!e) return false;
      const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.5; }})()""")


def new_page(b, art=None):
    ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    if art:
        page.route("**/assets/title.png", lambda route: route.fulfill(path=art, content_type="image/png"))
    page.goto(f"http://127.0.0.1:{port}/src/dev.html")
    page.wait_for_function("window.READY === true", timeout=20000)
    page.wait_for_function("NR.ui && NR.ui.artMode !== 'loading'", timeout=20000)
    page.wait_for_timeout(1500)
    return ctx, page


try:
    time.sleep(0.8)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-angle=d3d11", "--enable-gpu"])
        ctx, page = new_page(b)
        page.evaluate("localStorage.removeItem('neonRain.runs')")

        # ---- TITLE ----
        r = page.evaluate("""({mode: NR.ui.artMode, screen: NR.ui.screen, state: NR.core.state,
          logo: document.querySelector('#nru .logo').innerText, foot: document.querySelector('#nru .foot').textContent,
          text: document.getElementById('ui').innerText, ember: NR.ui.ember})""")
        check("title shown (code art fallback)", r["state"] == "TITLE" and r["screen"] == "title" and r["mode"] == "code", r["mode"])
        check("logo NEON/RAIN, no subtitle", r["logo"].split() == ["NEON", "RAIN"] and "SKY" not in r["text"], r["logo"].split())
        check("footer music + best", r["foot"].startswith("MUSIC: ") and " ·  BEST " in r["foot"], r["foot"])
        page.wait_for_timeout(5500)  # let one ember drag + exhale happen
        shot(page, "ui_title_code.png")
        fps = page.evaluate(FPS_JS)
        check("title fps >= 55", fps["fps"] >= 55, fps)

        # touch targets >= 56 css px
        page.evaluate("NR.ui.open('settings')")
        small = page.evaluate("""[...document.querySelectorAll('#nru button, #nru .sld')].filter(e => e.offsetParent).map(e => {
          const r = e.getBoundingClientRect(); return [e.textContent.trim(), Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 56 || x[2] < 55.5)""")
        check("touch targets >= 56 px", not small, small)
        page.evaluate("NR.ui.open('title')")

        # ---- menu: keys ----
        page.keyboard.press("ArrowDown")
        r = page.evaluate("[...document.querySelectorAll('#nru .menu button')].findIndex(b => b.classList.contains('sel'))")
        check("ArrowDown moves selection", r == 1, r)
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        check("Enter opens BEST RUNS", page.evaluate("NR.ui.screen") == "best" and visible(page, "#nru .panel.on"))
        shot(page, "ui_best_empty.png")
        page.keyboard.press("Escape")
        check("Escape goes back", page.evaluate("NR.ui.screen") == "title")

        # ---- settings by touch ----
        page.tap("#nru .menu button:nth-child(3)")
        page.wait_for_timeout(200)
        check("tap SETTINGS opens panel", page.evaluate("NR.ui.screen") == "settings")
        box = page.locator("#nru .panel.on .sld").first.bounding_box()
        page.touchscreen.tap(box["x"] + box["width"] * 0.31, box["y"] + box["height"] / 2)
        page.wait_for_timeout(100)
        r = page.evaluate("({m: NR.core.settings.music, saved: JSON.parse(localStorage.getItem(NR.cfg.SETTINGS_KEY)||'{}').music})")
        check("music slider sets + saves", abs(r["m"] - 0.3) < 0.051 and r["saved"] == r["m"], r)
        q0 = page.evaluate("NR.core.settings.quality")
        other = "high" if q0 == "low" else "low"
        page.tap(f"#nru .panel.on .tg:nth-of-type({1 if other == 'high' else 2})")
        page.wait_for_timeout(200)
        r = page.evaluate("[NR.core.settings.quality, NR.core.renderer.getSize(new NR.core.THREE.Vector2()).x]")
        check("quality toggle -> setQuality", r[0] == other and r[1] == (360 if other == "high" else 270), r)
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowRight")
        r = page.evaluate("NR.core.settings.sfx")
        check("keys adjust sfx", abs(r - 0.9) < 0.051, r)
        page.evaluate("localStorage.setItem(NR.cfg.BEST_KEY, JSON.stringify({score: 12345})); NR.core.best = 12345")
        page.tap("#nru .panel.on .wide")
        page.wait_for_timeout(100)
        armed = page.evaluate("NR.core.best")
        page.tap("#nru .panel.on .wide")
        r = page.evaluate("[NR.core.best, localStorage.getItem(NR.cfg.BEST_KEY)]")
        check("reset best needs 2 taps", armed == 12345 and r[0] == 0 and r[1] is None, [armed, r])
        shot(page, "ui_settings.png")
        page.tap("#nru .panel.on .back")
        page.tap("#nru .menu button:nth-child(4)")
        page.wait_for_timeout(200)
        r = page.evaluate("document.querySelector('#nru .panel.on').innerText")
        check("credits text", "JOHN SLAGBOOM" in r and "RAINY SAX" in r and "OLD SCHOOL TEST 1" in r and "THREE.JS" in r, r.replace("\n", " | "))
        shot(page, "ui_credits.png")
        page.tap("#nru .panel.on .back")

        # ---- START -> HUD ----
        page.tap("#nru .menu button:nth-child(1)")
        page.wait_for_timeout(700)
        r = page.evaluate("({s: NR.core.state, scr: NR.ui.screen})")
        check("tap START -> PLAY", r == {"s": "PLAY", "scr": "hud"}, r)
        check("title hidden, HUD visible", not visible(page, "#nru .ttl") and visible(page, "#nru .hud"))
        page.wait_for_timeout(300)
        shot(page, "ui_hud_banner.png")
        r = page.evaluate("document.querySelector('#nru .ban').textContent")
        check("district banner", r == "DISTRICT 1 // NEON CANYON", r)
        page.evaluate("NR.bus.emit('district', {index: 1, name: 'FIRE STACKS', loop: 1})")
        r = page.evaluate("document.querySelector('#nru .ban').textContent")
        check("cycle banner", r == "DISTRICT 2 // FIRE STACKS // CYCLE 2", r)
        page.evaluate("NR.bus.emit('nearMiss', {dist: 1})")
        page.evaluate("NR.bus.emit('nearMiss', {dist: 1})")
        page.wait_for_timeout(250)
        r = page.evaluate("[...document.querySelectorAll('#nru .pop.go')].map(p => p.innerText.replace(/\\n/g, ' '))")
        check("score popups", any("NEAR MISS x2" in x for x in r), r)
        page.evaluate("NR.bus.emit('hit', {hull: 2, kind: 'test'}); if (NR.player) NR.player.hull = 2")
        page.wait_for_timeout(120)
        shot(page, "ui_hud_hit.png")
        r = page.evaluate("[document.querySelectorAll('#nru .hull i.x').length, +getComputedStyle(document.querySelector('#nru .edge')).opacity]")
        check("hit: edge pulse + hull pips", r[0] == 1 and r[1] > 0.3, r)
        r = page.evaluate("[document.querySelector('#nru .sc').textContent, document.querySelector('#nru .kmh span').textContent, Math.floor(NR.core.score)]")
        check("score + km/h shown", r[0].replace(",", "").isdigit() and int(r[1]) >= 200, r)
        page.wait_for_timeout(2200)
        fps = page.evaluate(FPS_JS)
        check("play fps >= 55", fps["fps"] >= 55, fps)
        shot(page, "ui_hud.png")

        # ---- PAUSE ----
        page.tap("#nru .pz")
        page.wait_for_timeout(450)
        check("pause button -> PAUSE", page.evaluate("NR.core.state") == "PAUSE" and visible(page, "#nru .ov:not(.dead)"))
        shot(page, "ui_pause.png")
        page.tap("#nru .ov:not(.dead) .big:nth-of-type(1)")
        page.wait_for_timeout(450)
        check("resume -> PLAY", page.evaluate("NR.core.state") == "PLAY")

        # ---- DEAD ----
        page.evaluate("NR.core.score = 48210; NR.core.dist = 3123; NR.bus.emit('crash', {})")
        page.wait_for_timeout(300)
        check("DEAD panel waits for the crash", page.evaluate("NR.core.state") == "DEAD" and not visible(page, "#nru .dead"))
        page.wait_for_timeout(2400)
        r = page.evaluate("""({v: !!document.querySelector('#nru .dead:not(.off)'), t: document.querySelector('#nru .dead').innerText,
          runs: JSON.parse(localStorage.getItem('neonRain.runs')||'[]')})""")
        check("results panel", r["v"] and "PURSUIT ENDED" in r["t"] and "48,210" in r["t"] and "3.12 KM" in r["t"] and "RETRY" in r["t"], r["t"].replace("\n", " | "))
        check("run saved", len(r["runs"]) == 1 and r["runs"][0]["score"] == 48210, r["runs"])
        check("NEW BEST flash", visible(page, "#nru .nb.on"))
        shot(page, "ui_dead.png")
        page.tap("#nru .dead .big:nth-of-type(1)")
        page.wait_for_timeout(500)
        check("RETRY -> PLAY", page.evaluate("NR.core.state") == "PLAY" and not visible(page, "#nru .dead"))
        page.evaluate("NR.core.score = 900; NR.bus.emit('crash', {})")
        page.wait_for_timeout(2000)
        page.tap("#nru .dead .big:nth-of-type(2)")
        page.wait_for_timeout(600)
        check("MENU -> TITLE", page.evaluate("NR.core.state + '/' + NR.ui.screen") == "TITLE/title" and visible(page, "#nru .ttl"))
        page.tap("#nru .menu button:nth-child(2)")
        page.wait_for_timeout(200)
        r = page.evaluate("document.querySelectorAll('#nru .runs tr').length")
        check("best runs lists 2 runs", r == 2, r)
        shot(page, "ui_best.png")
        ctx.close()

        # ---- painted title art path ----
        if ART:
            ctx, page = new_page(b, ART)
            r = page.evaluate("({m: NR.ui.artMode, e: NR.ui.ember})")
            check("painted art loads", r["m"] == "painted", r)
            page.wait_for_timeout(5000)
            shot(page, "ui_title_painted.png")
            ctx.close()
        b.close()

    mine = [e for e in errors if "ui" in e.lower() and "Failed to load resource" not in e]
    check("no console errors from ui", not mine, mine)
    print("other console errors:", len(errors) - len(mine), sorted(set(e[:120] for e in errors if e not in mine)))
finally:
    srv.kill()
print("FAILS:", fails if fails else "none")
sys.exit(1 if fails else 0)
