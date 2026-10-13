// SKYRUNNER player car: the PATROL 47 spinner (v4, classic wedge police spinner; concept 1, 2026-10-12).
// buildCruiser(THREE) -> { group, lights, setBank(rad), setBoost(0..1), update(t) }
// Axes: car faces -Z, +Y up, origin at body centre. Length ~7.7, width ~2.4.
window.buildCruiser = function (THREE) {
  const g = new THREE.Group();
  const cv = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const add = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); g.add(m); return m; };
  // profile lookup: pts = [[z, v], ...] sorted by z, smooth (cosine) blend between keys
  const prof = (pts, z) => {
    if (z <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (z <= pts[i][0]) { const [z0, a] = pts[i - 1], [z1, b] = pts[i], t = (z - z0) / (z1 - z0); return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * t)); }
    return pts[pts.length - 1][1];
  };
  // smooth lofted hull: rounded-box (superellipse) sections along z from bottom/top/half-width profiles, capped ends.
  // tumble: how much the section narrows toward its top (0 = straight sides).
  const loft = (Z, YB, YT, W, mat, o = {}) => {
    const NS = o.ns || 40, NR = o.nr || 28, ex = 2 / (o.n || 4), tumble = o.tumble || 0, z0 = Z[0], z1 = Z[1];
    const pos = [], idx = [];
    for (let i = 0; i <= NS; i++) {
      const z = z0 + (z1 - z0) * i / NS, yb = prof(YB, z), yt = prof(YT, z), w = prof(W, z), cy = (yb + yt) / 2, h = (yt - yb) / 2;
      for (let j = 0; j < NR; j++) {
        const a = j / NR * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        const y = cy + h * Math.sign(s) * Math.pow(Math.abs(s), ex), k = 1 - tumble * (y - yb) / Math.max(1e-3, yt - yb);
        pos.push(w * k * Math.sign(c) * Math.pow(Math.abs(c), ex), y, z);
      }
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) { const a = i * NR + j, b = i * NR + (j + 1) % NR, c = a + NR, d = b + NR; idx.push(a, c, b, b, c, d); }
    for (const [ring, flip] of [[0, false], [NS, true]]) { // end caps: fan from the section centre
      const ci = pos.length / 3, base = ring * NR; let sx = 0, sy = 0, sz = 0;
      for (let j = 0; j < NR; j++) { sx += pos[(base + j) * 3]; sy += pos[(base + j) * 3 + 1]; sz += pos[(base + j) * 3 + 2]; }
      pos.push(sx / NR, sy / NR, sz / NR);
      for (let j = 0; j < NR; j++) { const a = base + j, b = base + (j + 1) % NR; if (flip) idx.push(ci, b, a); else idx.push(ci, a, b); }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    return add(new THREE.Mesh(geo, mat));
  };
  // thin smooth trim line along a path of [x, y, z] points
  const trim = (pts, r, mat) => add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 64, r, 6), mat));

  // ---- materials ----
  const body = new THREE.MeshStandardMaterial({ color: 0x55707c, metalness: 0.4, roughness: 0.34 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8ebe6, metalness: 0.2, roughness: 0.35 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0a0c0e, metalness: 0.3, roughness: 0.7 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8e2ea, metalness: 1, roughness: 0.18 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b161e, metalness: 0.2, roughness: 0.04, clearcoat: 1 });
  const em = (c, i = 3) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.4 });
  const cyan = em(0x40f0ff, 3), red = em(0xd81c26, 2.2), head = em(0xfff4e0, 4), blueThr = em(0x3aa8ff, 5);

  // ---- decals ----
  const door = cv(512, 160, (c, w, h) => {
    c.fillStyle = '#e8ebe6'; c.fillRect(0, 0, w, h); c.fillStyle = '#0b0d0f'; c.fillRect(0, h - 10, w, 10);
    c.font = 'bold 128px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('47', w * 0.5, h * 0.48);
    c.font = 'bold 20px Arial'; c.textAlign = 'left'; c.fillText('PATROL', 14, 24);
  });
  const roofNum = cv(256, 128, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = '#0b0d0f'; c.font = 'bold 110px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('47', w / 2, h * 0.54); });
  const decal = (t, w, h) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -2 }));

  // ---- body: smooth wedge, narrow knife nose, long falling hood, wider rear haunches, rounded tail ----
  const BZ = [-4.05, 3.65];
  const BYB = [[-4.05, -0.26], [-3.5, -0.5], [-2.8, -0.55], [3.0, -0.55], [3.65, -0.4]];
  const BYT = [[-4.05, -0.1], [-3.4, 0.08], [-0.9, 0.4], [2.6, 0.46], [3.65, 0.36]];
  const BW = [[-4.05, 0.62], [-3.4, 0.98], [-2.0, 1.1], [-1.0, 1.15], [1.2, 1.18], [2.4, 1.2], [3.2, 1.14], [3.65, 0.98]];
  loft(BZ, BYB, BYT, BW, body, { ns: 48, nr: 32, n: 4.5 });
  // ---- canopy: raked glass bubble with tumblehome; white rounded roof pad ----
  loft([-1.05, 2.65], [[-1.05, 0.3], [2.65, 0.3]], [[-1.05, 0.36], [-0.1, 0.92], [1.3, 0.96], [2.65, 0.47]], [[-1.05, 0.7], [-0.3, 0.84], [1.6, 0.86], [2.65, 0.72]], glass, { n: 3, tumble: 0.32 });
  loft([-0.05, 1.45], [[-0.05, 0.84], [1.45, 0.86]], [[-0.05, 0.97], [0.7, 1.0], [1.45, 0.98]], [[-0.05, 0.56], [0.7, 0.62], [1.45, 0.58]], white, { ns: 16, n: 4 });
  const rn = decal(roofNum, 0.9, 0.45); rn.rotation.x = -Math.PI / 2; add(rn, 0, 1.012, 1.08);
  for (const s of [-1, 1]) {
    // white door panel with the unit number (body side is near flat here)
    const d = decal(door, 1.9, 0.58); d.rotation.y = s * Math.PI / 2; add(d, s * (prof(BW, 0.55) + 0.012), -0.04, 0.55);
    // red pinstripe and dark sill that follow the body taper
    const zs = []; for (let z = -3.9; z <= 3.55; z += 0.25) zs.push(z);
    trim(zs.map(z => [s * (prof(BW, z) * 0.995 + 0.006), Math.min(-0.14, prof(BYT, z) - 0.06), z]), 0.022, red);
    // mirror: small rounded pod
    const mr = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), black); mr.scale.set(1.2, 0.7, 1); add(mr, s * 0.98, 0.5, -0.7);
  }
  // twin white hood stripes laid on the hood surface
  for (const s of [-1, 1]) { const zs = []; for (let z = -3.7; z <= -1.0; z += 0.2) zs.push(z); trim(zs.map(z => [s * 0.3, prof(BYT, z) - 0.01, z]), 0.04, white); }

  // ---- rear spoiler: flat airfoil on two slim posts ----
  const spg = new THREE.CapsuleGeometry(0.18, 1.75, 4, 12); spg.rotateZ(Math.PI / 2);
  const sp = add(new THREE.Mesh(spg, body), 0, 0.74, 3.25); sp.scale.set(1, 0.28, 1.15);
  for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), black), s * 0.75, 0.58, 3.25);

  // ---- roof light bar: red left, blue right, white takedown centre ----
  const lbg = new THREE.CapsuleGeometry(0.15, 1.32, 4, 12); lbg.rotateZ(Math.PI / 2);
  const lbar = add(new THREE.Mesh(lbg, black), 0, 1.06, 0.3); lbar.scale.set(1, 0.6, 1.05);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.26), chrome), 0, 1.0, 0.3);
  const cells = [];
  for (const [x, c] of [[-0.68, 0xff1030], [-0.44, 0xff1030], [-0.2, 0xff1030], [0.2, 0x2050ff], [0.44, 0x2050ff], [0.68, 0x2050ff]]) {
    cells.push(add(new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.11, 0.24), em(c, 5)), x, 1.15, 0.3));
  }
  const take = add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.2), em(0xfff4e0, 2)), 0, 1.14, 0.3);

  // ---- hover pods where the wheels would be: black skirts, cyan rings, downward fans ----
  const fans = [];
  for (const [s, z] of [[-1, -2.6], [1, -2.6], [-1, 2.3], [1, 2.3]]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.7, 6, 12), black); pod.rotation.x = Math.PI / 2; add(pod, s * 0.98, -0.6, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 6, 28), cyan); ring.rotation.x = Math.PI / 2; add(ring, s * 0.98, -0.82, z);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(0.36, 20), blueThr.clone()); fan.rotation.x = Math.PI / 2; add(fan, s * 0.98, -0.84, z); fans.push(fan);
  }

  // ---- tail: full-width red bar, round thruster with a red rim ----
  const tailM = em(0xff2030, 6);
  const tail = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 1.55, 4, 8).rotateZ(Math.PI / 2), tailM), 0, 0.2, 3.67);
  for (const s of [-1, 1]) { const l = add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), tailM), s * 0.7, 0.0, 3.62); l.scale.set(1.4, 0.8, 0.4); }
  add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 8, 28), red), 0, -0.14, 3.69);
  const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 20, 1, true), chrome); noz.rotation.x = Math.PI / 2; add(noz, 0, -0.14, 3.56);
  const core = add(new THREE.Mesh(new THREE.CircleGeometry(0.29, 20), blueThr), 0, -0.14, 3.72);
  // ---- afterburner plume: blue outer cone, white inner core, shock diamonds; grows from the nozzle with boost ----
  const glowM = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const plume = new THREE.Group(); add(plume, 0, -0.14, 3.74);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 3, 14, 1, true), glowM(0x3aa8ff)); flame.rotation.x = Math.PI / 2; flame.position.z = 1.5; plume.add(flame);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.15, 2, 12, 1, true), glowM(0xe6f8ff)); inner.rotation.x = Math.PI / 2; inner.position.z = 1.0; plume.add(inner);
  const diamonds = [0.45, 0.95, 1.45, 1.95].map(z => { const d = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), glowM(0xf4fbff)); d.scale.set(1, 1, 1.7); d.position.z = z; plume.add(d); return d; });

  // ---- nose: slim headlight strip and corner lamps ----
  add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.05), head), 0, -0.17, -4.02);
  for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.06), head), s * 0.9, -0.22, -3.92);

  // ---- fill lights that travel with the car ----
  const fill = new THREE.PointLight(0xff60e0, 26, 12); fill.position.set(-2.4, 2.4, 2.5); g.add(fill);
  const fill2 = new THREE.PointLight(0x50e8ff, 26, 12); fill2.position.set(2.6, 2.0, -1.5); g.add(fill2);
  const top = new THREE.PointLight(0xc8d8ff, 24, 9); top.position.set(0, 3.4, 1.5); g.add(top);

  const lights = { red: cells[0], blue: cells[5], pods: fans, flame, core, tail, beacons: cells };
  let boost = 0;
  return {
    group: g, lights,
    setBank(r) { g.rotation.z = r; },
    setBoost(b) {
      boost = b; plume.visible = b > 0.01; plume.scale.set(0.8 + 0.3 * b, 0.8 + 0.3 * b, 0.4 + 1.1 * b);
      flame.material.opacity = 0.6 * b; inner.material.opacity = 0.85 * b;
      diamonds.forEach((d, i) => { d.material.opacity = b * (1 - i * 0.2); });
      core.material.emissiveIntensity = 5 + 6 * b;
    },
    update(t) {
      // red and blue halves alternate; inside each half the cells chase outward
      const ph = Math.floor(t * 6) % 2, ch = Math.floor(t * 18) % 3;
      cells.forEach((c, i) => { const left = i < 3, k = left ? 2 - i : i - 3; c.material.emissiveIntensity = (left ? !ph : ph) ? (k === ch ? 9 : 5) : 0.5; });
      take.material.emissiveIntensity = Math.floor(t * 3) % 4 === 0 ? 5 : 1.5;
      for (const f of fans) f.material.emissiveIntensity = 4 + Math.sin(t * 40) * 0.6 + boost * 3;
      if (boost > 0.01) diamonds.forEach((d, i) => { const k = 1 + Math.sin(t * 47 + i * 1.7) * 0.18; d.scale.set(k, k, 1.7 * k); });
    },
  };
};
