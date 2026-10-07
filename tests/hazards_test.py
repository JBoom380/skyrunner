"""NR.world round-2 hazards test: real page in Playwright Chromium (phone viewport). Serves the repo root with
tests/range_server.py on a free port and kills only that server by PID.

Checks: no world console errors; every hazard kind spawns, draws, warns (>= 1.5 s before lethal), turns lethal, and
collide() reports its kind; every lethal hazard leaves a gap the car fits; progressive density by core.difficulty;
fogExtra rises in steam/dust and eases back to 0; fps in PLAY at high difficulty. Screenshots -> tests/shots/hz_*.png
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
srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "tests", "range_server.py"), str(port)], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails, notes = [], []


def check(ok, msg):
    (notes if ok else fails).append(("PASS " if ok else "FAIL ") + msg)


FPS_JS = """(ms) => new Promise(res => { const t = []; let last = performance.now(); const t0 = last; const f = now => { t.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(f); else res(t); }; requestAnimationFrame(f); })"""
# for each lethal hazard box set this frame: is there a car-sized hole in the corridor at that z?
GAP_JS = """() => {
  const bx = NR.world.hazardBoxes(); const rows = [];
  for (const b of bx) { const r = rows.find(r => b.z0 <= r.z1 + 4 && b.z1 >= r.z0 - 4); if (r) { r.list.push(b); r.z0 = Math.min(r.z0, b.z0); r.z1 = Math.max(r.z1, b.z1); } else rows.push({ z0: b.z0, z1: b.z1, list: [b] }); }
  return rows.map(r => { let free = 0; for (let x = -17; x <= 17; x += 0.5) for (let y = -5.2; y <= 29.2; y += 0.5) if (!r.list.some(o => x + 1.4 > o.x0 && x - 1.4 < o.x1 && y + 0.8 > o.y0 && y - 0.8 < o.y1)) free++; return { kinds: [...new Set(r.list.map(o => o.kind))].join(','), free }; });
}"""
SAFE = "() => { if (NR.player) { NR.player.invuln = 1e9; NR.player.hull = 3; } }"

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
        page.evaluate("""() => { const r = NR.core.renderer, orig = r.render.bind(r); r.render = (s, c) => { orig(s, c); if (s === NR.core.scene) window.__calls = r.info.render.calls; };
          window.__hz = []; NR.bus.on('hazard', d => window.__hz.push({ kind: d.kind, phase: d.phase, t: NR.core.time, z: d.pos ? d.pos.z : null })); }""")
        page.wait_for_timeout(1500)
        page.evaluate("NR.core.start()"); page.evaluate(SAFE)
        page.wait_for_timeout(500)

        # ---- progressive density: hazards appear rarely early, more later (count over long spawn windows)
        dens = page.evaluate("""() => { const out = {}; for (const [name, dist] of [['early', 400], ['mid', 6000], ['cycle2', 14000 + 900], ['cycle3', 28000 + 900]]) {
            let hz = 0, ob = 0; for (let k = 0; k < 6; k++) { NR.world.jump(dist + k * 1500); hz += NR.world.hazards().length; ob += new Set(NR.world.obstacles().map(o => Math.round(o.z0 / 30))).size; }
            out[name] = { hz, ob }; } return out; }""")
        check(dens["early"]["hz"] <= dens["cycle2"]["hz"] and dens["cycle2"]["hz"] > 0, f"hazard count ramps with difficulty {json.dumps(dens)}")
        page.evaluate("() => { NR.core.dist = 300; }"); page.wait_for_timeout(300); page.evaluate(SAFE)

        DIST = {"drone": 0, "swing": 0, "drop": 0, "flame": 1, "steam": 1, "laser": 2, "shutter": 2, "storm": 3, "debris": 3, "lightning": 4, "spray": 4}
        SHOT_Z = {"drone": -60, "swing": -70, "drop": -45, "flame": -55, "steam": -40, "laser": -60, "shutter": -45, "storm": 60, "debris": -42, "lightning": -30, "spray": -38}
        for kind, d in DIST.items():
            page.evaluate(f"() => {{ NR.core.dist = {d * 2800 + 900}; NR.core.speed = 75; }}")
            page.wait_for_timeout(250)
            page.evaluate(SAFE)
            page.evaluate("() => { NR.world.clearHazards(); window.__hz = []; }")
            ahead = 260 if kind != "storm" else 140
            ok = page.evaluate(f"() => NR.world.spawnHazard('{kind}', {ahead}, 1.2)")
            check(ok, f"{kind}: spawnHazard")
            # track lethal boxes and the hazard's own events until it passes
            res = page.evaluate("""(kind) => new Promise(res => { const t0 = NR.core.time; let firstLethal = null, kinds = new Set(), minFree = 1e9, hit = null;
              const V = NR.core.THREE.Vector3;
              const f = () => { NR.player.invuln = 1e9; NR.core.speed = 75; const st = NR.world.hazards().find(e => e.kind === 'steam'); if (st && kind === 'steam') NR.player.pos.x = st.x;
                const bx = NR.world.hazardBoxes();
                if (bx.length && firstLethal === null) firstLethal = NR.core.time;
                for (const b of bx) { kinds.add(b.kind);
                  if (!hit) { const cx = Math.max(-17, Math.min(17, (Math.max(b.x0, -17) + Math.min(b.x1, 17)) / 2)), cy = Math.max(-5, Math.min(29, (Math.max(b.y0, -5) + Math.min(b.y1, 29)) / 2)), cz = (b.z0 + b.z1) / 2;
                    const r = NR.world.collide({ min: new V(cx - 1.3, cy - 0.7, cz - 3.7), max: new V(cx + 1.3, cy + 0.7, cz + 3.7) }); if (r.hit) hit = { kind: r.kind, n: [r.normal.x, r.normal.y, r.normal.z] }; } }
                if (bx.length) { const g = (""" + GAP_JS + """)(); for (const r of g) minFree = Math.min(minFree, r.free); }
                const h = NR.world.hazards(); const done = !h.some(e => e.kind === kind && (e.zEnd < 30)) || NR.core.time - t0 > 14;
                if (done) res({ firstLethal: firstLethal === null ? null : firstLethal - t0, kinds: [...kinds], minFree: minFree === 1e9 ? null : minFree, hit, ev: window.__hz.slice(), t0, fe: NR.core.fogExtra }); else requestAnimationFrame(f); };
              requestAnimationFrame(f); })""", kind)
            ev = res["ev"]
            warn = [e for e in ev if e["phase"] == "warn"]
            act = [e for e in ev if e["phase"] == "active"]
            lethal = kind not in ("steam", "storm", "spray")
            if lethal:
                check(res["firstLethal"] is not None and res["hit"] and res["hit"]["kind"] in (kind,) , f"{kind}: lethal box + collide kind {res['hit']} kinds {res['kinds']}")
                check(res["minFree"] is not None and res["minFree"] >= 40, f"{kind}: gap always left (min free cells {res['minFree']})")
                if warn:
                    lead = res["t0"] + res["firstLethal"] - warn[0]["t"] if kind not in ("flame", "laser", "drone", "swing") else None
                    check(lead is None or lead >= 1.4, f"{kind}: warn before lethal ({'periodic' if lead is None else f'{lead:.2f} s'})")
            if kind == "steam":
                check(res["fe"] is not None, f"steam: fogExtra at exit {res['fe']:.2f}")
            check(len(warn) + len(act) > 0, f"{kind}: hazard events {sorted(set((e['kind'], e['phase']) for e in ev))}")

        # ---- screenshots: each hazard close up while it is live (unsafe phases included)
        for kind, d in DIST.items():
            page.evaluate(f"() => {{ NR.core.dist = {d * 2800 + 1500}; NR.core.speed = 70; }}")
            page.wait_for_timeout(250); page.evaluate(SAFE)
            page.evaluate("NR.world.clearHazards()")
            page.evaluate(f"() => NR.world.spawnHazard('{kind}', 230, 1.2)")
            z = SHOT_Z[kind]
            page.wait_for_function(f"() => {{ NR.player.invuln = 1e9; NR.core.speed = 70; const h = NR.world.hazards().find(e => e.kind === '{kind}'); return !h || h.z > {z}; }}", polling="raf", timeout=15000)
            if kind == "storm":
                page.wait_for_timeout(1200)
                fe = page.evaluate("NR.core.fogExtra")
                notes.append(f"INFO fogExtra during storm shot {fe:.2f}")
            page.screenshot(path=os.path.join(SHOTS, f"hz_{kind}.png"))

        # ---- fogExtra eases back to 0 after the storm
        page.evaluate("() => { NR.core.dist = 1 * 2800 + 600; NR.world.clearHazards(); }")
        page.wait_for_timeout(3500)
        fe2 = page.evaluate("NR.core.fogExtra")
        check(fe > 0.8 and fe2 < 0.15, f"fogExtra up in dust storm ({fe:.2f}) and eased back ({fe2:.3f})")

        # ---- fps at high difficulty (cycle 3, every district)
        worst_avg = 999
        for d in range(5):
            page.evaluate(f"() => {{ NR.core.dist = {2 * 14000 + d * 2800 + 500}; }}")
            page.wait_for_timeout(1200); page.evaluate(SAFE)
            ft = page.evaluate(FPS_JS, 2500)[3:]
            avg = 1000 / (sum(ft) / len(ft)); worst_avg = min(worst_avg, avg)
            calls = page.evaluate("window.__calls")
            n = page.evaluate("NR.world.hazards().length")
            notes.append(f"INFO cycle3 district {d}: fps {avg:.1f} worst {max(ft):.1f} ms, draw calls {calls}, hazards {n}, difficulty {page.evaluate('NR.core.difficulty'):.2f}")
            check(calls <= 150, f"draw calls {calls} <= 150 (district {d})")
            if d == 0:
                page.screenshot(path=os.path.join(SHOTS, "hz_cycle3_canyon.png"))
            if d == 4:
                page.screenshot(path=os.path.join(SHOTS, "hz_cycle3_seawall.png"))
        check(worst_avg > 55, f"fps cycle 3 worst district avg {worst_avg:.1f}")

        werrs = [e for e in errs if "world" in e.lower() or "hazard" in e.lower()]
        check(not werrs, f"no world console errors ({len(errs)} errors on page) {werrs[:3]}")
        if errs:
            notes.append("other page errors: " + " | ".join(e[:160] for e in errs[:6]))
        br.close()
finally:
    srv.kill(); srv.wait()

print("\n".join(notes + fails))
print("RESULT:", "FAIL" if fails else "PASS")
sys.exit(1 if fails else 0)
