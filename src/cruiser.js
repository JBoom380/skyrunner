// SKYRUNNER player car: the PATROL 47 spinner (v4, classic wedge police spinner; concept 1, 2026-10-12).
// buildCruiser(THREE) -> { group, lights, setBank(rad), setBoost(0..1), update(t) }
// Axes: car faces -Z, +Y up, origin at body centre. Length ~7.7, width ~2.4.
window.buildCruiser = function (THREE) {
  const g = new THREE.Group();
  const cv = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const add = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); g.add(m); return m; };
  // side profile as [z, y] points, extruded across the car (width w), chamfered edges
  const slab = (pts, w, mat, bevel = 0.06) => {
    const s = new THREE.Shape(); pts.forEach(([z, y], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y)));
    const geo = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 1 });
    geo.translate(0, 0, -w / 2); geo.rotateY(Math.PI / 2); geo.computeVertexNormals();
    return g.add(new THREE.Mesh(geo, mat)), geo;
  };

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

  // ---- wedge body: knife nose, long sloped hood, flat deck, cut-off tail ----
  slab([[-4.0, -0.05], [-4.05, -0.3], [-3.8, -0.55], [3.3, -0.55], [3.6, -0.35], [3.6, 0.38], [2.6, 0.45], [-0.9, 0.38]], 2.3, body);
  // ---- greenhouse: raked screen, flat roof, fastback ----
  slab([[-1.0, 0.36], [-0.05, 0.95], [1.4, 0.95], [2.6, 0.44], [2.6, 0.36]], 1.72, glass, 0.04);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.06, 1.42), white), 0, 0.98, 0.68);
  const rn = decal(roofNum, 1.0, 0.5); rn.rotation.x = -Math.PI / 2; add(rn, 0, 1.015, 1.12);
  for (const s of [-1, 1]) {
    // B-pillar and white door panel with the unit number
    const bp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.22), white); bp.rotation.x = -0.15; add(bp, s * 0.86, 0.66, 0.7);
    const d = decal(door, 2.0, 0.62); d.rotation.y = s * Math.PI / 2; add(d, s * 1.215, -0.02, 0.55);
    // low red pinstripe nose to tail, black sill
    add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 7.4), red), s * 1.22, -0.13, -0.2);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 7.0), black), s * 1.2, -0.5, -0.2);
    // mirror
    add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.16), black), s * 1.0, 0.5, -0.75);
  }
  // twin white hood stripes along the slope
  for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 3.0), white); st.rotation.x = -0.135; add(st, s * 0.32, 0.19, -2.4); }
  // hood vents
  for (const z of [-1.6, -1.35]) add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.08), black), 0, 0.33, z);

  // ---- rear spoiler ----
  add(new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.06, 0.42), body), 0, 0.72, 3.3);
  for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.2), black), s * 0.75, 0.56, 3.3);

  // ---- roof light bar: red left, blue right, white takedown centre ----
  add(new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.1, 0.32), black), 0, 1.06, 0.3);
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
  const tail = add(new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.05), tailM), 0, 0.24, 3.69);
  for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.05), tailM), s * 0.86, 0.04, 3.69);
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
