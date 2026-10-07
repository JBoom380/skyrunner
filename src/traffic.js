// SKYRUNNER traffic: flying hover cars in lanes, cargo haulers, ad/police blimps, near misses, siren clear.
// NR.traffic = { init, update, reset, collide(box) -> {hit, kind, normal}, clearAhead(dist), cars, stats() }
// Lane-changers (round 2): same-direction cars that cut one lane near the player after ~1 s of amber blinker;
// share and count rise with core.difficulty. Emits `laneChange` {phase:'warn'|'swerve', pos, side, type}.
// Four original car designs (WEDGE sedan, CAB van, DART twin-hull coupe, HAULER freighter) are merged
// low-poly meshes drawn with InstancedMesh (2 draw calls per design). All head/tail light glows are one
// additive Points draw call. Cars and glow slots are pooled; the update allocates nothing per frame.
(function () {
  window.NR = window.NR || {};
  const C = NR.cfg || {};
  const RECYCLE_Z = C.RECYCLE_Z || 40, SPAWN_Z = C.SPAWN_Z || -1400, NEAR = C.NEAR_MISS_DIST || 3.2;
  const LANES_X = [-13.5, -4.5, 4.5, 13.5];
  const BAND_SAME = [1.5, 11], BAND_ONC = [-3.5, 21.5], BAND_HAUL = [-2, 7];
  const PAINT = [0x46525a, 0x5a3530, 0x34505a, 0x5a4e38, 0x40424c, 0x63473a, 0x2e444c];
  const TAXI_PAINT = [0x8a5e26, 0x74582e];
  const BLIMP_WORDS = [['OMNI', '#d9a050'], ['夢', '#c9584a'], ['NEXA', '#7ab3b8'], ['KIRA', '#d9a050'], ['ネオン', '#7ab3b8']];

  let THREE, core, scene, built = false;
  const T = {};          // type name -> {def, body, emi, pool[], n}
  const cars = [];       // active car records
  let glow, gPos, gCol, gSize, gN = 0, GMAX = 0;
  const blimps = [];
  let rand = Math.random;
  let spawnCool = 0;

  // scratch objects (no per-frame allocation)
  const _m = new Float32Array(16), _p = { x: 0, y: 0, z: 0 };
  let _q, _e, _s, _v, _mat, _col, _v2;
  let MISS, HIT, PBOX;

  // ---------- geometry helpers ----------
  function shapeBox(w, h, l, o) { // box with per-corner tapers: o.ft drop front-top, o.fb raise front-bottom, o.fw front width scale, o.bt drop back-top, o.tw top width scale, o.bw back width scale
    const g = new THREE.BoxGeometry(w, h, l); o = o || {};
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i); const z = p.getZ(i);
      const front = z < 0, top = y > 0;
      if (front && top && o.ft) y -= o.ft;
      if (front && !top && o.fb) y += o.fb;
      if (!front && top && o.bt) y -= o.bt;
      if (front && o.fw) x *= o.fw;
      if (!front && o.bw) x *= o.bw;
      if (top && o.tw) x *= o.tw;
      p.setXY(i, x, y);
    }
    g.computeVertexNormals();
    return g;
  }
  function P(list, geo, color, x, y, z, rx, ry, rz) {
    geo = geo.index ? geo.toNonIndexed() : geo;
    if (rx || ry || rz) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)));
    geo.translate(x || 0, y || 0, z || 0);
    const n = geo.attributes.position.count, c = new Float32Array(n * 3), col = new THREE.Color(color);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    list.push(geo);
  }
  function merge(list) {
    let n = 0; for (const g of list) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const g of list) {
      if (!g.attributes.normal) g.computeVertexNormals();
      pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); col.set(g.attributes.color.array, o);
      o += g.attributes.position.count * 3; g.dispose();
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    m.setAttribute('color', new THREE.BufferAttribute(col, 3));
    m.computeBoundingSphere();
    return m;
  }
  const cyl = (r, l, s) => new THREE.CylinderGeometry(r, r, l, s || 8);   // along Y; rotate PI/2 on X to lie along Z
  const PAINTW = 0xffffff, GLASS = 0x1c2a36, TRIM = 0x111417, METAL = 0x8a949c;
  const RED = 0xff3324, RED2 = 0xc8402c, WHITE = 0xfff2dc, AMBER = 0xffa53a, TEAL = 0x6fc4cc, WARM = 0x9a6a3a;

  // ---------- the four original car designs (car faces -Z, origin at body centre) ----------
  function buildWedge() { // low wedge sedan, twin swept fins, four pod thrusters
    const b = [], e = [];
    P(b, shapeBox(3.0, 0.9, 6.8, { ft: 0.62, fb: 0.15, fw: 0.62, bw: 0.96 }), PAINTW, 0, 0, 0);
    P(b, shapeBox(2.1, 0.7, 2.9, { ft: 0.55, bt: 0.22, tw: 0.8 }), GLASS, 0, 0.78, 0.35);
    for (const s of [-1, 1]) {
      P(b, shapeBox(0.14, 1.1, 1.5, { ft: 0.9 }), PAINTW, s * 1.05, 0.95, 2.55);
      for (const z of [-2.1, 2.0]) {
        P(b, cyl(0.34, 1.4, 8), TRIM, s * 1.22, -0.72, z, Math.PI / 2);
        P(b, cyl(0.07, 0.4, 4), METAL, s * 1.1, -0.4, z);
        P(e, new THREE.CircleGeometry(0.28, 8), TEAL, s * 1.22, -1.07, z, Math.PI / 2);
      }
      P(e, new THREE.BoxGeometry(0.06, 0.16, 5.8), AMBER, s * 1.51, 0.08, 0.2);
      P(e, new THREE.BoxGeometry(0.95, 0.34, 0.06), RED, s * 0.8, 0.12, 3.42);
      P(e, new THREE.BoxGeometry(0.5, 0.07, 0.06), WHITE, s * 0.55, -0.22, -3.42);
    }
    P(e, new THREE.BoxGeometry(0.5, 0.08, 0.06), RED2, 0, 0.3, 3.42);
    return { body: merge(b), emi: merge(e), half: [1.55, 0.95, 3.4], cy: 0.15,
      rear: [[-0.8, 0.12, 3.6, 2.6], [0.8, 0.12, 3.6, 2.6]], front: [[-0.55, -0.22, -3.6, 3.2], [0.55, -0.22, -3.6, 3.2]], top: [0, 1.5, 0.4, 1.6] };
  }
  function buildCab() { // tall rounded city cab van, roof sign box, stub wings with thruster rings
    const b = [], e = [];
    P(b, shapeBox(2.9, 1.5, 6.0, { ft: 0.2, fb: 0.25, fw: 0.92 }), PAINTW, 0, -0.1, 0);
    P(b, shapeBox(2.7, 1.0, 4.7, { ft: 0.55, tw: 0.86 }), PAINTW, 0, 1.15, 0.45);
    for (const s of [-1, 1]) {
      P(e, new THREE.BoxGeometry(0.05, 0.42, 3.4), WARM, s * 1.33, 1.12, 0.75);           // lit cabin windows
      P(e, new THREE.BoxGeometry(0.06, 0.16, 5.4), RED2, s * 1.46, -0.1, 0.0);            // side strip
      P(b, new THREE.BoxGeometry(1.5, 0.14, 1.1), PAINTW, s * 2.15, 0.35, 1.9);            // stub wing
      P(b, new THREE.TorusGeometry(0.5, 0.11, 5, 10), TRIM, s * 2.85, 0.35, 1.9);
      P(e, new THREE.CircleGeometry(0.4, 10), TEAL, s * 2.85, 0.35, 1.95);
      P(e, new THREE.BoxGeometry(0.22, 0.9, 0.06), RED, s * 1.25, 0.3, 3.02);
      P(e, new THREE.BoxGeometry(0.42, 0.3, 0.06), WHITE, s * 0.95, -0.25, -3.0);
      P(b, cyl(0.35, 1.0, 8), TRIM, s * 0.95, -1.0, -1.8);
      P(b, cyl(0.35, 1.0, 8), TRIM, s * 0.95, -1.0, 1.9);
    }
    P(b, new THREE.BoxGeometry(2.4, 0.5, 0.1), GLASS, 0, 1.0, -2.08, -0.5);               // windscreen
    P(b, new THREE.BoxGeometry(1.7, 0.5, 0.9), TRIM, 0, 1.85, 0.2);
    P(e, new THREE.BoxGeometry(1.5, 0.36, 0.95), AMBER, 0, 1.87, 0.2);                    // roof sign
    return { body: merge(b), emi: merge(e), half: [1.6, 1.3, 3.05], cy: 0.35,
      rear: [[-1.25, 0.3, 3.2, 2.6], [1.25, 0.3, 3.2, 2.6]], front: [[-0.95, -0.25, -3.2, 3.0], [0.95, -0.25, -3.2, 3.0]], top: [0, 2.3, 0.2, 2.2] };
  }
  function buildDart() { // narrow needle cockpit on twin pontoon hulls, tall tail fin, big round rear thrusters
    const b = [], e = [];
    P(b, shapeBox(1.5, 0.85, 7.0, { ft: 0.6, fw: 0.3, fb: 0.15 }), PAINTW, 0, 0.25, -0.2);
    P(b, shapeBox(1.1, 0.55, 2.3, { ft: 0.45, bt: 0.3, tw: 0.7 }), GLASS, 0, 0.85, 0.2);
    P(b, shapeBox(0.16, 1.7, 2.0, { ft: 1.35 }), PAINTW, 0, 1.3, 2.4);
    for (const s of [-1, 1]) {
      P(b, shapeBox(0.75, 0.5, 7.6, { ft: 0.3, fw: 0.4, fb: 0.1 }), PAINTW, s * 1.55, -0.6, 0.1);
      P(b, new THREE.BoxGeometry(1.0, 0.16, 0.6), TRIM, s * 0.85, -0.25, -1.6);
      P(b, new THREE.BoxGeometry(1.0, 0.16, 0.6), TRIM, s * 0.85, -0.25, 1.9);
      P(b, cyl(0.42, 0.7, 10), TRIM, s * 1.55, -0.5, 3.75, Math.PI / 2);
      P(e, new THREE.CircleGeometry(0.33, 10), RED, s * 1.55, -0.5, 4.11);
      P(e, new THREE.BoxGeometry(0.06, 0.15, 4.2), AMBER, s * 1.94, -0.52, -0.6);
      P(e, new THREE.BoxGeometry(0.3, 0.1, 0.06), WHITE, s * 1.55, -0.55, -3.92);
    }
    P(e, new THREE.BoxGeometry(0.06, 0.07, 3.0), AMBER, 0, 0.42, -2.4);
    return { body: merge(b), emi: merge(e), half: [1.95, 0.9, 3.9], cy: 0.1,
      rear: [[-1.55, -0.5, 4.3, 3.0], [1.55, -0.5, 4.3, 3.0]], front: [[-1.55, -0.55, -4.1, 2.6], [1.55, -0.55, -4.1, 2.6]], top: [0, 2.3, 2.6, 1.4] };
  }
  function buildHauler() { // long slow freighter: cab, ribbed container, belly fans, marker light rows, caution band
    const b = [], e = [];
    P(b, shapeBox(3.6, 3.0, 3.6, { ft: 0.9, fw: 0.9 }), PAINTW, 0, -0.2, -7.0);
    P(b, new THREE.BoxGeometry(3.0, 0.8, 0.1), GLASS, 0, 0.55, -8.62, -0.45);
    P(b, new THREE.BoxGeometry(4.2, 3.9, 13.6), PAINTW, 0, 0.25, 1.9);
    for (let z = -4; z <= 8; z += 2.0) P(b, new THREE.BoxGeometry(4.36, 3.7, 0.22), TRIM, 0, 0.25, z);
    P(b, new THREE.BoxGeometry(3.0, 0.5, 15.5), TRIM, 0, -1.95, 0.6);
    for (const s of [-1, 1]) {
      for (const z of [-5.6, -0.5, 4.8]) {
        P(b, cyl(1.0, 0.6, 10), TRIM, s * 1.25, -2.4, z);
        P(e, new THREE.CircleGeometry(0.85, 10), TEAL, s * 1.25, -2.72, z, Math.PI / 2);
      }
      for (let z = -4.2; z <= 8.4; z += 1.4) P(e, new THREE.BoxGeometry(0.06, 0.18, 0.4), AMBER, s * 2.2, -1.55, z);
      for (let z = -4.2; z <= 8.4; z += 2.8) P(e, new THREE.BoxGeometry(0.06, 0.18, 0.4), AMBER, s * 2.2, 2.05, z);
      P(e, new THREE.BoxGeometry(0.5, 0.36, 0.06), WHITE, s * 1.25, -1.1, -8.82);
      P(e, new THREE.BoxGeometry(0.4, 1.4, 0.06), RED, s * 1.85, 0.0, 8.73);
    }
    for (let i = 0; i < 5; i++) P(e, new THREE.BoxGeometry(0.36, 0.14, 0.2), AMBER, -1.2 + i * 0.6, 1.36, -7.6);
    for (let i = 0; i < 6; i++) P(e, new THREE.BoxGeometry(0.42, 0.3, 0.06), i % 2 ? TRIM : AMBER, -1.3 + i * 0.52, -1.25, 8.73);
    return { body: merge(b), emi: merge(e), half: [2.3, 2.3, 8.9], cy: 0.0,
      rear: [[-1.85, 0.0, 9.0, 3.4], [1.85, 0.0, 9.0, 3.4]], front: [[-1.25, -1.1, -9.0, 3.6], [1.25, -1.1, -9.0, 3.6]], top: [0, 2.6, -7.3, 2.0],
      beacons: [[-2.0, 2.4, 8.6], [2.0, 2.4, 8.6], [-2.0, 2.4, -4.8], [2.0, 2.4, -4.8]] };
  }

  // ---------- glow points (one additive draw call for every light halo) ----------
  function buildGlow() {
    GMAX = 400;
    gPos = new Float32Array(GMAX * 3); gCol = new Float32Array(GMAX * 3); gSize = new Float32Array(GMAX);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(gPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(gCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(gSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uH: { value: 640 }, uFog: { value: 0.002 } },
      vertexShader: `attribute float size; attribute vec3 color; uniform float uH; uniform float uFog; varying vec3 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); float d = -mv.z;
          float f = uFog * d * 0.55; vC = color * exp(-f*f);
          gl_PointSize = clamp(size * projectionMatrix[1][1] * uH * 0.5 / max(d, 0.5), 1.5, 90.0);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
          float a = (1.0 - d); a = a * a * 0.55 + smoothstep(0.38, 0.0, d) * 0.9; gl_FragColor = vec4(vC * a, 1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    glow = new THREE.Points(g, mat); glow.frustumCulled = false; glow.renderOrder = 5;
    scene.add(glow);
  }
  function G(x, y, z, hex, size, k) {
    if (gN >= GMAX) return;
    const i = gN++;
    gPos[i * 3] = x; gPos[i * 3 + 1] = y; gPos[i * 3 + 2] = z;
    _col.setHex(hex);
    gCol[i * 3] = _col.r * k; gCol[i * 3 + 1] = _col.g * k; gCol[i * 3 + 2] = _col.b * k;
    gSize[i] = size;
  }

  // ---------- blimps (scenery high above the corridor) ----------
  function adTex(word, col, police) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 40; const g = c.getContext('2d');
    g.fillStyle = '#07080a'; g.fillRect(0, 0, 128, 40);
    g.fillStyle = col; g.globalAlpha = 0.25; g.fillRect(3, 3, 122, 34); g.globalAlpha = 1;
    g.strokeStyle = col; g.lineWidth = 2; g.strokeRect(2, 2, 124, 36);
    g.font = 'bold 26px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(word, 64, 21);
    if (police) { g.fillStyle = '#c9584a'; g.fillRect(6, 6, 14, 28); g.fillStyle = '#7ab3b8'; g.fillRect(108, 6, 14, 28); }
    g.fillStyle = 'rgba(0,0,0,0.35)'; for (let y = 0; y < 40; y += 3) g.fillRect(0, y, 128, 1);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter;
    return t;
  }
  function buildBlimps() {
    const bodyGeo = new THREE.SphereGeometry(1, 14, 9); bodyGeo.scale(7.5, 6.5, 26);
    const finGeo = [];
    P(finGeo, shapeBox(0.4, 6, 5, { ft: 4 }), 0xffffff, 0, 5, 22);
    P(finGeo, shapeBox(0.4, 6, 5, { ft: 4 }), 0xffffff, 0, -5, 22, 0, 0, Math.PI);
    P(finGeo, shapeBox(11, 0.4, 4, {}), 0xffffff, 0, 0, 23);
    P(finGeo, new THREE.BoxGeometry(3.2, 2.2, 7), 0x777777, 0, -7.2, 0);
    const finM = merge(finGeo);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a3036, metalness: 0.5, roughness: 0.45 });
    const finMat = new THREE.MeshStandardMaterial({ color: 0x23282c, metalness: 0.4, roughness: 0.5, vertexColors: true });
    const stripGeo = []; for (const s of [-1, 1]) { P(stripGeo, new THREE.BoxGeometry(0.2, 0.5, 9), RED2, s * 7.0, 1.6, -15); P(stripGeo, new THREE.BoxGeometry(0.2, 0.5, 9), RED2, s * 7.0, 1.6, 15); }
    P(stripGeo, new THREE.BoxGeometry(2.0, 0.6, 0.1), AMBER, 0, -7.2, -3.55);
    const stripM = merge(stripGeo), stripMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const beamGeo = new THREE.ConeGeometry(9, 90, 12, 1, true); beamGeo.translate(0, -45, 0);
    for (let i = 0; i < 3; i++) {
      const police = i === 0, w = police ? ['PATROL', '#d8e0e8'] : BLIMP_WORDS[(i * 2 + 1) % BLIMP_WORDS.length];
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, bodyMat));
      g.add(new THREE.Mesh(finM, finMat));
      g.add(new THREE.Mesh(stripM, stripMat));
      const tex = adTex(w[0], w[1], police);
      const pmat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(26, 8), pmat); g.add(panel);
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xf0d8a8, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      beam.position.set(0, -8, -14); g.add(beam);
      scene.add(g);
      blimps.push({ g, panel, pmat, beam, police, x: 0, y: 0, z: 0, ph: i * 2.1 });
      placeBlimp(blimps[i], -200 - i * 380);
    }
  }
  function placeBlimp(b, z) {
    const side = rand() < 0.5 ? -1 : 1;
    b.x = side * (48 + rand() * 30); b.y = 62 + rand() * 30; b.z = z;
    b.panel.position.set(-side * 7.7, 0.5, 0); b.panel.rotation.y = -side * Math.PI / 2;
    b.g.position.set(b.x, b.y, b.z); b.g.rotation.y = side * 0.12;
  }

  // ---------- pools ----------
  function makeType(name, def, poolSize) {
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.32, envMapIntensity: 1.5 });
    bodyMat.onBeforeCompile = (sh) => { // fresnel rim: cold teal from above, sodium amber from below, so dark paint reads as a silhouette
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
        `{ vec3 vd = normalize(-vViewPosition); float fr = pow(1.0 - clamp(dot(normal, vd), 0.0, 1.0), 3.0);
           float up = normal.y * 0.5 + 0.5; outgoingLight += fr * mix(vec3(0.40, 0.22, 0.07), vec3(0.20, 0.38, 0.42), smoothstep(0.3, 0.7, up)) * 0.6; }
         #include <opaque_fragment>`);
    };
    const emiMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const body = new THREE.InstancedMesh(def.body, bodyMat, poolSize), emi = new THREE.InstancedMesh(def.emi, emiMat, poolSize);
    for (const m of [body, emi]) { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, _col.setRGB(1, 1, 1)); m.instanceColor.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
    const pool = [];
    for (let i = 0; i < poolSize; i++) pool.push({ type: name, def, active: false, dir: 1, x: 0, y: 0, z: 0, tx: 0, ty: 0, y0: 0, x0: 0, speed: 0, ph: 0, paint: 0,
      minGap: 1e9, tracked: false, done: false, hit: false, clear: -1, side: 1, roll: 0, vx: 0, spin: 0, laneT: 0, blink: 0, pos: null,
      lc: 0, lcT: 0, lcFrom: 0, lcTo: 0, lcSlack: 0, lcDur: 0.8, lcPos: null });
    T[name] = { def, body, emi, pool, n: 0 };
  }
  function freeCar(type) { for (const c of T[type].pool) if (!c.active) return c; return null; }

  function diff() { // core.difficulty (0 at start, 1 after three districts, +0.35 per cycle); older cores fall back to distance
    if (!core || core.state !== 'PLAY') return 0;
    if (typeof core.difficulty === 'number') return Math.max(0, core.difficulty);
    return Math.min(1, (core.dist || 0) / 8400) + (core.loop || 0) * 0.35;
  }
  function level() { return Math.min(2.6, diff() * 1.5); }
  function desired() {
    if (!core || core.state === 'TITLE') return 10;
    return Math.min(42, 12 + Math.floor(level() * 11));
  }
  // lane-changers: chance a same-direction car cuts across a lane near the player; how many may do it at once
  function lcChance() { const d = diff(); return d <= 0 ? 0.06 : Math.min(0.55, 0.08 + 0.26 * d); }
  function lcMax() { return 1 + Math.min(2, Math.floor(diff() * 1.3)); }
  const LC_BLINK = 1.05, LC_EVT = { phase: '', pos: null, side: 0, type: '' };
  let lcActive = 0, lcCount = 0, lcAborts = 0;

  function spawn(zOverride) {
    const L = level(), title = !core || core.state !== 'PLAY';
    let type, dir = 1;
    const r = rand();
    if (r < 0.1 + 0.03 * L) type = 'hauler';
    else {
      dir = rand() < (title ? 0.3 : 0.32 + 0.08 * Math.min(L, 2)) ? -1 : 1;
      const k = rand(); type = k < 0.42 ? 'wedge' : k < 0.72 ? 'cab' : 'dart';
    }
    if (zOverride !== undefined && dir < 0) dir = 1; // prefill only same-direction cars close by
    const c = freeCar(type); if (!c) return false;
    const bands = type === 'hauler' ? BAND_HAUL : dir > 0 ? BAND_SAME : BAND_ONC;
    for (let a = 0; a < 5; a++) {
      const lane = (rand() * 4) | 0, x = LANES_X[lane] + (rand() - 0.5) * 1.6, y = bands[(rand() * bands.length) | 0] + (rand() - 0.5) * 3;
      const z = zOverride !== undefined ? zOverride : Math.max(SPAWN_Z, dir > 0 ? -620 - rand() * 380 : -950 - rand() * 400);
      const hl = c.def.half[2];
      let slab = 0, ok = true;
      for (const o of cars) {
        const dz = Math.abs(o.z - z);
        if (dz < 26 + hl + o.def.half[2]) slab++;
        if (dz < 40 + hl + o.def.half[2] && Math.abs(o.x - x) < 6 && Math.abs(o.y - y) < 6) { ok = false; break; }
      }
      if (!ok || slab >= 5) continue;
      c.active = true; c.dir = dir; c.x = c.tx = c.x0 = x; c.y = c.ty = c.y0 = y; c.z = z;
      const sp = title ? 8 + rand() * 14 : 14 + rand() * 26;
      c.speed = type === 'hauler' ? (title ? 6 : 12) + rand() * 10 : dir > 0 ? sp : (title ? 18 : 34 + 16 * Math.min(L, 2)) + rand() * 22;
      c.ph = rand() * 6.28; c.paint = type === 'cab' && rand() < 0.6 ? -1 - ((rand() * TAXI_PAINT.length) | 0) : (rand() * PAINT.length) | 0;
      c.minGap = 1e9; c.tracked = false; c.done = false; c.hit = false; c.clear = -1; c.roll = 0; c.vx = 0; c.spin = 0;
      c.laneT = 2 + rand() * 6; c.blink = 0;
      c.lc = (!title && type !== 'hauler' && dir > 0 && rand() < lcChance()) ? 1 : 0; c.lcT = 0; c.lcFrom = x; c.lcTo = x; c.lcSlack = 0.15 + rand() * 0.55;
      cars.push(c);
      return true;
    }
    return false;
  }
  function kill(i) { const c = cars[i]; c.active = false; cars[i] = cars[cars.length - 1]; cars.length--; }

  // A planned lane-changer starts its blinker when the player will reach it in LC_BLINK + cut time + slack seconds,
  // so the blinker always shows ~1 s before the car moves and the cut ends before the car is beside the player.
  function laneFree(car, x) {
    for (let j = 0; j < cars.length; j++) {
      const o = cars[j]; if (o === car || o.clear >= 0) continue;
      if (Math.abs(o.z - car.z) < 18 + o.def.half[2] + car.def.half[2] && Math.abs(o.x - x) < 5.5 && Math.abs(o.y - car.y) < 4.5) return false;
      if ((o.lc === 2 || o.lc === 3) && Math.abs(o.lcTo - x) < 5.5 && Math.abs(o.z - car.z) < 60 && Math.abs(o.y - car.y) < 4.5) return false;
    }
    return true;
  }
  function planCut(car, vPlayer, pcx) {
    const vrel = vPlayer - car.speed; if (vrel < 8) return;
    const d = diff(), dur = 0.85 - 0.1 * Math.min(2, d) * 0.5;
    const ttc = (-car.z - car.def.half[2] - 4) / vrel;
    if (car.z > -25 || ttc < LC_BLINK + dur * 0.6) { car.lc = 0; return; }   // too late to warn fairly: cancel
    if (ttc > LC_BLINK + dur + car.lcSlack || lcActive >= lcMax() || car.hit || car.clear >= 0) return;
    let li = 0, best = 1e9; for (let l = 0; l < 4; l++) { const q = Math.abs(LANES_X[l] - car.x); if (q < best) { best = q; li = l; } }
    // first choice: toward the player's side when the run gets harder, else a coin flip
    let s = rand() < 0.5 ? -1 : 1;
    if (Math.abs(pcx - car.x) > 2 && rand() < 0.3 + 0.25 * Math.min(1, d)) s = pcx > car.x ? 1 : -1;
    for (let a = 0; a < 2; a++, s = -s) {
      const nl = li + s; if (nl < 0 || nl > 3) continue;
      const to = LANES_X[nl] + (rand() - 0.5) * 1.2;
      if (!laneFree(car, to)) continue;
      car.lc = 2; car.lcT = 0; car.lcFrom = car.x; car.lcTo = to; car.lcDur = dur; car.tx = to; car.blink = LC_BLINK + dur;
      lcActive++; lcCount++; lcEmit(car, 'warn');
      return;
    }
    car.lc = 0; lcAborts++;
  }
  function lcEmit(car, phase) {
    if (!NR.bus) return;
    if (!car.lcPos) car.lcPos = new THREE.Vector3();
    car.lcPos.set(car.x, car.y + car.def.cy, car.z);
    LC_EVT.phase = phase; LC_EVT.pos = car.lcPos; LC_EVT.side = car.lcTo > car.lcFrom ? 1 : -1; LC_EVT.type = car.type;
    NR.bus.emit('laneChange', LC_EVT);
  }

  function playerBox() {
    const p = NR.player;
    if (p && typeof p.box === 'function') { try { const b = p.box(); if (b && b.min && b.max) return b; } catch (e) { /* fall through */ } }
    const pos = p && p.pos ? p.pos : null;
    PBOX.min.set((pos ? pos.x : 0) - 1.3, (pos ? pos.y : 0) - 0.7, (pos ? pos.z : 0) - 3.75);
    PBOX.max.set((pos ? pos.x : 0) + 1.3, (pos ? pos.y : 0) + 0.7, (pos ? pos.z : 0) + 3.75);
    return PBOX;
  }

  // ---------- module ----------
  const traffic = NR.traffic = {
    cars,
    init(c) {
      core = c; THREE = c.THREE || window.THREE; scene = c.scene;
      _q = new THREE.Quaternion(); _e = new THREE.Euler(); _s = new THREE.Vector3(1, 1, 1); _v = new THREE.Vector3();
      _mat = new THREE.Matrix4(); _col = new THREE.Color(); _v2 = new THREE.Vector2();
      MISS = { hit: false, kind: '', normal: new THREE.Vector3() };
      HIT = { hit: true, kind: 'car', normal: new THREE.Vector3(), car: null };
      PBOX = { min: new THREE.Vector3(), max: new THREE.Vector3() };
      rand = NR.rng ? NR.rng(4747) : Math.random;
      makeType('wedge', buildWedge(), 18);
      makeType('cab', buildCab(), 14);
      makeType('dart', buildDart(), 14);
      makeType('hauler', buildHauler(), 6);
      buildGlow();
      buildBlimps();
      built = true;
      for (let i = 0; i < 8; i++) spawn(-140 - i * 70);
    },
    reset(c) {
      core = c || core; if (!built) return;
      for (let i = cars.length - 1; i >= 0; i--) kill(i);
      spawnCool = 0; lcCount = 0; lcAborts = 0;
      for (let i = 0; i < 9; i++) spawn(-170 - i * 62 - rand() * 20);
    },
    update(dt, c) {
      core = c || core; if (!built) return;
      const scroll = core.scroll || 0, time = core.time || 0, play = core.state === 'PLAY';
      const pb = playerBox();
      const pcx = (pb.min.x + pb.max.x) * 0.5, pcy = (pb.min.y + pb.max.y) * 0.5;
      const phx = (pb.max.x - pb.min.x) * 0.5, phy = (pb.max.y - pb.min.y) * 0.5;

      // spawn toward the target density (a few per frame at most)
      spawnCool -= dt;
      if (dt > 0 && spawnCool <= 0 && cars.length < desired()) { if (spawn()) spawnCool = 0.05; else spawnCool = 0.15; }

      // lane-cut bookkeeping: count cuts in progress; the player's closing speed decides when a planned cut starts
      lcActive = 0;
      for (let i = 0; i < cars.length; i++) { const c = cars[i]; if ((c.lc === 2 || c.lc === 3) && !c.hit && c.clear < 0) lcActive++; }
      const vPlayer = dt > 0 ? scroll / dt : 0;

      for (let i = cars.length - 1; i >= 0; i--) {
        const car = cars[i], h = car.def.half;
        if (car.lc === 1 && play && dt > 0) planCut(car, vPlayer, pcx);
        // lateral motion: siren clear, knock-away after a hit, a lane cut near the player, or a slow lane change far ahead
        if (car.clear >= 0 || car.hit) { if (car.lc === 2 || car.lc === 3) car.lc = 4; }
        if (car.clear >= 0) {
          car.clear += dt; const k = Math.min(1, car.clear / 1.0), e = k * k * (3 - 2 * k);
          car.x = car.x0 + (car.side * 48 - car.x0) * e; car.y = car.y0 + 9 * e; car.roll = -car.side * car.dir * 0.7 * Math.sin(Math.PI * Math.min(1, k * 1.4));
        } else if (car.hit) {
          car.x += car.vx * dt; car.vx *= Math.exp(-dt * 0.6); car.spin += dt * 2.5; car.roll = Math.sin(car.spin * 3) * 0.5; car.y -= dt * 3;
        } else if (car.lc === 2) { // blinker on, holding the lane; a slight lean toward the new lane
          car.lcT += dt; const s = car.lcTo > car.lcFrom ? 1 : -1;
          car.roll = -s * car.dir * 0.06 * Math.min(1, car.lcT * 3);
          if (car.lcT >= LC_BLINK) { car.lc = 3; car.lcT = 0; lcEmit(car, 'swerve'); }
        } else if (car.lc === 3) { // the cut: eased slide of one lane with a bank
          car.lcT += dt; const k = Math.min(1, car.lcT / car.lcDur), e = k * k * (3 - 2 * k), s = car.lcTo > car.lcFrom ? 1 : -1;
          car.x = car.lcFrom + (car.lcTo - car.lcFrom) * e;
          car.roll = -s * car.dir * (0.06 + 0.32 * Math.sin(Math.PI * k));
          if (k >= 1) { car.lc = 4; car.tx = car.x; car.blink = 0; }
        } else if (car.type !== 'hauler') {
          car.laneT -= dt;
          if (car.laneT <= 0 && car.z < -260 && car.z > -700) {
            car.laneT = 4 + rand() * 6;
            let li = 0, best = 1e9; for (let l = 0; l < 4; l++) { const d = Math.abs(LANES_X[l] - car.x); if (d < best) { best = d; li = l; } }
            const nl = li + (rand() < 0.5 ? -1 : 1);
            if (nl >= 0 && nl < 4) { car.tx = LANES_X[nl] + (rand() - 0.5) * 1.6; car.blink = 1.6; }
          }
          const dx = car.tx - car.x; car.x += dx * Math.min(1, dt * 0.9);
          car.roll = -dx * 0.05 * car.dir;
        }
        if (car.blink > 0) car.blink -= dt;
        car.z += scroll + (car.dir > 0 ? -car.speed : car.speed) * dt;

        // near miss: track the closest XY gap while the car overlaps the player in Z, report once when it is behind
        if (play && !car.done) {
          const zMin = car.z - h[2], zMax = car.z + h[2];
          if (zMax > pb.min.z - 1 && zMin < pb.max.z + 1) {
            car.tracked = true;
            const cy = car.y + car.def.cy;
            const gx = Math.max(0, Math.abs(car.x - pcx) - h[0] - phx), gy = Math.max(0, Math.abs(cy - pcy) - h[1] - phy);
            const gap = Math.sqrt(gx * gx + gy * gy); if (gap < car.minGap) car.minGap = gap;
          } else if (car.tracked && zMin >= pb.max.z + 1) {
            car.done = true;
            if (!car.hit && car.clear < 0 && car.minGap < NEAR && NR.bus) {
              const pos = new THREE.Vector3(car.x, car.y + car.def.cy, car.z);
              NR.bus.emit('nearMiss', { pos, dist: car.minGap, kind: car.type });
            }
          }
        }
        if (car.z - h[2] > RECYCLE_Z || car.z < SPAWN_Z - 400 || Math.abs(car.x) > 70) kill(i);
      }

      // write instances + glows
      for (const k in T) T[k].n = 0;
      gN = 0;
      const dist = NR.DISTRICTS && NR.DISTRICTS[core.district || 0];
      const accent = dist ? dist.accent : [0xc9584a, 0x4f9aa6, 0xd9953f, 0x9a6a7e];
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i], t = T[car.type], d = car.def, n = t.n++;
        const bob = Math.sin(time * 1.4 + car.ph) * 0.22, y = car.y + bob;
        _e.set(Math.sin(time * 0.9 + car.ph) * 0.02, car.dir > 0 ? 0 : Math.PI, car.roll + Math.sin(time * 1.1 + car.ph) * 0.03);
        _q.setFromEuler(_e); _v.set(car.x, y, car.z);
        _mat.compose(_v, _q, _s);
        t.body.setMatrixAt(n, _mat); t.emi.setMatrixAt(n, _mat);
        _col.setHex(car.paint < 0 ? TAXI_PAINT[-1 - car.paint] : PAINT[car.paint]);
        _col.multiplyScalar(1.6);
        t.body.setColorAt(n, _col);
        let li = 1;
        if (car.hit) li = (Math.floor(time * 14) & 1) ? 0.25 : 1.4;
        const cutting = car.lc === 2 || car.lc === 3, blinkOn = cutting && (Math.floor(car.lcT * 6 + (car.lc === 3 ? 0.5 : 0)) & 1) === 0;
        if (blinkOn) t.emi.setColorAt(n, _col.setRGB(1.55, 1.15, 0.55)); // the whole light strip pulses amber with the blinker
        else t.emi.setColorAt(n, _col.setRGB(li, li, li));
        // glow halos, facing-dependent: same-direction shows red tails, oncoming shows white heads
        const sgn = car.dir > 0 ? 1 : -1, fade = car.hit ? 0.5 : 1;
        if (car.dir > 0) for (const g of d.rear) G(car.x + g[0] * sgn, y + g[1], car.z + g[2] * sgn, 0xff3a28, g[3], 1.15 * fade);
        else for (const g of d.front) G(car.x + g[0] * sgn, y + g[1], car.z + g[2] * sgn, 0xfff0d0, g[3], 1.1 * fade);
        G(car.x, y - d.half[1] - 0.3, car.z, 0x4f9aa6, d.half[0] * 2.4, 0.45 * fade);
        const tp = d.top; G(car.x + tp[0], y + tp[1], car.z + tp[2] * sgn, car.type === 'cab' ? 0xd9953f : accent[(car.paint < 0 ? 2 : car.paint) & 3], tp[3], 0.8);
        if (d.beacons) { const on = (Math.floor(time * 3 + car.ph) & 1) === 0; if (on) for (const g of d.beacons) G(car.x + g[0] * sgn, y + g[1], car.z + g[2] * sgn, 0xffa030, 2.2, 1.8); }
        if (cutting) { // lane cut near the player: big amber blinker out at the side, rear and front corners, lit on the first frame
          if (blinkOn) {
            const s = car.lcTo > car.lcFrom ? 1 : -1, sx = car.x + s * (h0(d) + 0.55);
            G(sx, y + 0.45, car.z + d.half[2] * 0.95 * sgn, 0xffb050, 3.6, 2.6);
            G(sx, y + 0.45, car.z - d.half[2] * 0.85 * sgn, 0xffb050, 2.2, 1.8);
          }
        } else if (car.blink > 0 && (Math.floor(time * 5) & 1)) {
          const s = car.tx > car.x ? 1 : -1; G(car.x + s * (h0(d) + 0.1), y, car.z + d.half[2] * 0.8 * sgn, 0xffa53a, 1.4, 1.6);
        }
        if (car.clear >= 0 && car.clear < 1.2) { const on = Math.floor(time * 8) & 1; G(car.x, y + d.half[1] + 0.4, car.z, on ? 0xc9584a : 0x7ab3b8, 2.4, 1.5); }
      }
      for (const k in T) {
        const t = T[k]; t.body.count = t.n; t.emi.count = t.n;
        if (t.n) { t.body.instanceMatrix.needsUpdate = true; t.emi.instanceMatrix.needsUpdate = true; t.body.instanceColor.needsUpdate = true; t.emi.instanceColor.needsUpdate = true; }
      }

      // blimps: slow parallax drift high above, searchlight sweep, police blink
      for (const b of blimps) {
        b.z += scroll * 0.22 + dt * 2;
        if (b.z > 80) placeBlimp(b, -900 - rand() * 300);
        b.g.position.set(b.x, b.y + Math.sin(time * 0.3 + b.ph) * 1.5, b.z);
        b.beam.rotation.set(Math.sin(time * 0.45 + b.ph) * 0.5, 0, Math.cos(time * 0.33 + b.ph) * 0.45);
        const fl = 0.85 + 0.15 * Math.sin(time * 9 + b.ph) * Math.sin(time * 2.3); b.pmat.color.setScalar(fl * 1.6);
        const by = b.g.position.y;
        G(b.x, by - 8, b.z - 14, 0xf0d8a8, 6, 1.2);
        if (b.police) { const ph = Math.floor(time * 4) & 1; G(b.x - 2, by + 6.8, b.z, 0xc9584a, 5, ph ? 2 : 0.3); G(b.x + 2, by + 6.8, b.z, 0x4f9aa6, 5, ph ? 0.3 : 2); }
        else G(b.x, by + 6.8, b.z, 0xc9584a, 3, (Math.floor(time * 1.5 + b.ph) & 1) ? 1.5 : 0.2);
      }

      const geo = glow.geometry;
      geo.setDrawRange(0, gN);
      if (gN) { geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.attributes.size.needsUpdate = true; }
      if (core.renderer) { core.renderer.getDrawingBufferSize(_v2); glow.material.uniforms.uH.value = _v2.y; }
      if (scene.fog) glow.material.uniforms.uFog.value = scene.fog.density || 0;
    },
    // AABB test of the player's box against every live car; least-penetration axis gives the push normal
    collide(box) {
      if (!built || !box || !box.min) return MISS;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]; if (car.hit || car.clear >= 0) continue;
        const h = car.def.half, cy = car.y + car.def.cy;
        const ox = Math.min(box.max.x - (car.x - h[0]), (car.x + h[0]) - box.min.x); if (ox <= 0) continue;
        const oy = Math.min(box.max.y - (cy - h[1]), (cy + h[1]) - box.min.y); if (oy <= 0) continue;
        const oz = Math.min(box.max.z - (car.z - h[2]), (car.z + h[2]) - box.min.z); if (oz <= 0) continue;
        const bx = (box.min.x + box.max.x) * 0.5, by = (box.min.y + box.max.y) * 0.5, bz = (box.min.z + box.max.z) * 0.5;
        const n = HIT.normal;
        if (ox <= oy && ox <= oz) n.set(bx >= car.x ? 1 : -1, 0, 0);
        else if (oy <= oz) n.set(0, by >= cy ? 1 : -1, 0);
        else n.set(0, 0, bz >= car.z ? 1 : -1);
        car.hit = true; car.vx = (bx >= car.x ? -1 : 1) * 7; car.spin = 0;
        HIT.kind = car.type === 'hauler' ? 'hauler' : 'car'; HIT.car = car;
        return HIT;
      }
      return MISS;
    },
    // siren: every car within d metres ahead of the player swerves out of the corridor over ~1 s (no score)
    clearAhead(d) {
      if (!built) return 0;
      d = d || C.SIREN_CLEAR || 320;
      const pz = NR.player && NR.player.pos ? NR.player.pos.z : 0;
      let n = 0;
      for (const car of cars) {
        if (car.clear >= 0 || car.hit) continue;
        if (car.z + car.def.half[2] > pz - d && car.z - car.def.half[2] < pz + 4) {
          car.clear = 0; car.x0 = car.x; car.y0 = car.y; car.side = car.x === 0 ? (rand() < 0.5 ? -1 : 1) : Math.sign(car.x); car.done = true; n++;
        }
      }
      return n;
    },
    stats() {
      const by = {}; for (const k in T) by[k] = 0; let onc = 0;
      for (const c of cars) { by[c.type]++; if (c.dir < 0) onc++; }
      let planned = 0; for (const c of cars) if (c.lc === 1) planned++;
      return { active: cars.length, desired: desired(), byType: by, oncoming: onc, glows: gN, blimps: blimps.length,
        difficulty: +diff().toFixed(2), lcChance: +lcChance().toFixed(2), lcMax: lcMax(), lcPlanned: planned, lcActive, lcCount, lcAborts };
    },
  };
  function h0(d) { return d.half[0]; }
})();
