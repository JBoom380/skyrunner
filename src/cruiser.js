// SKYRUNNER player car: the PATROL hover cruiser (v3, bubble-canopy outrigger design).
// buildCruiser(THREE) -> { group, lights, setBank(rad), setBoost(0..1), update(t) }
// Axes: car faces -Z, +Y up, origin at body centre. Length ~8, width ~2.9.
window.buildCruiser = function (THREE) {
  const g = new THREE.Group();
  const cv = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const add = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); g.add(m); return m; };

  // ---- materials ----
  const paint = new THREE.MeshStandardMaterial({ color: 0x5f8a98, metalness: 0.35, roughness: 0.3 });
  const paintDk = new THREE.MeshStandardMaterial({ color: 0x3a5560, metalness: 0.4, roughness: 0.38 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0b0e10, metalness: 0.3, roughness: 0.7 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe6eef5, metalness: 1, roughness: 0.15 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x15191c, metalness: 0.2, roughness: 0.8 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0d1c26, metalness: 0.1, roughness: 0.03, clearcoat: 1, transparent: true, opacity: 0.82, iridescence: 1, iridescenceIOR: 1.6 });
  const em = (c, i = 3) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.4 });
  const cyan = em(0x40f0ff, 2.5), red = em(0xc21a22, 1.4), white = em(0xfff4e0, 4), blueThr = em(0x3aa8ff, 5), amber = em(0xffa020, 5), blue = em(0x2a70ff, 5);

  // ---- decals ----
  const caution = cv(128, 16, (c, w, h) => { c.fillStyle = '#f2c400'; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; for (let x = -16; x < w; x += 16) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 8, 0); c.lineTo(x + 16, 0); c.lineTo(x + 8, h); c.fill(); } });
  const side = cv(512, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.fillStyle = '#f4f6f8'; c.font = 'bold 54px Arial'; c.textBaseline = 'middle';
    c.fillText('PATROL', 150, 40); c.font = 'bold 60px Arial'; c.fillText('207', 165, 98);
    c.fillStyle = '#d4202a'; c.fillRect(395, 22, 54, 54); c.fillStyle = '#fff'; c.font = 'bold 22px Arial'; c.fillText('巡', 410, 50);
    c.fillStyle = '#f4f6f8'; c.font = 'bold 15px Arial'; c.fillText('UNIT 7  AUTH. B', 12, 112); c.fillText('NO STEP', 12, 20);
  });
  const num = cv(128, 128, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = '#f4f6f8'; c.font = 'bold 96px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('47', 64, 68); });
  const decal = (t, w, h) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }));

  // ---- fuselage: long rounded teardrop ----
  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(0.85, 4.2, 10, 24), paint);
  fus.rotation.x = Math.PI / 2; fus.scale.set(1.3, 1, 0.82); add(fus, 0, 0, 0.4);
  const hump = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 1.6, 8, 20), paint);
  hump.rotation.x = Math.PI / 2 - 0.12; hump.scale.set(1.25, 1, 0.9); add(hump, 0, 0.42, 2.0);
  const tailCap = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 14), paintDk); tailCap.scale.set(1.15, 0.85, 0.7); add(tailCap, 0, 0.25, 3.45);
  const band = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.06, 8, 32), chrome); band.scale.set(1.18, 0.95, 1); add(band, 0, 0.2, 2.3);

  // ---- bubble canopy ----
  const can = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  can.scale.set(0.98, 0.78, 2.05); add(can, 0, 0.42, -0.55);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 6, 40), chrome); rim.rotation.x = Math.PI / 2; rim.scale.set(0.99, 2.06, 1); add(rim, 0, 0.43, -0.55);
  const spine = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 40, Math.PI), black); spine.rotation.y = Math.PI / 2; spine.scale.set(2.05, 0.79, 1); add(spine, 0, 0.42, -0.55);
  for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.35), black), s * 0.38, 0.65, -0.1);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.4), em(0x20e0ff, 1.6)), 0, 0.55, -1.5);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.2), em(0xffa020, 1.4)), 0, 0.58, -1.25);

  // ---- side pods with caution stripes and markings ----
  for (const s of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 3.6, 6, 14), paintDk); pod.rotation.x = Math.PI / 2; pod.scale.set(1.2, 1, 1); add(pod, s * 1.12, -0.38, 0.2);
    const st = decal(caution, 1.4, 0.16); st.rotation.y = s * Math.PI / 2; add(st, s * 1.49, -0.3, -0.4);
    const sd = decal(side, 2.4, 0.6); sd.rotation.y = s * Math.PI / 2; add(sd, s * 1.11, 0.25, 0.9);
    const nm = decal(num, 0.75, 0.75); nm.rotation.y = s * Math.PI / 2; add(nm, s * 1.06, 0.55, 2.55);
    for (const z of [-1.0, 0.0, 1.0]) add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.5), black), s * 1.47, -0.42, z);
  }

  // ---- front outriggers: long booms ending in big wheel pods ----
  const fans = [];
  for (const s of [-1, 1]) {
    const boom = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 2.6, 6, 12), paint); boom.rotation.x = Math.PI / 2; add(boom, s * 1.2, -0.42, -2.6);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.7), paintDk), s * 1.1, -0.38, -1.35);
    const wheel = new THREE.Group(); wheel.position.set(s * 1.25, -0.42, -4.25); g.add(wheel);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.62, 28), paint); drum.rotation.z = Math.PI / 2; wheel.add(drum);
    const tread = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.1, 8, 36), tyre); tread.rotation.y = Math.PI / 2; wheel.add(tread);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.66, 20, 12, 0, Math.PI), paintDk); cap.rotation.y = -s * Math.PI / 2; cap.scale.set(1, 1, 0.45); cap.position.x = s * 0.3; wheel.add(cap);
    const hub = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), cyan); hub.rotation.y = s * Math.PI / 2; hub.position.x = s * 0.6; wheel.add(hub);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 6, 30), em(0xbff8ff, 2)); ring.rotation.y = Math.PI / 2; ring.position.x = s * 0.33; wheel.add(ring);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), blueThr); fan.rotation.x = Math.PI / 2; fan.position.y = -0.33; wheel.add(fan); fans.push(fan);
  }
  // ---- rear wheel pods under the tail ----
  for (const s of [-1, 1]) {
    const rw = new THREE.Group(); rw.position.set(s * 0.95, -0.62, 2.55); g.add(rw);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 24), tyre); drum.rotation.z = Math.PI / 2; rw.add(drum);
    const hub = new THREE.Mesh(new THREE.CircleGeometry(0.24, 16), cyan); hub.rotation.y = s * Math.PI / 2; hub.position.x = s * 0.26; rw.add(hub);
    const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.58, 20, 1, false, 0, Math.PI), paint); fender.rotation.set(0, Math.PI / 2, Math.PI / 2); rw.add(fender);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(0.45, 18), blueThr); fan.rotation.x = Math.PI / 2; fan.position.y = -0.3; rw.add(fan); fans.push(fan);
  }

  // ---- roof beacon rack ----
  add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.42), black), 0, 1.08, 0.95);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.3), chrome), 0, 1.0, 0.95);
  const beacons = [];
  for (const [x, z, m] of [[-0.6, 0.85, amber], [-0.32, 1.05, blue], [-0.05, 0.85, amber], [0.22, 1.05, blue], [0.5, 0.85, amber], [0.64, 1.1, amber]]) {
    beacons.push(add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.clone()), x, 1.15, z));
  }
  const lr = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.18), red.clone()), -0.76, 1.15, 1.05);
  const lb = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.18), blue.clone()), 0.76, 1.15, 1.05);

  // ---- rear lights + main thruster ----
  const tail = add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.06), red), 0, 0.45, 4.1);
  for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.06), red), s * 0.95, 0.15, 3.95);
  add(decal(caution, 1.3, 0.12), 0, -0.05, 4.13);
  const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.4, 16, 1, true), chrome); noz.rotation.x = Math.PI / 2; add(noz, 0, -0.35, 3.85);
  const core = add(new THREE.Mesh(new THREE.CircleGeometry(0.27, 16), blueThr), 0, -0.35, 4.06);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 2.4, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.rotation.x = -Math.PI / 2; add(flame, 0, -0.35, 5.3);

  // ---- headlights ----
  for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.05), white), s * 1.1, -0.32, -1.72);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.05), white), 0, -0.2, -2.2);

  // ---- fill lights that travel with the car ----
  const fill = new THREE.PointLight(0xff60e0, 26, 12); fill.position.set(-2.4, 2.4, 2.5); g.add(fill);
  const fill2 = new THREE.PointLight(0x50e8ff, 26, 12); fill2.position.set(2.6, 2.0, -1.5); g.add(fill2);
  const top = new THREE.PointLight(0xc8d8ff, 24, 9); top.position.set(0, 3.4, 1.5); g.add(top);

  const lights = { red: lr, blue: lb, pods: fans, flame, core, tail, beacons };
  let boost = 0;
  return {
    group: g, lights,
    setBank(r) { g.rotation.z = r; },
    setBoost(b) { boost = b; flame.material.opacity = 0.75 * b; flame.scale.set(1, 0.6 + b, 1); core.material.emissiveIntensity = 5 + 6 * b; },
    update(t) {
      const ph = Math.floor(t * 6);
      lr.material.emissiveIntensity = ph % 2 ? 0.6 : 7; lb.material.emissiveIntensity = ph % 2 ? 7 : 0.6;
      beacons.forEach((b, i) => { b.material.emissiveIntensity = (ph + i) % 3 === 0 ? 1 : 7; });
      for (const f of fans) f.material.emissiveIntensity = 4 + Math.sin(t * 40) * 0.6 + boost * 3;
    },
  };
};
