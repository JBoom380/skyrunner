// NEON RAIN player: the PATROL 47 cruiser. Flight, boost, siren, hits, crash. See SPEC.md "NR.player".
(function () {
  const C = NR.cfg;
  const SPARKS = 48;
  const START_Y = 8;

  let THREE, car, scene, glowTex, glows, sparks, sparkVel, sparkLife, sparkNext = 0;
  let boxObj, tmpN;
  let crashT = 0, crashV = 0, crashVy = 0, spinX = 0, spinZ = 0, sparkClock = 0, boostVis = 0, sirenFull = false;

  const P = NR.player = {
    pos: null, vel: null, bank: 0, pitch: 0, boosting: false, boostFuel: 1, siren: 0, hull: C.HULL, invuln: 0, alive: true, car: null,

    init(core) {
      THREE = core.THREE; scene = core.scene;
      P.pos = new THREE.Vector3(0, START_Y, 0); P.vel = new THREE.Vector3();
      boxObj = { min: new THREE.Vector3(), max: new THREE.Vector3() }; tmpN = new THREE.Vector3();
      if (typeof window.buildCruiser !== 'function') { console.warn('[NR.player] buildCruiser missing'); return; }
      car = P.car = window.buildCruiser(THREE);
      scene.add(car.group);
      buildGlows();
      buildSparks();
      NR.bus.on('nearMiss', onNearMiss);
      P.reset(core);
    },

    reset(core) {
      P.pos.set(0, START_Y, 0); P.vel.set(0, 0, 0);
      P.bank = 0; P.pitch = 0; P.boosting = false; P.boostFuel = 1; P.siren = 0; sirenFull = false;
      P.hull = C.HULL; P.invuln = 0; P.alive = true; crashT = 0; boostVis = 0;
      if (car) { car.group.visible = true; car.group.rotation.set(0, 0, 0); car.group.position.copy(P.pos); car.setBoost(0); }
      if (sparks) for (let i = 0; i < SPARKS; i++) { sparkLife[i] = 0; sparks[i].visible = false; }
    },

    box() {
      const p = P.pos;
      boxObj.min.set(p.x - 1.3, p.y - 0.7, p.z - 4.05);
      boxObj.max.set(p.x + 1.3, p.y + 0.7, p.z + 3.45);
      return boxObj;
    },

    update(dt, core) {
      if (!car) return;
      const t = core.time, st = core.state;
      if (st === 'TITLE') titleHover(dt, t);
      else if (st === 'PLAY' && P.alive) fly(dt, core);
      else if (!P.alive) crashFall(dt, core);
      // in PAUSE dt is 0: everything holds still
      car.update(t);
      boostVis += ((P.boosting ? 1 : 0) - boostVis) * Math.min(1, dt * 10);
      car.setBoost(boostVis);
      updateGlows(t);
      updateSparks(dt, core);
    },
  };

  // ---------- flight ----------
  function fly(dt, core) {
    const inp = core.input || {};
    const mx = clamp(+inp.mx || 0, -1, 1), my = clamp(+inp.my || 0, -1, 1);
    const k = 1 - Math.exp(-dt * 7);
    P.vel.x += (mx * C.STEER_SPEED - P.vel.x) * k;
    P.vel.y += (my * C.CLIMB_SPEED - P.vel.y) * k;
    P.pos.x += P.vel.x * dt; P.pos.y += P.vel.y * dt;
    // soft corridor walls
    if (P.pos.x < -C.LANE_X) { P.pos.x = -C.LANE_X; if (P.vel.x < 0) P.vel.x = 0; }
    if (P.pos.x > C.LANE_X) { P.pos.x = C.LANE_X; if (P.vel.x > 0) P.vel.x = 0; }
    if (P.pos.y < C.ALT_MIN) { P.pos.y = C.ALT_MIN; if (P.vel.y < 0) P.vel.y = 0; }
    if (P.pos.y > C.ALT_MAX) { P.pos.y = C.ALT_MAX; if (P.vel.y > 0) P.vel.y = 0; }
    P.pos.z = 0;

    // boost
    const want = !!inp.boost && P.boostFuel > (P.boosting ? 0 : 0.05);
    if (want) { P.boostFuel = Math.max(0, P.boostFuel - dt / C.BOOST_SECONDS); }
    else if (!inp.boost) P.boostFuel = Math.min(1, P.boostFuel + dt / C.BOOST_RECHARGE);
    const on = want && P.boostFuel > 0;
    if (on !== P.boosting) { P.boosting = on; NR.bus.emit('boost', { on }); }

    // siren
    if (inp.siren && P.siren >= 1) {
      if (NR.traffic && typeof NR.traffic.clearAhead === 'function') NR.traffic.clearAhead(C.SIREN_CLEAR);
      P.siren = 0; sirenFull = false;
      NR.bus.emit('siren', {});
    }

    // collisions
    if (P.invuln > 0) P.invuln = Math.max(0, P.invuln - dt);
    else {
      const b = P.box();
      let r = NR.world && typeof NR.world.collide === 'function' ? NR.world.collide(b) : null;
      if (!(r && r.hit)) r = NR.traffic && typeof NR.traffic.collide === 'function' ? NR.traffic.collide(b) : null;
      if (r && r.hit) takeHit(r, core);
    }

    // pose: bank into turns, nose pitch on climb/dive, yaw toward the stick, hover bob
    const tb = -P.vel.x / C.STEER_SPEED * 0.6;
    P.bank += (tb - P.bank) * Math.min(1, dt * 9);
    P.pitch += (P.vel.y / C.CLIMB_SPEED * 0.16 - P.pitch) * Math.min(1, dt * 8);
    const g = car.group;
    car.setBank(P.bank);
    g.rotation.x = P.pitch;
    g.rotation.y = -P.vel.x / C.STEER_SPEED * 0.1;
    g.position.set(P.pos.x, P.pos.y + Math.sin(core.time * 2.3) * 0.12, P.pos.z);
    g.visible = P.invuln > 0 ? (Math.floor(P.invuln * 14) % 2 === 0) : true;
  }

  function titleHover(dt, t) {
    P.pos.set(Math.sin(t * 0.35) * 1.2, START_Y + Math.sin(t * 0.7) * 0.4, 0);
    P.vel.set(0, 0, 0);
    P.bank = -Math.cos(t * 0.35) * 0.08; P.pitch = Math.sin(t * 0.7) * 0.03;
    const g = car.group;
    g.visible = true; car.setBank(P.bank); g.rotation.x = P.pitch; g.rotation.y = 0;
    g.position.set(P.pos.x, P.pos.y + Math.sin(t * 2.3) * 0.12, 0);
  }

  function takeHit(r, core) {
    P.hull = Math.max(0, P.hull - 1);
    P.invuln = C.INVULN;
    const n = r.normal;
    tmpN.set(n ? +n.x || 0 : 0, n ? +n.y || 0 : 0, 0);
    if (tmpN.lengthSq() < 0.04) tmpN.set(P.pos.x > 0 ? -1 : 1, 0.3, 0); // head-on: shove toward the corridor centre
    tmpN.normalize();
    P.vel.x = tmpN.x * 16; P.vel.y = tmpN.y * 11;
    P.pos.x += tmpN.x * 0.8; P.pos.y += tmpN.y * 0.8;
    if (core.shake) core.shake(0.6, 0.4);
    if (core.flash) core.flash(0xc9584a, 0.25);
    burst(P.pos.x, P.pos.y, P.pos.z - 2, 10, 10);
    NR.bus.emit('hit', { hull: P.hull, kind: r.kind || 'hit' });
    if (P.hull <= 0) crash(core);
  }

  function crash(core) {
    P.alive = false; P.boosting = false; P.invuln = 0;
    crashT = 0; crashV = 28; crashVy = 4;
    spinX = (Math.random() - 0.5) * 3; spinZ = (P.vel.x >= 0 ? -1 : 1) * (5 + Math.random() * 3);
    car.group.visible = true;
    NR.bus.emit('boost', { on: false });
    NR.bus.emit('crash', { pos: car.group.position });
    burst(P.pos.x, P.pos.y, P.pos.z, 24, 16);
  }

  function crashFall(dt, core) {
    if (dt <= 0) return;
    const g = car.group;
    crashT += dt;
    if (!g.visible) return;
    crashV *= Math.exp(-dt * 0.9); crashVy -= 22 * dt;
    g.position.z -= crashV * dt; g.position.y += crashVy * dt; g.position.x += P.vel.x * 0.3 * dt;
    g.rotation.x += spinX * dt; g.rotation.z += spinZ * dt; g.rotation.y += spinX * 0.5 * dt;
    sparkClock -= dt;
    if (sparkClock <= 0) { sparkClock = 0.03; burst(g.position.x, g.position.y, g.position.z, 2, 6); }
    if (g.position.y < -38 || crashT > 4) g.visible = false;
  }

  function onNearMiss() {
    const core = NR.core;
    if (!P.alive || (core && core.state !== 'PLAY')) return;
    P.siren = Math.min(1, P.siren + C.SIREN_PER_MISS);
    if (P.siren >= 1 && !sirenFull) { sirenFull = true; NR.bus.emit('sirenReady', {}); }
  }

  // ---------- glow sprites on the car (approved car sheet look) ----------
  function buildGlows() {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    glowTex = new THREE.CanvasTexture(c);
    const mk = (px, py, pz, col, s, op = 0.55) => {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: op, fog: false }));
      m.position.set(px, py, pz); m.scale.set(s, s, 1); car.group.add(m); return m;
    };
    glows = {
      thr: mk(0, -0.35, 4.15, 0x3aa8ff, 3),
      beacon: mk(0, 1.2, 0.95, 0xffa020, 3),
      red: mk(-0.76, 1.15, 1.05, 0xff1030, 2.2),
      blue: mk(0.76, 1.15, 1.05, 0x2050ff, 2.2),
      pods: [[-1.25, -0.8, -4.25], [1.25, -0.8, -4.25], [-0.95, -0.95, 2.55], [0.95, -0.95, 2.55]].map(([a, b, d]) => mk(a, b, d, 0x3aa8ff, 2.4)),
    };
  }

  function updateGlows(t) {
    if (!glows) return;
    const ph = Math.floor(t * 6) % 2; // same phase as cruiser.update light bar
    glows.red.material.opacity = ph ? 0.12 : 0.75; glows.blue.material.opacity = ph ? 0.75 : 0.12;
    const s = 3 + 4 * boostVis; glows.thr.scale.set(s, s, 1); glows.thr.material.opacity = 0.55 + 0.3 * boostVis;
    const pf = 2.4 + Math.sin(t * 40) * 0.15 + boostVis * 0.6;
    for (const p of glows.pods) p.scale.set(pf, pf, 1);
    glows.beacon.material.opacity = 0.45 + 0.15 * Math.sin(t * 9);
  }

  // ---------- pooled sparks (hit spray, damage trail, crash fall) ----------
  function buildSparks() {
    sparks = []; sparkVel = new Float32Array(SPARKS * 3); sparkLife = new Float32Array(SPARKS);
    const cols = [0xffd080, 0xffa040, 0xfff0d0];
    for (let i = 0; i < SPARKS; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: cols[i % 3], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 1, fog: false }));
      m.visible = false; scene.add(m); sparks.push(m);
    }
  }

  function burst(x, y, z, n, spd) {
    if (!sparks) return;
    for (let k = 0; k < n; k++) {
      const i = sparkNext; sparkNext = (sparkNext + 1) % SPARKS;
      const s = sparks[i]; s.position.set(x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5), z + (Math.random() - 0.5) * 3);
      sparkVel[i * 3] = (Math.random() - 0.5) * spd; sparkVel[i * 3 + 1] = Math.random() * spd * 0.6; sparkVel[i * 3 + 2] = (Math.random() - 0.3) * spd;
      sparkLife[i] = 0.35 + Math.random() * 0.4; s.visible = true;
    }
  }

  function updateSparks(dt, core) {
    if (!sparks) return;
    // damaged cruiser trails sparks from the tail at hull 1
    if (core.state === 'PLAY' && P.alive && P.hull === 1 && dt > 0) {
      sparkClock -= dt;
      if (sparkClock <= 0) { sparkClock = 0.06 + Math.random() * 0.12; burst(P.pos.x, P.pos.y - 0.3, P.pos.z + 3.6, 1, 5); }
    }
    const scroll = core.scroll || 0;
    for (let i = 0; i < SPARKS; i++) {
      if (sparkLife[i] <= 0) continue;
      const s = sparks[i];
      sparkLife[i] -= dt;
      if (sparkLife[i] <= 0) { s.visible = false; continue; }
      sparkVel[i * 3 + 1] -= 18 * dt;
      s.position.x += sparkVel[i * 3] * dt; s.position.y += sparkVel[i * 3 + 1] * dt; s.position.z += sparkVel[i * 3 + 2] * dt + scroll;
      const sc = 0.35 + sparkLife[i] * 1.2; s.scale.set(sc, sc, 1);
    }
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
})();
