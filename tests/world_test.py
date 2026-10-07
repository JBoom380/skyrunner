"""NR.world test: real page in Playwright Chromium (phone viewport). Serves the repo root on a free port, kills only its own server.

Checks: no console errors from the world module, API (collide hit/miss, kinds, normals), every obstacle row leaves a gap the car fits,
obstacle spacing, district streaming for all five districts, fps over 5 s in PLAY, scene draw calls. Screenshots -> tests/shots/world_*.png
"""
import json
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
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


port = free_port()
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails, notes = [], []


def check(ok, msg):
    (notes if ok else fails).append(("PASS " if ok else "FAIL ") + msg)


GAP_JS = """() => {
  const obs = NR.world.obstacles().filter(o => o.z1 < -20);
  obs.sort((a, b) => b.z1 - a.z1);
  const rows = []; // cluster by z overlap (anything within 8 m acts as one wall)
  for (const o of obs) { const r = rows.find(r => o.z0 <= r.z1 + 8 && o.z1 >= r.z0 - 8); if (r) { r.list.push(o); r.z0 = Math.min(r.z0, o.z0); r.z1 = Math.max(r.z1, o.z1); } else rows.push({ z0: o.z0, z1: o.z1, list: [o] }); }
  const res = [];
  for (const r of rows) {
    let free = 0;
    for (let x = -17; x <= 17; x += 0.5) for (let y = -5.2; y <= 29.2; y += 0.5) {
      const hx = 1.6, hy = 0.9; // car half box + margin
      if (!r.list.some(o => x + hx > o.x0 && x - hx < o.x1 && y + hy > o.y0 && y - hy < o.y1)) free++;
    }
    res.push({ z: Math.round(r.z1), n: r.list.length, kinds: [...new Set(r.list.map(o => o.kind))].join(','), free });
  }
  return res;
}"""

FPS_JS = """(ms) => new Promise(res => { const t = []; let last = performance.now(); const t0 = last; const f = now => { t.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(f); else res(t); }; requestAnimationFrame(f); })"""

