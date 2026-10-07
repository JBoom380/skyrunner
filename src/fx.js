// NEON RAIN fx: rain, speed lines, boost streaks, thruster shimmer, hit sparks/spray,
// crash explosion (fireball, debris, smoke trails), near-miss flash, siren pulse.
// All pooled. Rain and speed lines run on the GPU (one draw each). No per-frame allocation.
(function () {
  const NR = window.NR = window.NR || {};
  const D = () => NR.DISTRICTS || [];
  let T, C, core, scene, cam, ready = false;
  const quality = () => (core && core.settings && core.settings.quality === 'low') ? 0.7 : 1;

  // fraction of the treadmill scroll a new particle follows (1 = fixed in the world, 0 = rides with the car)
  let CARRY = 1;
  // ---------- shared temps ----------
  let v0, v1, v2, qt, eu, sc, mt, col0, col1;

  // ---------- point sprite pool (additive fire/glow, normal smoke) ----------
  const PT_VS = `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute float aHard;
    uniform float uScale; uniform float uMax; varying vec3 vC; varying float vA; varying float vH;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(aSize * uScale / max(0.5, -mv.z), 1., uMax); vC = aColor; vA = aAlpha; vH = aHard; }`;
  const PT_FS = `varying vec3 vC; varying float vA; varying float vH;
    void main(){ float d = length(gl_PointCoord - .5) * 2.; if (d > 1.) discard;
      float a = mix(1. - smoothstep(0., 1., d), 1. - smoothstep(.55, 1., d), vH);
      a *= a; gl_FragColor = vec4(vC * (1. + (1. - d) * vH), a * vA); }`;
  function PointPool(n, additive, order) {
    const g = new T.BufferGeometry();
    this.n = n; this.m = 0; this.rr = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.hard = new Float32Array(n);
    this.P = new Float32Array(n * 3); this.V = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.c0 = new Float32Array(n * 3); this.c1 = new Float32Array(n * 3);
    this.a0 = new Float32Array(n); this.drag = new Float32Array(n); this.grav = new Float32Array(n); this.h = new Float32Array(n); this.fadeIn = new Float32Array(n); this.carry = new Float32Array(n);
    const at = (a, k) => { const b = new T.BufferAttribute(a, k); b.setUsage(T.DynamicDrawUsage); return b; };
    g.setAttribute('position', at(this.pos, 3)); g.setAttribute('aColor', at(this.col, 3)); g.setAttribute('aSize', at(this.size, 1));
    g.setAttribute('aAlpha', at(this.alpha, 1)); g.setAttribute('aHard', at(this.hard, 1)); g.setDrawRange(0, 0);
    this.uni = { uScale: { value: 400 }, uMax: { value: 256 } };
    this.mat = new T.ShaderMaterial({ uniforms: this.uni, vertexShader: PT_VS, fragmentShader: PT_FS, transparent: true, depthWrite: false,
      blending: additive ? T.AdditiveBlending : T.NormalBlending });
    this.obj = new T.Points(g, this.mat); this.obj.frustumCulled = false; this.obj.renderOrder = order; this.g = g;
  }
  PointPool.prototype.spawn = function (x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a0, drag, grav, hard, fadeIn) {
    let i = this.m < this.n ? this.m++ : (this.rr = (this.rr + 1) % this.n);
    const j = i * 3;
    this.P[j] = x; this.P[j + 1] = y; this.P[j + 2] = z; this.V[j] = vx; this.V[j + 1] = vy; this.V[j + 2] = vz;
    this.life[i] = 0; this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0; this.drag[i] = drag; this.grav[i] = grav; this.h[i] = hard; this.fadeIn[i] = fadeIn || 0; this.carry[i] = CARRY;
    this.c0[j] = ((c0 >> 16) & 255) / 255; this.c0[j + 1] = ((c0 >> 8) & 255) / 255; this.c0[j + 2] = (c0 & 255) / 255;
    this.c1[j] = ((c1 >> 16) & 255) / 255; this.c1[j + 1] = ((c1 >> 8) & 255) / 255; this.c1[j + 2] = (c1 & 255) / 255;
  };
  PointPool.prototype.copy = function (i, k) { // move slot k into slot i
    const j = i * 3, l = k * 3;
    for (let a = 0; a < 3; a++) { this.P[j + a] = this.P[l + a]; this.V[j + a] = this.V[l + a]; this.c0[j + a] = this.c0[l + a]; this.c1[j + a] = this.c1[l + a]; }
    this.life[i] = this.life[k]; this.max[i] = this.max[k]; this.s0[i] = this.s0[k]; this.s1[i] = this.s1[k]; this.a0[i] = this.a0[k];
    this.drag[i] = this.drag[k]; this.grav[i] = this.grav[k]; this.h[i] = this.h[k]; this.fadeIn[i] = this.fadeIn[k]; this.carry[i] = this.carry[k];
  };
  PointPool.prototype.update = function (dt, scroll) {
    let i = 0;
    while (i < this.m) {
      this.life[i] += dt;
      if (this.life[i] >= this.max[i]) { this.m--; if (i !== this.m) this.copy(i, this.m); continue; }
      const j = i * 3, k = Math.exp(-this.drag[i] * dt);
      this.V[j] *= k; this.V[j + 1] = this.V[j + 1] * k - this.grav[i] * dt; this.V[j + 2] *= k;
      this.P[j] += this.V[j] * dt; this.P[j + 1] += this.V[j + 1] * dt; this.P[j + 2] += this.V[j + 2] * dt + scroll * this.carry[i];
      const t = this.life[i] / this.max[i], fi = this.fadeIn[i];
      this.pos[j] = this.P[j]; this.pos[j + 1] = this.P[j + 1]; this.pos[j + 2] = this.P[j + 2];
      const ct = Math.min(1, t * 1.6);
      this.col[j] = this.c0[j] + (this.c1[j] - this.c0[j]) * ct; this.col[j + 1] = this.c0[j + 1] + (this.c1[j + 1] - this.c0[j + 1]) * ct; this.col[j + 2] = this.c0[j + 2] + (this.c1[j + 2] - this.c0[j + 2]) * ct;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - (1 - t) * (1 - t));
      this.alpha[i] = this.a0[i] * (1 - t) * (fi > 0 ? Math.min(1, t / fi) : 1);
      this.hard[i] = this.h[i];
      i++;
    }
    const g = this.g; g.setDrawRange(0, this.m);
    if (this.m) for (const a of ATTRS) { const b = g.attributes[a]; b.needsUpdate = true; }
  };
  PointPool.prototype.clear = function () { this.m = 0; this.g.setDrawRange(0, 0); };
  const ATTRS = ['position', 'aColor', 'aSize', 'aAlpha', 'aHard'];

  // ---------- line pool (sparks, streak flashes) ----------
  function LinePool(n) {
    this.n = n; this.m = 0; this.rr = 0;
    this.pos = new Float32Array(n * 6); this.col = new Float32Array(n * 6);
    this.P = new Float32Array(n * 3); this.V = new Float32Array(n * 3); this.Tl = new Float32Array(n * 3); this.C = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.grav = new Float32Array(n); this.trail = new Float32Array(n); this.drag = new Float32Array(n); this.carry = new Float32Array(n);
    const g = new T.BufferGeometry();
    const pa = new T.BufferAttribute(this.pos, 3), ca = new T.BufferAttribute(this.col, 3); pa.setUsage(T.DynamicDrawUsage); ca.setUsage(T.DynamicDrawUsage);
    g.setAttribute('position', pa); g.setAttribute('color', ca); g.setDrawRange(0, 0); this.g = g;
    this.obj = new T.LineSegments(g, new T.LineBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
    this.obj.frustumCulled = false; this.obj.renderOrder = 7;
  }
  // trail > 0: tail = P - V*trail (spark). trail == 0: tail = P - (tx,ty,tz) (fixed streak).
  LinePool.prototype.spawn = function (x, y, z, vx, vy, vz, life, color, grav, trail, tx, ty, tz, drag) {
    const i = this.m < this.n ? this.m++ : (this.rr = (this.rr + 1) % this.n), j = i * 3;
    this.P[j] = x; this.P[j + 1] = y; this.P[j + 2] = z; this.V[j] = vx; this.V[j + 1] = vy; this.V[j + 2] = vz;
    this.Tl[j] = tx || 0; this.Tl[j + 1] = ty || 0; this.Tl[j + 2] = tz || 0;
    this.C[j] = ((color >> 16) & 255) / 255; this.C[j + 1] = ((color >> 8) & 255) / 255; this.C[j + 2] = (color & 255) / 255;
    this.life[i] = 0; this.max[i] = life; this.grav[i] = grav; this.trail[i] = trail; this.drag[i] = drag || 0; this.carry[i] = CARRY;
  };
  LinePool.prototype.update = function (dt, scroll) {
    let i = 0;
    while (i < this.m) {
      this.life[i] += dt;
      if (this.life[i] >= this.max[i]) {
        this.m--;
        if (i !== this.m) { const j = i * 3, l = this.m * 3;
          for (let a = 0; a < 3; a++) { this.P[j + a] = this.P[l + a]; this.V[j + a] = this.V[l + a]; this.Tl[j + a] = this.Tl[l + a]; this.C[j + a] = this.C[l + a]; }
          this.life[i] = this.life[this.m]; this.max[i] = this.max[this.m]; this.grav[i] = this.grav[this.m]; this.trail[i] = this.trail[this.m]; this.drag[i] = this.drag[this.m]; this.carry[i] = this.carry[this.m]; }
        continue;
      }
      const j = i * 3, k = Math.exp(-this.drag[i] * dt);
      this.V[j] *= k; this.V[j + 1] = this.V[j + 1] * k - this.grav[i] * dt; this.V[j + 2] *= k;
      this.P[j] += this.V[j] * dt; this.P[j + 1] += this.V[j + 1] * dt; this.P[j + 2] += this.V[j + 2] * dt + scroll * this.carry[i];
      const tr = this.trail[i], o = i * 6;
      const tx = tr > 0 ? this.V[j] * tr : this.Tl[j], ty = tr > 0 ? this.V[j + 1] * tr : this.Tl[j + 1], tz = tr > 0 ? this.V[j + 2] * tr : this.Tl[j + 2];
      this.pos[o] = this.P[j]; this.pos[o + 1] = this.P[j + 1]; this.pos[o + 2] = this.P[j + 2];
      this.pos[o + 3] = this.P[j] - tx; this.pos[o + 4] = this.P[j + 1] - ty; this.pos[o + 5] = this.P[j + 2] - tz;
      const t = this.life[i] / this.max[i], a = 1 - t * t;
      this.col[o] = this.C[j] * a; this.col[o + 1] = this.C[j + 1] * a; this.col[o + 2] = this.C[j + 2] * a;
      this.col[o + 3] = this.C[j] * a * 0.25; this.col[o + 4] = this.C[j + 1] * a * 0.25; this.col[o + 5] = this.C[j + 2] * a * 0.25;
      i++;
    }
    this.g.setDrawRange(0, this.m * 2);
    if (this.m) { this.g.attributes.position.needsUpdate = true; this.g.attributes.color.needsUpdate = true; }
  };
  LinePool.prototype.clear = function () { this.m = 0; this.g.setDrawRange(0, 0); };

  // ---------- GPU rain (camera-centred wrapped box) ----------
  const RAIN_MAX = 1400;
  const RAIN_VS = `attribute vec3 aSeed; attribute float aEnd; attribute float aRnd;
    uniform vec3 uOff; uniform vec3 uBoxMin; uniform vec3 uBoxSize; uniform vec3 uDir; uniform float uLen; uniform float uAlpha; uniform vec3 uColor;
    varying vec3 vC;
    void main(){
      vec3 off = vec3(uOff.x, uOff.y * (.8 + .45 * aRnd), uOff.z);
      vec3 local = uBoxMin + mod(aSeed * uBoxSize + off - cameraPosition, uBoxSize);
      vec3 p = cameraPosition + local - uDir * uLen * (.6 + .8 * aRnd) * aEnd;
      float a = uAlpha * mix(1., .12, aEnd) * smoothstep(-1.5, -7., local.z) * smoothstep(uBoxMin.z, uBoxMin.z + 18., local.z);
      vC = uColor * a * (.6 + .7 * aRnd);
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`;
  const LINE_FS = `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.); }`;
  let rain, rainU, rainOff, rainLevel = 0, rainCount = 0;
  function buildRain() {
    const n = RAIN_MAX, seed = new Float32Array(n * 6), end = new Float32Array(n * 2), rnd = new Float32Array(n * 2), pos = new Float32Array(n * 6);
    const r = NR.rng ? NR.rng(4711) : Math.random;
    for (let i = 0; i < n; i++) { const a = r(), b = r(), c = r(), d = r();
      for (let e = 0; e < 2; e++) { seed[i * 6 + e * 3] = a; seed[i * 6 + e * 3 + 1] = b; seed[i * 6 + e * 3 + 2] = c; end[i * 2 + e] = e; rnd[i * 2 + e] = d; } }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new T.BufferAttribute(seed, 3));
    g.setAttribute('aEnd', new T.BufferAttribute(end, 1)); g.setAttribute('aRnd', new T.BufferAttribute(rnd, 1));
    rainOff = new T.Vector3();
    rainU = { uOff: { value: rainOff }, uBoxMin: { value: new T.Vector3(-26, -16, -75) }, uBoxSize: { value: new T.Vector3(52, 34, 77) },
      uDir: { value: new T.Vector3(0, -1, 0) }, uLen: { value: 1.6 }, uAlpha: { value: 0 }, uColor: { value: new T.Color(0x9ab8c0) } };
    rain = new T.LineSegments(g, new T.ShaderMaterial({ uniforms: rainU, vertexShader: RAIN_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    rain.frustumCulled = false; rain.renderOrder = 8; g.setDrawRange(0, 0);
  }

  // ---------- GPU speed lines (tube around the camera axis) ----------
  const SPD_MAX = 160;
  const SPD_VS = `attribute vec3 aSeed; attribute float aEnd; attribute float aRnd;
    uniform float uOff; uniform float uLen; uniform float uAlpha; uniform vec3 uColor; uniform vec3 uColor2; varying vec3 vC;
    void main(){
      float ang = aSeed.x * 6.2832, rad = 8. + aSeed.y * 14.;
      float z = -140. + mod(aSeed.z * 140. + uOff * (.7 + .6 * aRnd), 140.);
      vec3 local = vec3(cos(ang) * rad, sin(ang) * rad * 1.25 + 1.5, z - uLen * (.5 + aRnd) * aEnd);
      float a = uAlpha * mix(1., 0., aEnd) * smoothstep(-140., -100., z) * smoothstep(-1., -12., z) * step(.62 - uAlpha * .35, aRnd);
      vC = mix(uColor, uColor2, step(.5, fract(aRnd * 7.31))) * a;
      gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + local, 1.); }`;
  let spd, spdU;
  function buildSpeed() {
    const n = SPD_MAX, seed = new Float32Array(n * 6), end = new Float32Array(n * 2), rnd = new Float32Array(n * 2), pos = new Float32Array(n * 6);
    const r = NR.rng ? NR.rng(99) : Math.random;
    for (let i = 0; i < n; i++) { const a = r(), b = r(), c = r(), d = r();
      for (let e = 0; e < 2; e++) { seed[i * 6 + e * 3] = a; seed[i * 6 + e * 3 + 1] = b; seed[i * 6 + e * 3 + 2] = c; end[i * 2 + e] = e; rnd[i * 2 + e] = d; } }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new T.BufferAttribute(seed, 3));
    g.setAttribute('aEnd', new T.BufferAttribute(end, 1)); g.setAttribute('aRnd', new T.BufferAttribute(rnd, 1));
    spdU = { uOff: { value: 0 }, uLen: { value: 10 }, uAlpha: { value: 0 }, uColor: { value: new T.Color(0xebede6) }, uColor2: { value: new T.Color(0x7ab3b8) } };
    spd = new T.LineSegments(g, new T.ShaderMaterial({ uniforms: spdU, vertexShader: SPD_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    spd.frustumCulled = false; spd.renderOrder = 9;
  }

  // ---------- siren: screen-edge sweep overlay + world rings ----------
  const EDGE_VS = 'varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0., 1.); }';
  const EDGE_FS = `varying vec2 vU; uniform float uT; uniform float uA; uniform vec3 uR; uniform vec3 uB;
    void main(){ vec2 q = vU - .5; q.y *= 16. / 9.;
      float dx = .5 - abs(q.x), dy = .5 * 16. / 9. - abs(q.y), d = min(dx, dy);
      float edge = 1. - smoothstep(0., .16, d); edge = edge * edge;
      float ang = atan(q.y, q.x), sweep = .35 + .65 * pow(.5 + .5 * cos(ang * 2. - uT * 14.), 3.);
      float side = step(0., q.x); float ph = step(.5, fract(uT * 3.));
      vec3 c = mix(uR, uB, abs(side - ph));
      gl_FragColor = vec4(c * edge * sweep * uA, 1.); }`;
  let edge, edgeU, sirenT = 0;
  const RINGS = [];
  function buildSiren() {
    edgeU = { uT: { value: 0 }, uA: { value: 0 }, uR: { value: new T.Color(0xd04a3c) }, uB: { value: new T.Color(0x3f86b0) } };
    edge = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({ uniforms: edgeU, vertexShader: EDGE_VS, fragmentShader: EDGE_FS,
      transparent: true, depthTest: false, depthWrite: false, blending: T.AdditiveBlending }));
    edge.frustumCulled = false; edge.renderOrder = 1000; edge.visible = false;
    const rg = new T.RingGeometry(0.86, 1, 48);
    for (let i = 0; i < 4; i++) {
      const m = new T.Mesh(rg, new T.MeshBasicMaterial({ color: i % 2 ? 0x3f86b0 : 0xd04a3c, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false }));
      m.visible = false; m.frustumCulled = false; m.renderOrder = 10; RINGS.push({ m, t: -1, delay: i * 0.18, z0: 0 });
    }
  }

  // ---------- debris (instanced chunks, hot then cooling, smoke trails) ----------
  const DEB = 28;
  let deb, debP, debV, debR, debW, debS, debL, debOn = 0;
  function buildDebris() {
    deb = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: 0xffffff }), DEB);
    deb.instanceMatrix.setUsage(T.DynamicDrawUsage); deb.count = 0; deb.frustumCulled = false;
    for (let i = 0; i < DEB; i++) deb.setColorAt(i, col0.setHex(0x243038));
    debP = new Float32Array(DEB * 3); debV = new Float32Array(DEB * 3); debR = new Float32Array(DEB * 3); debW = new Float32Array(DEB * 3); debS = new Float32Array(DEB * 3); debL = new Float32Array(DEB);
  }

  // ---------- helpers ----------
  const rnd = (a, b) => a + Math.random() * (b - a);
  function playerPos(out) {
    const p = NR.player && NR.player.pos;
    if (p && typeof p.x === 'number') return out.set(p.x, p.y, p.z);
    return out.set(0, 0, 0);
  }
  let pools; // {add, smoke, lines}

  // public burst helpers
  function sparks(x, y, z, n, dirX, dirY, dirZ, speed, color) {
    for (let i = 0; i < n; i++) {
      const s = speed * rnd(0.4, 1.1);
      pools.lines.spawn(x, y, z, dirX * s + rnd(-1, 1) * speed * 0.6, dirY * s + rnd(-0.3, 1) * speed * 0.6, dirZ * s + rnd(-1, 1) * speed * 0.6,
        rnd(0.25, 0.6), color || (Math.random() < 0.7 ? 0xf5d69e : 0xdb994d), 22, 0.04, 0, 0, 0, 1.5);
    }
  }
  function hitFx(x, y, z) {
    CARRY = 0.12;
    // sparks thrown up and out past the hull (toward the camera so they read over the car), cold spray, white crack
    for (let i = 0; i < 36; i++) { const sd = Math.random() < 0.5 ? -1 : 1;
      pools.lines.spawn(x + sd * rnd(1.4, 2.0), y + rnd(0.6, 1.5), z + rnd(-1, 1), sd * rnd(6, 22), rnd(4, 16), rnd(4, 20),
        rnd(0.3, 0.7), Math.random() < 0.7 ? 0xf5d69e : 0xdb994d, 26, 0.05, 0, 0, 0, 1.2); }
    for (let i = 0; i < 10; i++) pools.add.spawn(x + rnd(-2, 2), y + rnd(1, 1.8), z + rnd(-1, 1), rnd(-6, 6), rnd(0, 6), rnd(2, 10), rnd(0.25, 0.5), 1.2, 3, 0xf5d69e, 0xc9584a, 0.9, 3, 0, 0.6);
    for (let i = 0; i < 16; i++) pools.smoke.spawn(x + rnd(-2, 2), y + rnd(0, 1.4), z + rnd(-2, 2), rnd(-6, 6), rnd(0, 4), rnd(2, 12), rnd(0.5, 0.9), 1.2, 4.5, 0x7ab3b8, 0x36454c, 0.5, 2, 0, 0, 0.1);
    pools.add.spawn(x, y + 1.6, z, 0, 0, 4, 0.2, 6, 11, 0xebede6, 0xdb994d, 1, 0, 0, 0.3);
    CARRY = 1;
  }
  function explode(x, y, z) {
    const q = quality();
    // white core flash and fireball shells
    pools.add.spawn(x, y, z, 0, 0, 0, 0.3, 5, 15, 0xffffff, 0xf5d69e, 1, 0, 0, 0.2);
    for (let i = 0; i < 26 * q; i++) {
      const a = Math.random() * 6.283, b = rnd(-0.6, 1), s = rnd(4, 15);
      pools.add.spawn(x, y, z, Math.cos(a) * s, b * s * 0.8 + 2, Math.sin(a) * s, rnd(0.6, 1.25), rnd(1.5, 3), rnd(4, 8),
        Math.random() < 0.5 ? 0xf5d69e : 0xdb994d, Math.random() < 0.6 ? 0x9e4236 : 0x5c331a, 1, 2.5, -2, 0.5);
    }
    // secondary pops
    for (let i = 0; i < 6; i++) pools.add.spawn(x + rnd(-4, 4), y + rnd(-2, 3), z + rnd(-4, 4), 0, 1, 0, rnd(0.4, 0.7), 1.5, rnd(4, 6.5), 0xdb994d, 0x9e4236, 0.9, 1, 0, 0.5, 0.35);
    // smoke: dark billows that rise and linger, lit amber at first
    for (let i = 0; i < 30 * q; i++) {
      const a = Math.random() * 6.283, s = rnd(2, 8);
      pools.smoke.spawn(x + rnd(-2, 2), y + rnd(-1, 2), z + rnd(-2, 2), Math.cos(a) * s, rnd(1, 5), Math.sin(a) * s, rnd(3, 5), rnd(2, 4), rnd(8, 13),
        0x5c331a, 0x243038, 0.8, 1.2, -1.2, 0, 0.12);
    }
    sparks(x, y, z, 60, 0, 0.5, 0, 34, 0);
    // shockwave ring
    shock.t = 0; shock.x = x; shock.y = y; shock.z = z;
    // debris
    debOn = DEB; deb.count = DEB;
    for (let i = 0; i < DEB; i++) {
      const j = i * 3, a = Math.random() * 6.283, s = rnd(8, 26);
      debP[j] = x; debP[j + 1] = y; debP[j + 2] = z;
      debV[j] = Math.cos(a) * s; debV[j + 1] = rnd(2, 20); debV[j + 2] = Math.sin(a) * s;
      debR[j] = Math.random() * 6; debR[j + 1] = Math.random() * 6; debR[j + 2] = Math.random() * 6;
      debW[j] = rnd(-12, 12); debW[j + 1] = rnd(-12, 12); debW[j + 2] = rnd(-12, 12);
      const big = i < 6 ? 2.2 : 1; debS[j] = rnd(0.2, 0.7) * big; debS[j + 1] = rnd(0.08, 0.3) * big; debS[j + 2] = rnd(0.25, 0.9) * big;
      debL[i] = rnd(2.2, 4);
    }
    wreckT = 3.2;
  }
  const shock = { t: 9, x: 0, y: 0, z: 0 };
  let shockMesh, wreckT = 0;
  function nearMissFx(x, y, z, side) {
    CARRY = 0.25;
    // anamorphic flare: a wide horizontal glare + long Z streaks + a hot core, then sparks off the passed car
    pools.lines.spawn(x + 6, y, z, 0, 0, 0, 0.35, 0xebede6, 0, 0, 12, 0, 0);
    pools.lines.spawn(x + 3.5, y + 0.15, z, 0, 0, 0, 0.3, 0xf5d69e, 0, 0, 7, 0, 0);
    pools.lines.spawn(x, y, z + 4, 0, 0, 0, 0.45, 0xdb994d, 0, 0, 0, 0, 30);
    pools.lines.spawn(x - side * 0.8, y + 0.5, z + 3, 0, 0, 0, 0.35, 0x7ab3b8, 0, 0, 0, 0, 20);
    pools.lines.spawn(x - side * 0.8, y - 0.5, z + 3, 0, 0, 0, 0.35, 0x7ab3b8, 0, 0, 0, 0, 20);
    pools.add.spawn(x, y, z, 0, 0, 6, 0.28, 2.2, 4.5, 0xffffff, 0xdb994d, 1, 0, 0, 0.9);
    pools.add.spawn(x, y, z, 0, 0, 6, 0.4, 4, 8, 0xdb994d, 0x5c331a, 0.35, 0, 0, 0);
    sparks(x, y, z, 14, side, 0.2, 0.6, 18, 0xf5d69e);
    CARRY = 1;
  }
  function sirenPulse() {
    sirenT = 1.0; edge.visible = true;
    const pp = playerPos(v0);
    for (const r of RINGS) { r.t = -r.delay; r.x = pp.x; r.y = pp.y + 0.6; r.z0 = pp.z - 3; }
  }

  // ---------- emitters tied to the car ----------
  const PODS = [[-1.25, -0.85, -4.25], [1.25, -0.85, -4.25], [-0.95, -1.0, 2.55], [0.95, -1.0, 2.55]];
  let shimAcc = 0, boostAcc = 0, wreckAcc = 0, boostOn = false;
  function carWorld(lx, ly, lz, out) {
    const car = NR.player && NR.player.car && NR.player.car.group;
    if (car && car.matrixWorld) { out.set(lx, ly, lz).applyMatrix4(car.matrixWorld); return true; }
    if (NR.player && NR.player.pos) { playerPos(out); out.x += lx; out.y += ly; out.z += lz; return true; }
    return false;
  }

  // ---------- module ----------
  const fx = NR.fx = {
    rainLevel: 0, speedLevel: 0, sirenActive: false,
    init(c) {
      core = c; T = c.THREE || window.THREE; C = NR.cfg || {}; scene = c.scene; cam = c.camera;
      v0 = new T.Vector3(); v1 = new T.Vector3(); v2 = new T.Vector3(); qt = new T.Quaternion(); eu = new T.Euler(); sc = new T.Vector3(); mt = new T.Matrix4(); col0 = new T.Color(); col1 = new T.Color();
      pools = { add: new PointPool(700, true, 6), smoke: new PointPool(320, false, 5), lines: new LinePool(400) };
      buildRain(); buildSpeed(); buildSiren(); buildDebris();
      shockMesh = new T.Mesh(new T.RingGeometry(0.7, 1, 40), new T.MeshBasicMaterial({ color: 0xf5d69e, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false }));
      shockMesh.visible = false; shockMesh.frustumCulled = false;
      scene.add(pools.smoke.obj, pools.add.obj, pools.lines.obj, rain, spd, edge, deb, shockMesh);
      for (const r of RINGS) scene.add(r.m);
      try { const gl = c.renderer.getContext(), rng = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE); const mx = Math.min(rng[1], 400); pools.add.uni.uMax.value = mx; pools.smoke.uni.uMax.value = mx; } catch (e) {}
      const bus = NR.bus; if (bus) {
        bus.on('hit', () => { if (!ready) return; const p = playerPos(v1); hitFx(p.x, p.y, p.z - 1); });
        bus.on('crash', () => { if (!ready) return; const p = playerPos(v1); explode(p.x, p.y, p.z);
          if (core.flash) core.flash(0xf5d69e, 0.3, 0.5); if (core.shake) core.shake(1.4, 0.9); });
        bus.on('nearMiss', (d) => { if (!ready) return; const pp = playerPos(v2);
          const p = d && d.pos && typeof d.pos.x === 'number' ? d.pos : pp; const side = p.x > pp.x ? -1 : 1;
          nearMissFx(p.x, p.y, Math.min(p.z, pp.z + 2), side); });
        bus.on('siren', () => { if (ready) sirenPulse(); });
        bus.on('boost', (d) => { boostOn = !!(d && d.on); if (boostOn && ready) { const p = playerPos(v1); pools.add.spawn(p.x, p.y - 0.3, p.z + 4.5, 0, 0, 20, 0.25, 3, 8, 0xebede6, 0x7ab3b8, 1, 0, 0, 0.5); } });
        bus.on('runStart', () => fx.reset(core));
      }
      ready = true;
    },
    reset() {
      if (!ready) return;
      pools.add.clear(); pools.smoke.clear(); pools.lines.clear();
      debOn = 0; deb.count = 0; wreckT = 0; sirenT = 0; edge.visible = false; shock.t = 9; shockMesh.visible = false;
      for (const r of RINGS) { r.t = -1; r.m.visible = false; }
      rainOff.set(0, 0, 0); spdU.uOff.value = 0; boostOn = false;
    },
    update(dt, c) {
      if (!ready) return;
      core = c; const scroll = c.scroll || 0, vel = dt > 0 ? scroll / dt : 0, q = quality();
      const P = NR.player, boosting = !!(P && P.boosting), bank = (P && typeof P.bank === 'number') ? P.bank : 0;
      const alive = !P || P.alive !== false;

      // pixel-size scale for point sprites (render target height / (2 tan(fov/2)))
      const H = (c.settings && c.settings.quality === 'low') ? 480 : 640;
      const sc2 = H / (2 * Math.tan((cam.fov * Math.PI / 180) / 2));
      pools.add.uni.uScale.value = sc2; pools.smoke.uni.uScale.value = sc2;

      // ---- rain ----
      const Ds = D(), b = c.blend || { a: 0, b: 0, t: 0 }, A = Ds[b.a], B = Ds[b.b] || A;
      const target = A ? (A.rain + ((B.rain) - A.rain) * b.t) : 1;
      rainLevel += (target - rainLevel) * (1 - Math.exp(-dt * 1.5));
      fx.rainLevel = rainLevel;
      rainCount = rainLevel < 0.02 ? 0 : Math.round(Math.min(RAIN_MAX, 760 * rainLevel * q));
      rain.geometry.setDrawRange(0, rainCount * 2); rain.visible = rainCount > 0;
      const fall = 26, wind = -3 - bank * 30;
      rainOff.x += wind * dt; rainOff.y -= fall * dt; rainOff.z += vel * dt;
      if (Math.abs(rainOff.y) > 1e5 || rainOff.z > 1e5) rainOff.set(0, 0, 0);
      const zs = Math.min(0.6, 0.12 + vel * 0.0032);
      rainU.uDir.value.set(wind / fall * 0.8, -1, zs).normalize();
      rainU.uLen.value = 1.5 + vel * 0.006;
      rainU.uAlpha.value = 0.55 + Math.min(0.35, rainLevel * 0.25);
      // tint: warmer under the fire stacks, colder on the sea wall
      const tintA = A && A.id === 'stacks' ? 0xc8a080 : 0x9ab8c0, tintB = B && B.id === 'stacks' ? 0xc8a080 : 0x9ab8c0;
      rainU.uColor.value.setHex(tintA).lerp(col0.setHex(tintB), b.t);

      // ---- speed lines + boost streaks ----
      const sMin = C.SPEED_START || 60, sMax = (C.SPEED_MAX || 150) + (C.BOOST_ADD || 45);
      const sk = Math.max(0, Math.min(1, (vel - sMin - 25) / (sMax - sMin - 25)));
      const sl = c.state === 'PLAY' ? Math.max(sk * 0.8, boosting ? 1 : 0) : 0;
      fx.speedLevel += (sl - fx.speedLevel) * (1 - Math.exp(-dt * 6));
      spdU.uOff.value = (spdU.uOff.value + vel * 1.5 * dt) % 1e5;
      spdU.uAlpha.value = fx.speedLevel * (boosting ? 0.95 : 0.6); spdU.uLen.value = 8 + vel * 0.12;
      spd.visible = fx.speedLevel > 0.02;
      if (boosting) { spdU.uColor.value.setHex(0xf5d69e); spdU.uColor2.value.setHex(0xdb994d); }
      else { spdU.uColor.value.setHex(0xebede6); spdU.uColor2.value.setHex(0x7ab3b8); }

      // ---- thruster shimmer + boost exhaust ----
      if (dt > 0 && alive && P) {
        shimAcc += dt * 46 * q;
        while (shimAcc >= 1) { shimAcc -= 1; const pod = PODS[(Math.random() * 4) | 0];
          if (carWorld(pod[0] + rnd(-0.2, 0.2), pod[1], pod[2] + rnd(-0.3, 0.3), v0))
            pools.add.spawn(v0.x, v0.y, v0.z, rnd(-0.6, 0.6), rnd(-4, -2), rnd(1, 4), rnd(0.18, 0.34), 0.7, 1.9, 0x7ab3b8, 0x38737d, 0.55, 2, 0, 0.2, 0.15); }
        if (boosting) {
          boostAcc += dt * 70 * q;
          while (boostAcc >= 1) { boostAcc -= 1;
            if (carWorld(rnd(-0.15, 0.15), -0.35 + rnd(-0.1, 0.1), 4.3, v0)) {
              pools.add.spawn(v0.x, v0.y, v0.z, rnd(-1, 1), rnd(-1, 1), rnd(25, 45), rnd(0.1, 0.18), 0.9, 0.4, 0xebede6, 0xdb994d, 0.9, 1, 0, 0.7);
              if (Math.random() < 0.35) pools.lines.spawn(v0.x + rnd(-1.6, 1.6), v0.y + rnd(-0.6, 0.6), v0.z + 1, 0, 0, rnd(30, 60), rnd(0.12, 0.25), 0xdb994d, 0, 0.06);
            } }
        }
      }
      // wreck: fire and smoke trailing the falling car
      if (wreckT > 0 && dt > 0) {
        wreckT -= dt; wreckAcc += dt * 30 * q;
        while (wreckAcc >= 1) { wreckAcc -= 1;
          if (carWorld(rnd(-0.6, 0.6), 0.3, rnd(-1, 2), v0)) {
            pools.smoke.spawn(v0.x, v0.y, v0.z, rnd(-1, 1), rnd(2, 5), rnd(-1, 1), rnd(2, 3.4), 2, rnd(8, 13), 0x5c331a, 0x243038, 0.7, 0.8, -1, 0, 0.1);
            if (Math.random() < 0.5) pools.add.spawn(v0.x, v0.y, v0.z, rnd(-1, 1), rnd(1, 3), 0, rnd(0.25, 0.5), 2.2, 3.5, 0xf5d69e, 0x9e4236, 0.9, 1, 0, 0.5);
          } }
      }

      // ---- debris ----
      if (debOn) {
        let live = 0;
        for (let i = 0; i < DEB; i++) {
          const j = i * 3;
          if (debL[i] <= 0) { sc.set(0, 0, 0); mt.compose(v0.set(0, -999, 0), qt.identity(), sc); deb.setMatrixAt(i, mt); continue; }
          debL[i] -= dt; live++;
          debV[j + 1] -= 18 * dt; const k = Math.exp(-0.6 * dt); debV[j] *= k; debV[j + 2] *= k;
          debP[j] += debV[j] * dt; debP[j + 1] += debV[j + 1] * dt; debP[j + 2] += debV[j + 2] * dt + scroll;
          debR[j] += debW[j] * dt; debR[j + 1] += debW[j + 1] * dt; debR[j + 2] += debW[j + 2] * dt;
          eu.set(debR[j], debR[j + 1], debR[j + 2]); qt.setFromEuler(eu);
          mt.compose(v0.set(debP[j], debP[j + 1], debP[j + 2]), qt, sc.set(debS[j], debS[j + 1], debS[j + 2])); deb.setMatrixAt(i, mt);
          const heat = Math.max(0, Math.min(1, (debL[i] - 1.2) / 2));
          deb.setColorAt(i, col0.setHex(0x243038).lerp(col1.setHex(0xdb994d), heat));
          if (dt > 0 && Math.random() < dt * 22 * q) pools.smoke.spawn(debP[j], debP[j + 1], debP[j + 2], 0, 1, 0, rnd(0.8, 1.4), 0.8, 3, heat > 0.3 ? 0x5c331a : 0x36454c, 0x171f26, 0.6, 1, -0.5, 0, 0.1);
          if (heat > 0.2 && dt > 0 && Math.random() < dt * 20) pools.add.spawn(debP[j], debP[j + 1], debP[j + 2], 0, 0, 0, 0.2, 1.4, 0.6, 0xf5d69e, 0xdb994d, heat, 0, 0, 0.6);
        }
        deb.instanceMatrix.needsUpdate = true; if (deb.instanceColor) deb.instanceColor.needsUpdate = true;
        if (!live) { debOn = 0; deb.count = 0; }
      }

      // ---- shockwave ring ----
      if (shock.t < 0.6) {
        shock.t += dt; shock.z += scroll; const t = shock.t / 0.6;
        shockMesh.visible = true; shockMesh.position.set(shock.x, shock.y, shock.z); shockMesh.quaternion.copy(cam.quaternion);
        const s = 2 + 26 * (1 - (1 - t) * (1 - t)); shockMesh.scale.set(s, s, s); shockMesh.material.opacity = (1 - t) * 0.9;
      } else shockMesh.visible = false;

      // ---- siren ----
      if (sirenT > 0) {
        sirenT -= dt; edgeU.uT.value += dt; const e = Math.max(0, sirenT);
        edgeU.uA.value = Math.min(1, e * 4) * Math.min(1, (1 - e) * 10 + 0.3) * 1.3;
        fx.sirenActive = true; if (sirenT <= 0) { edge.visible = false; fx.sirenActive = false; }
      }
      for (const r of RINGS) {
        if (r.t < -0.5) continue;
        r.t += dt; if (r.t < 0) { r.m.visible = false; continue; }
        if (r.t > 0.9) { r.t = -1; r.m.visible = false; continue; }
        const t = r.t / 0.9, s = 3 + 30 * t;
        r.m.visible = true; r.m.position.set(r.x, r.y, r.z0 - 260 * t * t - 20 * t); r.m.scale.set(s * 1.1, s * 0.8, 1);
        r.m.material.opacity = (1 - t) * 0.85;
      }

      // ---- pools ----
      pools.add.update(dt, scroll); pools.smoke.update(dt, scroll); pools.lines.update(dt, scroll);
    },
    // public helpers (callable by other modules)
    sparks(pos, n = 16, dir) { if (!ready || !pos) return; sparks(pos.x, pos.y, pos.z, n, dir ? dir.x : 0, dir ? dir.y : 0.3, dir ? dir.z : 0.5, 24); },
    explode(pos) { if (!ready) return; const p = pos || playerPos(v1); explode(p.x, p.y, p.z); },
    nearMiss(pos) { if (!ready) return; const p = pos || playerPos(v1); nearMissFx(p.x, p.y, p.z, 1); },
    sirenPulse() { if (ready) sirenPulse(); },
    stats() { return { add: pools.add.m, smoke: pools.smoke.m, lines: pools.lines.m, rain: rainCount, rainLevel, speed: fx.speedLevel, debris: debOn ? deb.count : 0, siren: sirenT > 0 }; },
  };
})();
