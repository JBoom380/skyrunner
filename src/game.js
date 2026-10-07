// NEON RAIN core: renderer, low-res pixel pass, camera, loop, state machine, run state, scoring, district blend.
// Owned by the core author. Builders: do not edit. See SPEC.md.
(function () {
  const THREE = window.THREE, C = NR.cfg;
  const canvas = document.getElementById('game');
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const settings = Object.assign({ music: 0.7, sfx: 0.8, quality: isTouch ? 'low' : 'high' }, safeLoad(C.SETTINGS_KEY));
  function safeLoad(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 9 / 16, 0.5, 2600);
  scene.fog = new THREE.FogExp2(NR.DISTRICTS[0].fog, NR.DISTRICTS[0].density);
  let rt, W, H;
  function setRes() {
    [W, H] = C.RES[settings.quality] || C.RES.high;
    renderer.setSize(W, H, false);
    if (rt) rt.dispose();
    rt = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType });
    fit();
  }
  function fit() { // keep a 9:16 column, letterboxed on wide screens
    const vw = innerWidth, vh = innerHeight, s = Math.min(vw / 9, vh / 16);
    const w = Math.round(9 * s), h = Math.round(16 * s);
    Object.assign(canvas.style, { width: w + 'px', height: h + 'px', left: ((vw - w) / 2) + 'px', top: ((vh - h) / 2) + 'px' });
    const ui = document.getElementById('ui'); if (ui) Object.assign(ui.style, { width: w + 'px', height: h + 'px', left: ((vw - w) / 2) + 'px', top: ((vh - h) / 2) + 'px' });
    core.view = { w, h, left: (vw - w) / 2, top: (vh - h) / 2 };
  }
  addEventListener('resize', fit);

  // environment map: neon panels so metal paint reflects the city
  {
    const es = new THREE.Scene(); es.background = new THREE.Color(0x07090c);
    const r = NR.rng(7), cols = [0xc9584a, 0x4f9aa6, 0xd9953f, 0x9a6a7e, 0xe0b070, 0x7ab3b8];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2 + r() * 6, 1 + r() * 11), new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide }));
      const a = r() * Math.PI * 2, d = 12 + r() * 8; m.position.set(Math.cos(a) * d, -4 + r() * 18, Math.sin(a) * d); m.lookAt(0, 2, 0); es.add(m);
    }
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(es, 0.02).texture; scene.environmentIntensity = 1.6;
  }
  scene.add(new THREE.AmbientLight(0x404858, 0.7));
  const keyLight = new THREE.DirectionalLight(0x8a96a8, 0.8); keyLight.position.set(-1, 2, 1); scene.add(keyLight);

  // ---- pixel post pass: film grade + 18-colour palette + 4x4 Bayer dither ----
  const palGLSL = NR.PALETTE.map(h => `vec3(${((h >> 16) & 255) / 255},${((h >> 8) & 255) / 255},${(h & 255) / 255})`).join(',');
  const post = new THREE.ShaderMaterial({
    uniforms: { t: { value: null }, flash: { value: new THREE.Vector4(0, 0, 0, 0) }, exposure: { value: 1.35 } },
    vertexShader: 'varying vec2 v; void main(){ v=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: `uniform sampler2D t; uniform vec4 flash; uniform float exposure; varying vec2 v;
      float bayer(vec2 p){ int x=int(mod(p.x,4.)), y=int(mod(p.y,4.)); int i=x+y*4;
        float m[16]=float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.); return m[i]/16.-.5; }
      const int N=${NR.PALETTE.length}; vec3 P[N]=vec3[N](${palGLSL});
      void main(){ vec3 c=texture2D(t,v).rgb;
        float L=dot(c,vec3(.299,.587,.114));
        c=mix(vec3(L),c,.55);
        c=mix(c*vec3(.82,.98,1.05), c*vec3(1.10,.96,.80), smoothstep(.15,.7,L));
        c=pow(max(c*exposure,0.),vec3(1.08));
        c=mix(c,flash.rgb,flash.a);
        c+=bayer(gl_FragCoord.xy)*.06;
        float bd=1e9; vec3 best=P[0];
        for(int i=0;i<N;i++){ vec3 d=c-P[i]; float e=dot(d,d*vec3(1.,1.3,.8)); if(e<bd){bd=e;best=P[i];} }
        gl_FragColor=vec4(best,1.); }`,
  });
  const pscene = new THREE.Scene(), pcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  pscene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));

  // ---- core object ----
  const core = NR.core = {
    THREE, scene, camera, renderer, settings, isTouch, time: 0, dt: 0, state: 'TITLE',
    input: { mx: 0, my: 0, boost: false, siren: false, pause: false },
    speed: 0, scroll: 0, dist: 0, score: 0, best: +(safeLoad(C.BEST_KEY).score || 0), nearMisses: 0,
    district: 0, blend: { a: 0, b: 0, t: 0 }, loop: 0, view: null,
    camOffset: new THREE.Vector3(0, 4.2, 13.5), lookDrop: 17, // camera above/behind; look below the car so it rides at mid-screen, above the thumb controls
    shake(a, s) { shakeA = Math.max(shakeA, a); shakeT = Math.max(shakeT, s); },
    flash(hex, s, a = 0.6) { flashC.setHex(hex); flashT = flashMax = s; flashA = a; },
    saveSettings() { try { localStorage.setItem(C.SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} },
    setQuality(q) { settings.quality = q; core.saveSettings(); setRes(); },
    start() { startRun(); }, toTitle() { setState('TITLE'); }, pause(on) { if (core.state === 'PLAY' && on) setState('PAUSE'); else if (core.state === 'PAUSE' && !on) setState('PLAY'); },
  };
  let shakeA = 0, shakeT = 0, flashT = 0, flashMax = 1, flashA = 0; const flashC = new THREE.Color();
  setRes();

  const MODS = ['audio', 'world', 'traffic', 'player', 'fx', 'controls', 'ui'];
  const dead = {};
  function call(m, fn, ...a) {
    const mod = NR[m]; if (!mod || typeof mod[fn] !== 'function' || dead[m + fn]) return;
    try { return mod[fn](...a); } catch (e) { dead[m + fn] = true; console.error(`[NR.${m}.${fn}]`, e); }
  }
  function setState(s) { const prev = core.state; core.state = s; NR.bus.emit('state', { state: s, prev }); }

  function startRun() {
    core.speed = C.SPEED_START; core.dist = 0; core.score = 0; core.nearMisses = 0; core.district = 0; core.loop = 0;
    core.blend = { a: 0, b: 0, t: 0 }; chain = 0; chainT = 0;
    for (const m of MODS) call(m, 'reset', core);
    setState('PLAY'); NR.bus.emit('runStart', {}); NR.bus.emit('district', { index: 0, name: NR.DISTRICTS[0].name, loop: 0 });
  }
  // scoring
  let chain = 0, chainT = 0;
  NR.bus.on('nearMiss', d => {
    core.nearMisses++; chainT = C.CHAIN_WINDOW; chain = Math.min(chain + 1, 9);
    const pts = C.NEAR_MISS_POINTS * chain; core.score += pts; NR.bus.emit('score', { points: pts, reason: chain > 1 ? `NEAR MISS x${chain}` : 'NEAR MISS', pos: d && d.pos });
  });
  NR.bus.on('crash', () => {
    if (core.state !== 'PLAY') return;
    const best = Math.max(core.best, Math.floor(core.score)); const isBest = best > core.best; core.best = best;
    try { localStorage.setItem(C.BEST_KEY, JSON.stringify({ score: best })); } catch (e) {}
    setState('DEAD');
    NR.bus.emit('runEnd', { score: Math.floor(core.score), best, isBest, dist: Math.floor(core.dist), nearMisses: core.nearMisses, district: core.district, loop: core.loop });
  });

  function updateRun(dt) {
    const p = NR.player;
    const boost = p && p.boosting ? C.BOOST_ADD : 0;
    core.speed = Math.min(C.SPEED_MAX, core.speed + C.SPEED_RAMP * dt);
    const v = core.speed + boost;
    core.scroll = v * dt; core.dist += core.scroll;
    core.score += core.scroll * (1 + core.loop * 0.5);
    if (chainT > 0 && (chainT -= dt) <= 0) chain = 0;
    // districts
    const L = C.DISTRICT_LEN, n = NR.DISTRICTS.length;
    const idx = Math.floor(core.dist / L), into = core.dist - idx * L;
    const d = idx % n, loop = Math.floor(idx / n);
    if (d !== core.district || loop !== core.loop) { core.district = d; core.loop = loop; NR.bus.emit('district', { index: d, name: NR.DISTRICTS[d].name, loop }); }
    const t = into > L - C.BLEND_LEN ? (into - (L - C.BLEND_LEN)) / C.BLEND_LEN : 0;
    core.blend = { a: d, b: (d + 1) % n, t };
  }
  const fogA = new THREE.Color(), fogB = new THREE.Color();
  function applyBlend() {
    const A = NR.DISTRICTS[core.blend.a], B = NR.DISTRICTS[core.blend.b], t = core.blend.t;
    fogA.setHex(A.fog); fogB.setHex(B.fog); scene.fog.color.copy(fogA.lerp(fogB, t));
    scene.fog.density = A.density + (B.density - A.density) * t;
  }

  // camera: chase behind the player, lag, bank roll, boost FOV kick, shake
  const camPos = new THREE.Vector3(0, 3, 10.5), look = new THREE.Vector3();
  function updateCamera(dt) {
    const p = NR.player && NR.player.pos ? NR.player.pos : new THREE.Vector3();
    const tgt = new THREE.Vector3(p.x * 0.92, p.y + core.camOffset.y, p.z + core.camOffset.z);
    camPos.lerp(tgt, 1 - Math.exp(-dt * 9));
    camera.position.copy(camPos);
    look.set(p.x * 0.92, p.y + 4.6 - core.lookDrop, p.z - 40);
    camera.lookAt(look);
    camera.rotation.z += (NR.player && NR.player.bank ? NR.player.bank * 0.25 : 0);
    const fov = 70 + (NR.player && NR.player.boosting ? 12 : 0) + Math.min(8, (core.speed - C.SPEED_START) * 0.08);
    camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 4)); camera.updateProjectionMatrix();
    if (shakeT > 0) { shakeT -= dt; const k = shakeA * Math.max(0, shakeT); camera.position.x += (Math.random() - 0.5) * k; camera.position.y += (Math.random() - 0.5) * k; }
  }

  // ---- loop ----
  for (const m of MODS) call(m, 'init', core);
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now; // never negative (first-frame rAF timestamp)
    core.dt = dt; core.time += dt;
    const ctrl = NR.controls && NR.controls.state;
    core.input = ctrl || core.input;
    if (core.input.pause && (core.state === 'PLAY' || core.state === 'PAUSE')) core.pause(core.state === 'PLAY');
    const playing = core.state === 'PLAY';
    if (playing) updateRun(dt); else core.scroll = core.state === 'TITLE' ? 30 * dt : 0;
    applyBlend();
    for (const m of MODS) if (m !== 'ui') call(m, 'update', playing ? dt : (core.state === 'PAUSE' ? 0 : dt), core);
    updateCamera(dt);
    call('ui', 'update', dt, core);
    if (flashT > 0) { flashT -= dt; post.uniforms.flash.value.set(flashC.r, flashC.g, flashC.b, flashA * Math.max(0, flashT / flashMax)); } else post.uniforms.flash.value.w = 0;
    renderer.setRenderTarget(rt); renderer.render(scene, camera);
    renderer.setRenderTarget(null); post.uniforms.t.value = rt.texture; renderer.render(pscene, pcam);
  }
  requestAnimationFrame(frame);
  window.READY = true;
})();