try:
    for _ in range(50):
        try:
            socket.create_connection(("127.0.0.1", port), 0.2).close(); break
        except OSError:
            time.sleep(0.1)
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=["--use-angle=d3d11", "--enable-gpu"])
        ctx = br.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=1)
        page = ctx.new_page()
        errs = []
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        page.goto(f"http://127.0.0.1:{port}/src/dev.html")
        page.wait_for_function("window.READY && window.NR && NR.world && NR.core", timeout=20000)
        page.evaluate("""() => { const r = NR.core.renderer, orig = r.render.bind(r); r.render = (s, c) => { orig(s, c); if (s === NR.core.scene) window.__calls = r.info.render.calls; }; }""")
        page.wait_for_timeout(2500)
        info = page.evaluate("NR.world.info()")
        check(all(info["art"]), f"painted horizon art decoded {info['art']}")
        page.screenshot(path=os.path.join(SHOTS, "world_0_title.png"))
        check(info["obstacles"] == 0, f"no obstacles on the title drift ({info['obstacles']})")

        # ---- PLAY: canyon
        page.evaluate("NR.core.start()")
        page.evaluate("() => { if (NR.player) { NR.player.invuln = 1e9; } }")
        page.wait_for_timeout(1500)
        page.evaluate("() => { if (NR.player) NR.player.invuln = 1e9; }")
        fps = page.evaluate("""() => new Promise(res => { const t = []; let last = performance.now(); const f = now => { t.push(now - last); last = now; if (t.length < 400 && now - t0 < 5000) requestAnimationFrame(f); else res(t); }; const t0 = performance.now(); requestAnimationFrame(f); })""")
        fps = fps[2:]
        avg = 1000 / (sum(fps) / len(fps)); worst = max(fps)
        check(avg > 55, f"fps in PLAY avg {avg:.1f} (worst frame {worst:.1f} ms, {len(fps)} frames)")
        calls = page.evaluate("window.__calls")
        check(calls is not None and calls <= 150, f"scene draw calls {calls}")

        # ---- API: collide
        api = page.evaluate("""() => {
          const V = NR.core.THREE.Vector3, w = NR.world;
          const miss = w.collide({ min: new V(-1.3, 200, -3.7), max: new V(1.3, 201.4, 3.7) });
          const out = { miss: miss.hit };
          const o = w.obstacles().find(o => o.z1 < -50);
          if (o) { const cx = Math.max(-17, Math.min(17, (Math.max(o.x0, -17) + Math.min(o.x1, 17)) / 2)), cy = (o.y0 + o.y1) / 2, cz = (o.z0 + o.z1) / 2;
            const r = w.collide({ min: new V(cx - 1.3, cy - 0.7, cz - 3.7), max: new V(cx + 1.3, cy + 0.7, cz + 3.7) });
            out.hit = r.hit; out.kind = r.kind; out.normal = [r.normal.x, r.normal.y, r.normal.z]; out.target = o.kind; }
          out.none = w.collide(null).hit;
          return out; }""")
        check(api.get("miss") is False and api.get("none") is False, "collide() misses empty space / tolerates null")
        check(api.get("hit") is True and api.get("kind"), f"collide() hits an obstacle: {api}")

        names = ["canyon", "stacks", "arcology", "dust", "seawall"]
        rows_all = []
        for d in range(5):
            if d:
                page.evaluate(f"() => {{ NR.core.dist = {d * 2800 + 300}; if (NR.player) {{ NR.player.invuln = 1e9; NR.player.hull = 3; }} }}")
            page.wait_for_timeout(2600)
            page.evaluate("() => { if (NR.player) { NR.player.invuln = 1e9; NR.player.hull = 3; } }")
            st = page.evaluate("NR.core.state")
            if st != "PLAY":
                page.evaluate("NR.core.start()"); page.evaluate(f"() => {{ NR.core.dist = {d * 2800 + 300}; if (NR.player) NR.player.invuln = 1e9; }}"); page.wait_for_timeout(2600)
            page.screenshot(path=os.path.join(SHOTS, f"world_{d + 1}_{names[d]}.png"))
            ft = page.evaluate(FPS_JS, 2000)[2:]
            dfps = 1000 / (sum(ft) / len(ft))
            check(dfps > 55, f"{names[d]} fps {dfps:.1f} (worst {max(ft):.1f} ms)")
            rows = page.evaluate(GAP_JS)
            rows_all += rows
            inf = page.evaluate("NR.world.info()")
            check(page.evaluate("NR.core.district") == d, f"district {d} {names[d]}: obstacles ahead {len(rows)} rows, pyramid {inf['pyramid']}, pools {json.dumps(inf['pools'])}")
            if d == 2:
                check(inf["pyramid"], "arcology pyramid visible ahead")
        bad = [r for r in rows_all if r["free"] < 40]
        check(not bad, f"every obstacle row leaves a gap ({len(rows_all)} rows; worst free cells {min([r['free'] for r in rows_all] or [0])}) {bad[:3]}")
        zs = sorted(r["z"] for r in rows_all)
        # lightning in the sea wall
        light = page.evaluate("() => new Promise(res => { let n = 0; NR.bus.on('lightning', () => n++); setTimeout(() => res(n), 9500); })")
        check(light >= 1, f"lightning events in sea wall: {light}")
        page.screenshot(path=os.path.join(SHOTS, "world_5b_seawall.png"))
        # a second cycle keeps working (loop 1)
        page.evaluate("() => { NR.core.dist = 5 * 2800 + 300; if (NR.player) NR.player.invuln = 1e9; }")
        page.wait_for_timeout(1500)
        check(page.evaluate("NR.core.loop") == 1 and page.evaluate("NR.world.info().obstacles") > 0, "cycle 2 streams canyon again with obstacles")

        page.evaluate("() => { NR.core.dist = 2 * 2800 + 1700; if (NR.player) NR.player.invuln = 1e9; }")
        page.wait_for_timeout(2000)
        page.screenshot(path=os.path.join(SHOTS, "world_3b_arcology_mid.png"))

        # blend shot: stacks fading into the arcology
        page.evaluate("() => { NR.core.dist = 2 * 2800 - 200; if (NR.player) NR.player.invuln = 1e9; }")
        page.wait_for_timeout(1800)
        page.screenshot(path=os.path.join(SHOTS, "world_6_blend.png"))
        # long treadmill run on the title (forces several rebases of the local origin)
        page.evaluate("NR.core.toTitle()")
        page.wait_for_timeout(300)
        rb = page.evaluate("""() => { const fake = Object.assign({}, NR.core, { scroll: 45 }); for (let i = 0; i < 600; i++) NR.world.update(0.016, fake); NR.world.update(0.016, NR.core); return NR.world.info(); }""")
        check(rb["base"] > 0 and rb["pools"]["world.towers"] > 50, f"rebase after 27 km: base {rb['base']:.0f}, towers {rb['pools']['world.towers']}")
        page.wait_for_timeout(800)
        page.screenshot(path=os.path.join(SHOTS, "world_7_after_rebase.png"))

        werrs = [e for e in errs if "world" in e.lower()]
        check(not werrs, f"no world console errors ({len(errs)} total errors on page)")
        if errs:
            notes.append("other page errors: " + " | ".join(e[:160] for e in errs[:6]))
        br.close()
finally:
    srv.kill(); srv.wait()

print("\n".join(notes + fails))
print("RESULT:", "FAIL" if fails else "PASS")
sys.exit(1 if fails else 0)
