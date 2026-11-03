// SKYRUNNER quarry: the getaway car the player chases in PURSUIT mode (HUD name: RUNAWAY REPLICANT).
// NR.quarry = { init, update, reset, active, gap (bumper to bumper, m), pos, box(), trick(type, hold), boost(), state() }
// Treadmill rules: the player stays at z = 0; the quarry keeps its own gap state and sits at z = -(gap + nose + half length).
// It plans a clear line 0.6 / 1.2 / 2.0 s ahead (world.collide for obstacles, an analytic sweep for live traffic cars)
// and never touches anything. Tricks (barrel roll, juke) and boosts start only when the whole look-ahead is clear.
// Draw calls: body, lights, flame, trail (4). The HUD is DOM inside #ui. No per-frame allocation.
(function () {
  window.NR = window.NR || {};
  const C = NR.cfg, Q = C.QUARRY;
  const NOSE = 4.05, S = 1.6;               // player nose offset, model scale (readability at 360x640)
  const HALF = 2.9 * S, HW = 1.15 * S, HH = 0.55 * S; // quarry half length / width / height (scaled)
  const TRAIL_N = 14;
  const ease = t => 0.5 - 0.5 * Math.cos(Math.PI * t);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rr = (a, b) => a + Math.random() * (b - a);

  let THREE, core, scene, grp, body, lights, flame, trail, trailPos, trailCol, flameMat;
  let hud, tagEl, ringEl, chevEl, chevLbl, lastTxt = '', lastMode = 0;
  let gap = Q.startGap, x = 0, y = 12, tx = 0, ty = 12, vzq = 0;
  let t = 0, tickT = 0, surgeT = 0, tailT = 0, tailAcc = 0;
  let boostT = 0, boostLen = 0, boostVis = 0, boostCool = 0, boostNext = 0, boostReact = -1, boostWant = 0;
  let trickNext = 0, trickType = 0, trickT = 0, trickDur = 0, trickDir = 1, trickHold = false, rollAng = 0, offX = 0, trickAmp = 0;
  let pend = 0, pendT = 0, slipT = 0;
  let phA = 0, phB = 0, phC = 0, phD = 0, phE = 0;
  let trailClock = 0, nSamp = 0;
  let xm = 0.7;                              // lateral planning margin (grows during tricks)
  let ok = false;
  const sx = new Float32Array(2 * TRAIL_N), sy = new Float32Array(2 * TRAIL_N), sz = new Float32Array(2 * TRAIL_N);
  const bx = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  const qb = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  let v3;

  const Qo = NR.quarry = {
    active: false, gap: Q.startGap, pos: null, hits: 0,
    init(c) {
      core = c; THREE = c.THREE; scene = c.scene;
      v3 = new THREE.Vector3(); Qo.pos = new THREE.Vector3();
      try { build(); buildHud(); ok = true; } catch (e) { console.error('[NR.quarry.build]', e); return; }
      NR.bus.on('hit', () => { if (Qo.active) slipT = Q.slipTime; });
      NR.bus.on('boost', d => { if (d && d.on && Qo.active && boostT <= 0) boostReact = Q.reactDelay; });
    },
    reset(c) {
      core = c || core;
      Qo.active = !!(ok && core.mode === 'pursuit');
      gap = Q.startGap; Qo.gap = gap; x = 0; y = 12; tx = 0; ty = 12; surgeT = 0; tailT = 0; tailAcc = 0; t = 0; tickT = 0;
      boostT = 0; boostVis = 0; boostCool = 2; boostNext = rr(Q.boostMin, Q.boostMax); boostReact = -1; boostWant = 0;
      trickType = 0; trickT = 0; rollAng = 0; offX = 0; trickHold = false; trickNext = rr(Q.trickMin, Q.trickMax); pend = 0;
      phA = Math.random() * 6.28; phB = Math.random() * 6.28; phC = Math.random() * 6.28; phD = Math.random() * 6.28; phE = Math.random() * 6.28;
      trailClock = 0; nSamp = 0; Qo.hits = 0; vxs = vys = 0; hidT = 0; slipT = 0;
      if (NR.player && NR.player.pos) x = tx = NR.player.pos.x;
      place(); resetTrail(); show(Qo.active && false);
    },
    update(dt, c) {
      core = c || core; if (!ok) return;
      const st = core.state;
      if (!Qo.active || (st !== 'PLAY' && st !== 'PAUSE')) { show(false); return; }
      if (st === 'PLAY' && dt > 0) step(dt);
      place(); animate(dt);
      show(true); updateHud();
    },
    // collision box in the player's frame
    box() { const zc = zCenter(); const px = px_(); qb.min.x = px - HW; qb.max.x = px + HW; qb.min.y = y - HH; qb.max.y = y + HH; qb.min.z = zc - HALF; qb.max.z = zc + HALF; return qb; },
    // debug hooks: type 'roll' | 'juke'; hold = freeze the roll at mid-turn until trick(null)
    trick(type, hold) { if (!type) { trickHold = false; return; } trickHold = !!hold; startTrick(type === 'juke' ? 2 : 1, Math.random() < 0.5 ? -1 : 1); },
    boost() { startBoost(); },
    dbgEval(cx, cy) { buildHz(vzq); return [evaluate(cx, cy, vzq), vzq]; },
    dbgHz() { return Array.from(HBX.slice(0, nh * 6)); },
    state() { return { gap, x, y, boostT, trickType, trickT, rollAng, tx, ty, boostVis, offX }; },
    setPose(nx, ny, g) { x = tx = nx; y = ty = ny; if (g) gap = g; Qo.gap = gap; place(); },
  };

  function px_() { return clamp(x + offX, -17.9, 17.9); }
  function zCenter() { return -(gap + NOSE + HALF); }

  // ---------------- planning ----------------
  function worldHit(x0, x1, y0, y1, z0, z1) {
    if (!NR.world || !NR.world.collide) return false;
    for (let i = 0; i < nh; i++) { const o = i * 6; if (HBX[o] <= x1 && HBX[o + 1] >= x0 && HBX[o + 2] <= y1 && HBX[o + 3] >= y0 && HBX[o + 4] <= z1 && HBX[o + 5] >= z0) return true; }
    bx.min.x = x0; bx.max.x = x1; bx.min.y = y0; bx.max.y = y1; bx.min.z = z0; bx.max.z = z1;
    return NR.world.collide(bx).hit;
  }
  // predicted hazard boxes at the moment the quarry reaches each hazard (they are timed for the player, who arrives about a gap later)
  const HBX = new Float32Array(6 * 96); let nh = 0;
  function hb(x0, x1, y0, y1, z0, z1) { if (nh >= 96) return; const o = nh * 6; HBX[o] = x0; HBX[o + 1] = x1; HBX[o + 2] = y0; HBX[o + 3] = y1; HBX[o + 4] = z0; HBX[o + 5] = z1; nh++; }
  const sstep = (a, b, v) => { const k = clamp((v - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  function buildHz(vq) {
    nh = 0; const W = NR.world; if (!W || !W.hazardRaw) return;
    const HZ = W.hazardRaw(), trav = W.travelNow(), zq = zCenter(), P = NR.player;
    const v = Math.max(30, (core.speed || 60) + (P && P.boosting ? C.BOOST_ADD : 0)), taArr = -zq / v, t0 = core.time;
    const AMIN = C.ALT_MIN, AMAX = C.ALT_MAX, LX = C.LANE_X;
    for (let i = 0; i < HZ.length; i++) {
      const h = HZ[i], zH = trav - h.q, dist = zq - zH;
      if (dist < -HALF - 3 || dist > vq * Q.lookT + 60) continue;
      const tArr = Math.max(0, dist / vq), tA = t0 + tArr, unc = 0.05 + 0.1 * tArr; // arrival-time error grows with distance
      switch (h.kind) {
        case 'drone': for (let s = -1; s <= 1; s++) { const tt = tA + s * (0.2 + unc), dx = h.x + h.a * Math.sin(tt * h.w + h.ph), dy = h.y + 0.6 * Math.sin(tt * 2.1 + h.ph); hb(dx - 2.4, dx + 2.4, dy - 0.65, dy + 0.6, zH - 1.4, zH + 1.4); } break;
        case 'swing': for (let s = -1; s <= 1; s++) {
          const tt = tA + s * (0.2 + unc), th = h.a * Math.sin(tt * h.w + h.ph), cx = h.b * Math.sin(th), cy = h.y - h.b * Math.cos(th), c = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th));
          const hx = (6.5 * c + 3 * sn) * 0.88, hy = (6.5 * sn + 3 * c) * 0.88; hb(cx - hx, cx + hx, cy - hy, cy + hy, zH - 0.9, zH + 0.9); } break;
        case 'drop': if (taArr < 2.4) hb(-95, 95, h.y - 1.25, 1000, zH - 1.6, zH + 1.6); break;
        case 'flame': { const p = (((tA + h.ph) % 3.6) + 3.6) % 3.6; if (p >= 1.8 - unc || p < 0.4 + unc) { const xa = h.x - h.s * 2.8, xb = h.x - h.s * (2.8 + h.a); hb(Math.min(xa, xb), Math.max(xa, xb), h.y - 2.1, h.y + 2.1, zH - 2.1, zH + 2.1); } break; }
        case 'laser': { const fx = LX + 2.5, ylo = AMIN - 5, yhi = AMAX + 5, g0 = h.a - h.b / 2, g1 = h.a + h.b / 2;
          if (h.s === 1) { hb(-fx, g0 + 0.1, ylo, yhi, zH - 0.8, zH + 0.8); hb(g1 - 0.1, fx, ylo, yhi, zH - 0.8, zH + 0.8); }
          else { hb(-fx, fx, ylo, g0 + 0.1, zH - 0.8, zH + 0.8); hb(-fx, fx, g1 - 0.1, yhi, zH - 0.8, zH + 0.8); } break; }
        case 'shutter': { const k = sstep(2.3, 1.2, taArr - 0.4), hw = 27 + (h.b / 2 - 27) * k; if (hw >= LX + 2) break;
          let lo = -1e9, hi = 1e9; for (let s = -1; s <= 1; s++) { const gc = k * h.a * Math.sin((tA + s * unc) * h.w + h.ph); lo = Math.max(lo, gc - hw); hi = Math.min(hi, gc + hw); }
          hb(-95, lo, AMIN - 10, AMAX + 10, zH - 0.75, zH + 0.75); hb(hi, 95, AMIN - 10, AMAX + 10, zH - 0.75, zH + 0.75); break; }
        case 'debris': for (let k = 0; k < h.n; k++) { if (taArr < 1.38 + k * 0.06 + h.a + 0.8) { const x = h.xs[k], r = h.ys[k] * 0.45 + 0.4; hb(x - r, x + r, AMIN - 10, AMAX + 8, zH - r, zH + r); } } break;
        case 'lightning': for (let k = 0; k < h.n; k++) { const x = h.xs[k], r = h.a * 0.85 + 0.5; hb(x - r, x + r, AMIN - 5, 400, zH - r, zH + r); } break;
      }
    }
  }
  // live traffic: car i closes on the quarry at relz = (car ground z-speed) + quarry speed; blocked if the z windows overlap within T
  function trafficHit(xa, xb, ya, yb, T, vq) {
    const cars = NR.traffic && NR.traffic.cars; if (!cars) return false;
    const zq = zCenter();
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]; if (!car.def) continue;
      const h = car.def.half, cy = car.y + car.def.cy, m = Q.carMargin;
      const ca = Math.min(car.x, car.tx === undefined ? car.x : car.tx, car.lcTo === undefined || !car.lc ? car.x : car.lcTo) - h[0] - m;
      const cb = Math.max(car.x, car.tx === undefined ? car.x : car.tx, car.lcTo === undefined || !car.lc ? car.x : car.lcTo) + h[0] + m;
      if (cb < xa || ca > xb) continue;
      if (cy + h[1] + m < ya || cy - h[1] - m > yb) continue;
      const R = h[2] + HALF + Q.carMargin * 2, d0 = car.z - zq, rel = (car.dir > 0 ? -car.speed : car.speed) + vq;
      if (Math.abs(d0) < R) return true;
      if (d0 * rel < 0 && (Math.abs(d0) - R) / Math.abs(rel) <= T) return true;
    }
    return false;
  }
  // free levels for a target: -1 near segment blocked; else 0..2 count of the farther segments that are clear
  let colOnly = false;
  function evaluate(cx, cy, vq, extra) {
    const m = xm + (extra || 0), zq = zCenter();
    const dx = Math.abs(cx - x), dy = Math.abs(cy - y);
    const tt = Math.max(dx / 26, dy / 18) + 0.15;
    const xa = (colOnly ? cx : Math.min(x, cx)) - HW - m, xb = (colOnly ? cx : Math.max(x, cx)) + HW + m, ya = (colOnly ? cy : Math.min(y, cy)) - HH - 0.6, yb = (colOnly ? cy : Math.max(y, cy)) + HH + 0.6;
    const L1 = Math.max(vq * tt, 30), ca = cx - HW - m, cb = cx + HW + m, cya = cy - HH - 0.6, cyb = cy + HH + 0.6;
    // near: the transit region (span box) must be clear, and the destination column for the first 0.6 s
    if (worldHit(xa, xb, ya, yb, zq - L1, zq + HALF + 1) || trafficHit(xa, xb, ya, yb, tt, vq)) return -1;
    if (worldHit(ca, cb, cya, cyb, zq - vq * 0.9, zq + HALF + 1) || trafficHit(ca, cb, cya, cyb, 0.9, vq)) return -1;
    let n = 0;
    if (!worldHit(ca, cb, cya, cyb, zq - vq * 1.2, zq + HALF) && !trafficHit(ca, cb, cya, cyb, 1.2, vq)) {
      n = 1;
      if (!worldHit(ca, cb, cya, cyb, zq - vq * Q.lookT, zq + HALF) && !trafficHit(ca, cb, cya, cyb, Q.lookT, vq)) n = 2;
    }
    return n;
  }
  const WP = [0, 0];
  function wander() { // smooth low-frequency weave
    WP[0] = Q.wanderX * (0.6 * Math.sin(t * 0.37 + phA) + 0.4 * Math.sin(t * 0.91 + phB));
    WP[1] = Q.yMid + Q.wanderY * (0.6 * Math.sin(t * 0.29 + phC) + 0.4 * Math.sin(t * 0.73 + phD));
  }
  function plan(vq) {
    wander();
    const evW = evaluate(WP[0], WP[1], vq);
    if (evW === 2) { tx = WP[0]; ty = WP[1]; return; }
    const evC = evaluate(tx, ty, vq);
    if (evC === 2) return;
    // search the corridor grid: coarse sweep first, then a fine grid, then (nothing clear from here) the clearest column
    if (search(4, 4, false, WP[0], WP[1], vq) || search(2, 2, false, WP[0], WP[1], vq)) return;
    if (evW >= 0) { tx = WP[0]; ty = WP[1]; return; }
    search(2, 2, true, x, y, vq);
  }
  function search(dx, dy, column, ox, oy, vq) {
    colOnly = column; let bestC = 1e9, bx_ = 0, by_ = 0, bestEv = -1;
    for (let cx = -Q.xLim; cx <= Q.xLim + 0.01; cx += dx) {
      for (let cy = Q.yLo; cy <= Q.yHi + 0.01; cy += dy) {
        const ev = evaluate(cx, cy, vq); if (ev < 0) continue;
        const cost = column ? Math.hypot(cx - x, cy - y) - 60 * ev : Math.hypot(cx - ox, cy - oy) * 0.6 + Math.hypot(cx - x, cy - y) * 0.4 - 60 * ev;
        if (cost < bestC) { bestC = cost; bx_ = cx; by_ = cy; bestEv = ev; }
      }
    }
    colOnly = false;
    if (bestEv >= 0) { tx = bx_; ty = by_; return true; }
    return false;
  }

  // ---------------- tricks and boost ----------------
  function startTrick(type, dir) { trickType = type; trickT = 0; trickDir = dir; trickDur = type === 1 ? Q.rollDur : Q.jukeDur; trickAmp = type === 1 ? Q.rollShift : Q.jukeAmp; xm = 0.7 + trickAmp + 0.3; if (type === 1 && NR.audio && NR.audio.quarryRoll && Qo.pos) NR.audio.quarryRoll(panOf(), gap); }
  function stepTrick(dt) {
    if (trickType === 0) return;
    if (!(trickHold && trickType === 1 && trickT >= trickDur * 0.5)) trickT = Math.min(trickDur, trickT + dt);
    const k = trickT / trickDur;
    if (trickType === 1) { rollAng = -trickDir * Math.PI * 2 * ease(k); offX = trickDir * trickAmp * Math.sin(Math.PI * ease(k)); }
    else { offX = trickDir * trickAmp * Math.sin(Math.PI * Math.sqrt(k)) ; rollAng = -trickDir * 0.35 * Math.sin(Math.PI * k); }
    if (trickT >= trickDur && !trickHold) { trickType = 0; rollAng = 0; offX = 0; xm = 0.7; }
  }
  function startBoost() {
    if (boostT > 0) return; boostLen = rr(Q.boostLenMin, Q.boostLenMax); boostT = boostLen; boostNext = rr(Q.boostMin, Q.boostMax);
    if (NR.audio && NR.audio.quarryBoost) { NR.audio.quarryBoost(true, panOf(), gap); }
  }
  function canStart(vq, extra, lookT) {
    buildHz(vq); // whole look-ahead clear
    const m = xm + extra, zq = zCenter();
    const ca = x + offX - HW - m, cb = x + offX + HW + m, cya = y - HH - 0.6, cyb = y + HH + 0.6;
    if (Math.abs(tx - x) > 3 || Math.abs(ty - y) > 3) return false;
    if (worldHit(ca, cb, cya, cyb, zq - vq * lookT, zq + HALF)) return false;
    return !trafficHit(ca, cb, cya, cyb, lookT, vq);
  }

  // ---------------- per-frame motion ----------------
  function step(dt) {
    t += dt; const vN = core.speed || C.SPEED_START, vp = dt > 0 ? core.scroll / dt : vN;
    // gap controller: hold a wandering rest gap (60 to 90 m); pull away when the player slips; push and boost when it gets close
    const goal = slipT > 0 || (NR.player && NR.player.boostFuel < 0.15) ? Q.slipGap : Q.restMid + Q.restHalf * Math.sin(t * 0.2 + phE);
    if (slipT > 0) slipT -= dt;
    const s = clamp((goal - gap) / Q.easeRange, -1, 1);
    let vq = vN * (1 + (s >= 0 ? (goal === Q.slipGap ? Q.slipFaster : Q.topFaster) : Q.easeOff) * s);
    if (gap < Q.closeGap) vq += (Q.closeGap - gap) * Q.surgeK;
    if (surgeT > 0) { vq += Q.surgeAdd * Math.min(1, surgeT * 2); surgeT -= dt; }
    // own boost
    if (boostT > 0) {
      boostT -= dt; if (boostT <= 0) { boostT = 0; boostCool = 3; }
    }
    const env = boostT > 0 ? Math.min(1, (boostLen - boostT) / 0.2, boostT / 0.5) : 0;
    boostVis += ((boostT > 0 ? 1 : 0) - boostVis) * Math.min(1, dt * 10);
    vq += Q.boostAdd * env * clamp((Q.restMid + Q.restHalf + 20 - gap) / 20, 0, 1); // the burst fades out as it nears the far end of the rest band
    gap += (vq - vp) * dt;
    if (gap < Q.minGap) { gap = Q.minGap; surgeT = 0.8; }
    if (gap > Q.capGap) gap = Q.capGap;
    Qo.gap = gap; vzq = vq;
    // boost triggers: player boost (after a reaction delay), closing under one car length, random timer
    if (boostCool > 0) boostCool -= dt;
    boostNext -= dt;
    if (boostT <= 0 && boostCool <= 0) {
      if (boostReact >= 0) { boostReact -= dt; if (boostReact < 0) { boostWant = 1; pend = 0; } }
      if (gap < Q.closeGap) boostWant = Math.max(boostWant, 1);
      if (boostNext <= 0 && gap < Q.restMid + Q.restHalf + 15) boostWant = Math.max(boostWant, 1);
      if (boostWant && (pendT -= dt) <= 0) {
        pendT = 0.25;
        if (canStart(vq + Q.boostAdd, 0.5, Q.lookT)) { startBoost(); boostWant = 0; }
        else if (++pend > 12) { boostWant = 0; pend = 0; }
      }
    }
    // tricks
    stepTrick(dt);
    if (trickType === 0) {
      trickNext -= dt;
      if (trickNext <= 0) {
        const dir = Math.random() < 0.5 ? -1 : 1, type = Math.random() < 0.5 ? 1 : 2, amp = type === 1 ? Q.rollShift : Q.jukeAmp;
        const save = xm; xm = 0.7 + amp + 0.3;
        const fine = Math.abs(x + dir * amp) < Q.xLim + 1 && canStart(vq, amp + 0.3, Math.max(trickDurOf(type) + 0.5, 1.2));
        xm = save;
        if (fine) { startTrick(type, dir); trickNext = rr(Q.trickMin, Q.trickMax); }
        else trickNext = rr(1, 2);
      }
    }
    // planning at 20 Hz
    tickT -= dt; if (tickT <= 0) { tickT = 0.05; buildHz(vq); plan(vq); }
    // steer toward the target with a speed limit
    let ux = (tx - x) * 14, uy = (ty - y) * 14;
    ux = clamp(ux, -Q.steerX, Q.steerX); uy = clamp(uy, -Q.steerY, Q.steerY);
    const k = 1 - Math.exp(-dt * 24);
    vxs += (ux - vxs) * k; vys += (uy - vys) * k;
    x += vxs * dt; y += vys * dt;
    x = clamp(x, -Q.xLim, Q.xLim); y = clamp(y, Q.yLo, Q.yHi);
    safety();
    // tailing score
    if (gap < Q.tailGap) { tailT += dt; if (tailT >= Q.tailEvery) { tailT = 0; core.score += Q.tailPoints; NR.bus.emit('score', { points: Q.tailPoints, reason: 'TAILING', pos: Qo.pos }); } }
    else tailT = 0;
  }
  let vxs = 0, vys = 0;
  // last line of defence: if the plan still left the car overlapping anything right now, slide to the nearest free spot
  const sb = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  function overlapsNow(px, py) {
    const zc = zCenter(); sb.min.x = px - HW; sb.max.x = px + HW; sb.min.y = py - HH; sb.max.y = py + HH; sb.min.z = zc - HALF; sb.max.z = zc + HALF;
    if (NR.world && NR.world.collide && NR.world.collide(sb).hit) return true;
    const cars = NR.traffic && NR.traffic.cars; if (!cars) return false;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]; if (!c.def) continue; const h = c.def.half, cy = c.y + c.def.cy, m = 0.1;
      if (sb.min.x < c.x + h[0] + m && sb.max.x > c.x - h[0] - m && sb.min.y < cy + h[1] + m && sb.max.y > cy - h[1] - m && sb.min.z < c.z + h[2] + m && sb.max.z > c.z - h[2] - m) return true;
    }
    return false;
  }
  const DIRS = [1, 0, -1, 0, 0, 1, 0, -1, 0.7, 0.7, -0.7, 0.7, 0.7, -0.7, -0.7, -0.7];
  function safety() {
    if (!overlapsNow(px_(), y)) return;
    for (let r = 1.0; r <= 14; r += 1.0) {
      for (let d = 0; d < DIRS.length; d += 2) {
        const nx = clamp(x + DIRS[d] * r, -Q.xLim, Q.xLim), ny = clamp(y + DIRS[d + 1] * r, Q.yLo, Q.yHi);
        if (!overlapsNow(clamp(nx + offX, -17.9, 17.9), ny)) { x = tx = nx; y = ty = ny; vxs = vys = 0; Qo.hits++; return; }
      }
    }
    // nothing free nearby (a closed gate far from here): take the nearest free spot anywhere in the corridor
    let bd = 1e9, bxx = x, byy = y;
    for (let cx = -Q.xLim; cx <= Q.xLim + 0.01; cx += 1) for (let cy = Q.yLo; cy <= Q.yHi + 0.01; cy += 1) {
      const d = Math.hypot(cx - x, cy - y); if (d < bd && !overlapsNow(clamp(cx + offX, -17.9, 17.9), cy)) { bd = d; bxx = cx; byy = cy; }
    }
    if (bd < 1e9) { x = tx = bxx; y = ty = byy; vxs = vys = 0; Qo.hits++; Qo.farSlides = (Qo.farSlides || 0) + 1; }
  }
  function trickDurOf(type) { return type === 1 ? Q.rollDur : Q.jukeDur; }

  function panOf() { v3.copy(Qo.pos).project(core.camera); return clamp(v3.x, -1, 1); }

  // ---------------- model ----------------
  function box3(list, w, h, l, col, px, py, pz, o) {
    let g = new THREE.BoxGeometry(w, h, l); o = o || {};
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let X = p.getX(i), Y = p.getY(i); const Z = p.getZ(i), front = Z < 0, top = Y > 0;
      if (front && top && o.ft) Y -= o.ft;
      if (front && o.fw) X *= o.fw;
      if (top && o.tw) X *= o.tw;
      if (!front && top && o.bt) Y -= o.bt;
      p.setXY(i, X, Y);
    }
    g = g.toNonIndexed(); g.translate(px, py, pz);
    if (o.rz) { g.translate(-px, -py, -pz); g.rotateZ(o.rz); g.translate(px, py, pz); }
    const n = g.attributes.position.count, c = new Float32Array(n * 3), cc = new THREE.Color(col);
    for (let i = 0; i < n; i++) { c[i * 3] = cc.r * (o.k || 1); c[i * 3 + 1] = cc.g * (o.k || 1); c[i * 3 + 2] = cc.b * (o.k || 1); }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.computeVertexNormals(); list.push(g);
  }
  function merge(list, normals) {
    let n = 0; for (const g of list) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
    for (const g of list) { pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); col.set(g.attributes.color.array, o); o += g.attributes.position.count * 3; g.dispose(); }
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); if (normals) m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    m.setAttribute('color', new THREE.BufferAttribute(col, 3)); m.computeBoundingSphere(); return m;
  }
  function build() {
    grp = new THREE.Group(); grp.visible = false; grp.scale.setScalar(S); scene.add(grp);
    const B = [], L = [];
    const PAINT = 0x52636e, GLASS = 0x0c1820, TRIMC = 0x1a2126, BONE = 0xc8b890;
    box3(B, 2.3, 0.5, 5.6, PAINT, 0, 0, 0, { fw: 0.5, ft: 0.18 });                 // hull, narrow nose
    box3(B, 1.5, 0.48, 2.4, GLASS, 0, 0.42, 0.55, { tw: 0.7, ft: 0.3 });             // canopy
    box3(B, 1.0, 0.07, 1.5, PAINT, 0, 0.7, 0.75);                                   // roof pad
    box3(B, 0.08, 0.1, 5.0, BONE, -1.12, 0.05, 0.1); box3(B, 0.08, 0.1, 5.0, BONE, 1.12, 0.05, 0.1); // side stripes
    box3(B, 0.12, 0.9, 1.3, TRIMC, -1.05, 0.55, 2.2, { rz: 0.18 }); box3(B, 0.12, 0.9, 1.3, TRIMC, 1.05, 0.55, 2.2, { rz: -0.18 }); // twin tail fins
    box3(B, 2.5, 0.07, 0.55, PAINT, 0, 1.0, 2.5);                                   // wing
    box3(B, 0.16, 0.05, 1.5, BONE, -0.3, 0.74, 0.75); box3(B, 0.16, 0.05, 1.5, BONE, 0.3, 0.74, 0.75); // roof stripes
    for (const sx_ of [-1, 1]) for (const z of [-1.9, 1.7]) box3(B, 0.5, 0.3, 1.1, TRIMC, sx_ * 1.0, -0.35, z); // pods
    body = new THREE.Mesh(merge(B, true), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.45, envMapIntensity: 1.2, emissive: 0x46555e, emissiveIntensity: 1 }));
    grp.add(body);
    // lights: full-width tail bar, two lamps, faint head strip (self-lit)
    const R = 0xc81818, RIM = 0x7fe0ec;
    box3(L, 2.1, 0.3, 0.12, R, 0, 0.2, 2.84, { k: 1.0 });                            // tail bar
    box3(L, 0.75, 0.5, 0.18, R, -0.82, 0.14, 2.84, { k: 0.95 }); box3(L, 0.75, 0.5, 0.18, R, 0.82, 0.14, 2.84, { k: 0.95 }); // big lamps
    box3(L, 0.9, 0.05, 0.05, 0xd8c8a0, 0, 0.0, -2.82, { k: 0.8 });
    box3(L, 0.14, 0.26, 0.2, R, -1.12, 1.0, 2.6, { k: 1.0 }); box3(L, 0.14, 0.26, 0.2, R, 1.12, 1.0, 2.6, { k: 1.0 }); // fin tips
    // thin rim light along the roofline, hull edges and wing so the dark body separates from the city
    box3(L, 0.13, 0.1, 5.2, RIM, -1.1, 0.29, 0.0, { k: 1.1 }); box3(L, 0.13, 0.1, 5.2, RIM, 1.1, 0.29, 0.0, { k: 1.1 });
    box3(L, 0.1, 0.08, 2.0, RIM, -0.55, 0.7, 0.55, { k: 1.1 }); box3(L, 0.1, 0.08, 2.0, RIM, 0.55, 0.7, 0.55, { k: 1.1 });
    box3(L, 2.5, 0.08, 0.1, RIM, 0, 1.04, 2.2, { k: 1.1 });
    lights = new THREE.Mesh(merge(L, false), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
    grp.add(lights);
    // afterburner: two cones, white-blue at the nozzle fading to black at the tip (additive)
    const F = [];
    for (const sx_ of [-0.6, 0.6]) {
      for (const [r, len, k] of [[0.16, 1.7, 0.75], [0.08, 1.0, 0.8]]) {
        let g = new THREE.ConeGeometry(r, len, 12, 1, true); g.translate(0, len / 2, 0); g.rotateX(Math.PI / 2); g.translate(sx_, 0.0, 2.85);
        const n = g.attributes.position.count, c = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { const f = clamp((g.attributes.position.getZ(i) - 2.85) / len, 0, 1), a = (1 - f) * k; c[i * 3] = (k > 0.77 ? 0.55 : 0.25) * a; c[i * 3 + 1] = (k > 0.77 ? 0.75 : 0.5) * a; c[i * 3 + 2] = 1.0 * a; }
        g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g = g.toNonIndexed(); g.computeVertexNormals(); F.push(g);
      }
    }
    flameMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    flame = new THREE.Mesh(merge(F, true), flameMat); flame.visible = false; grp.add(flame);
    // trail: two ribbons from the tail lamps, additive, fading
    const NV = 2 * TRAIL_N * 2 + 8; // ribbon vertices plus two lamp glow quads
    trailPos = new Float32Array(NV * 3); trailCol = new Float32Array(NV * 3);
    const idx = [];
    for (let r = 0; r < 2; r++) for (let i = 0; i < TRAIL_N - 1; i++) { const a = (r * TRAIL_N + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    for (let q = 0; q < 2; q++) { const a = 2 * TRAIL_N * 2 + q * 4; idx.push(a, a + 1, a + 2, a, a + 2, a + 3); for (let v = 0; v < 4; v++) { const o = (a + v) * 3; trailCol[o] = 0.6; trailCol[o + 1] = 0.05; trailCol[o + 2] = 0.04; } }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(trailCol, 3)); tg.setIndex(idx);
    for (let r = 0; r < 2; r++) for (let i = 0; i < TRAIL_N; i++) {
      const f = Math.pow(1 - i / (TRAIL_N - 1), 1.4);
      for (let v = 0; v < 2; v++) { const o = ((r * TRAIL_N + i) * 2 + v) * 3; trailCol[o] = 0.85 * f; trailCol[o + 1] = 0.1 * f; trailCol[o + 2] = 0.07 * f; }
    }
    trail = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    trail.frustumCulled = false; trail.visible = false; scene.add(trail);
  }
  function resetTrail() { nSamp = 0; for (let i = 0; i < trailPos.length; i++) trailPos[i] = 0; if (trail) trail.geometry.attributes.position.needsUpdate = true; for (let i = 0; i < sx.length; i++) { sx[i] = sy[i] = sz[i] = 0; } }

  function place() {
    if (!grp) return;
    const zc = zCenter(), px = px_();
    grp.position.set(px, y + Math.sin(t * 2.1) * 0.1, zc);
    const bank = clamp(-vxs / 30 * 0.4, -0.35, 0.35);
    grp.rotation.set(clamp(vys / 22 * 0.16, -0.2, 0.2), clamp(-vxs / 30 * 0.12, -0.2, 0.2), bank + rollAng);
    Qo.pos.copy(grp.position);
  }
  function animate(dt) {
    if (!grp) return;
    flame.visible = boostVis > 0.02;
    if (flame.visible) { flame.scale.set(1, 1, 0.5 + 0.9 * boostVis + Math.sin(t * 47) * 0.06); flameMat.opacity = Math.min(1, boostVis * 1.2); }
    // trail follows the lamp positions (rolled with the car); older samples ride the treadmill
    const trailLen = clamp(Q.trailMin + (gap - 20) / 70 * (Q.trailMax - Q.trailMin), Q.trailMin, Q.trailMax) * (boostVis > 0.5 ? Q.trailBoostK : 1);
    const trailDt = clamp(trailLen / (Math.max(30, vzq) * (TRAIL_N - 1)), 0.003, 0.03);
    const dCam = Math.max(5, core.camera.position.z - grp.position.z), pxm = dCam / 457; // metres per screen pixel at the quarry (640 px render height, fov 70)
    const ca = Math.cos(grp.rotation.z), sa = Math.sin(grp.rotation.z), sc = core.scroll || 0;
    for (let r = 0; r < 2; r++) {
      const lx = (r ? 0.85 : -0.85) * S, ly = 0.12 * S, o = r * TRAIL_N;
      if (dt > 0) for (let i = 1; i < TRAIL_N; i++) sz[o + i] += sc;
      if (dt > 0 && (r === 0 ? (trailClock += dt) : trailClock) >= trailDt) { if (r === 1) trailClock = 0; for (let i = TRAIL_N - 1; i >= 2; i--) { sx[o + i] = sx[o + i - 1]; sy[o + i] = sy[o + i - 1]; sz[o + i] = sz[o + i - 1]; } sx[o + 1] = sx[o]; sy[o + 1] = sy[o]; sz[o + 1] = sz[o]; nSamp = Math.min(TRAIL_N, nSamp + 1); }
      sx[o] = grp.position.x + lx * ca - ly * sa; sy[o] = grp.position.y + lx * sa + ly * ca; sz[o] = grp.position.z + HALF;
      for (let i = 0; i < TRAIL_N; i++) {
        const i0 = i < nSamp + 1 ? i : Math.max(0, nSamp), p = ((o + i) * 2) * 3, w = Math.max((0.09 + 0.1 * (1 - i / TRAIL_N)) * S, 0.9 * pxm);
        const j = o + i0;
        trailPos[p] = sx[j] - w; trailPos[p + 1] = sy[j]; trailPos[p + 2] = sz[j];
        trailPos[p + 3] = sx[j] + w; trailPos[p + 4] = sy[j]; trailPos[p + 5] = sz[j];
      }
    }
    // taillight glow: a square dot that never drops below glowPx on screen
    const hs = Math.max(0.35 * S, Q.glowPx * pxm) / 2;
    for (let r = 0; r < 2; r++) {
      const a = (2 * TRAIL_N * 2 + r * 4) * 3, hx = sx[r * TRAIL_N], hy = sy[r * TRAIL_N], hz = sz[r * TRAIL_N] + 0.2;
      trailPos[a] = hx - hs; trailPos[a + 1] = hy - hs; trailPos[a + 2] = hz; trailPos[a + 3] = hx + hs; trailPos[a + 4] = hy - hs; trailPos[a + 5] = hz;
      trailPos[a + 6] = hx + hs; trailPos[a + 7] = hy + hs; trailPos[a + 8] = hz; trailPos[a + 9] = hx - hs; trailPos[a + 10] = hy + hs; trailPos[a + 11] = hz;
    }
    trail.geometry.attributes.position.needsUpdate = true;
  }
  function show(on) { if (!grp) return; grp.visible = on; trail.visible = on; if (hud) hud.style.display = on ? 'block' : 'none'; }

  // ---------------- HUD (DOM) ----------------
  function buildHud() {
    const host = document.getElementById('ui'); if (!host) return;
    hud = document.createElement('div'); hud.id = 'nrq';
    hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;display:none;font-family:"Courier New",monospace;overflow:hidden';
    tagEl = document.createElement('div');
    tagEl.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;font-size:9px;letter-spacing:.14em;color:#f0b0a0;text-shadow:0 0 5px #c9584a,0 0 2px #000,1px 1px 0 #000;background:rgba(5,6,9,.55);padding:1px 4px;opacity:.95;';
    chevEl = document.createElement('div');
    chevEl.style.cssText = 'position:absolute;left:0;top:0;width:22px;height:22px;display:none;background:#c9584a;box-shadow:0 0 8px #c9584a;clip-path:polygon(0 0,50% 40%,100% 0,100% 40%,50% 100%,0 40%);margin:-11px 0 0 -11px';
    chevLbl = document.createElement('div');
    chevLbl.style.cssText = 'position:absolute;left:0;top:0;display:none;white-space:nowrap;font-size:11px;letter-spacing:.16em;color:#e8a898;text-shadow:0 0 6px #c9584a,0 0 2px #000,1px 1px 0 #000;transform:translate(-50%,0)';
    ringEl = document.createElement('div');
    ringEl.style.cssText = 'position:absolute;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border:1px solid rgba(232,154,136,.55);border-radius:50%;display:none;box-shadow:0 0 6px rgba(201,88,74,.5)';
    hud.appendChild(ringEl); hud.appendChild(tagEl); hud.appendChild(chevEl); hud.appendChild(chevLbl); host.appendChild(hud);
  }
  // hidden behind an obstacle: sample the camera-to-quarry line against world boxes (10 Hz)
  const hb2 = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  let hidT = 0, hidClock = 0, hidNow = false; Qo.hidden = () => hidT > 0.5;
  function checkHidden(dt) {
    hidClock -= dt; if (hidClock > 0) { return; } hidClock = 0.1;
    const c = core.camera.position, q = Qo.pos; let hid = false;
    if (NR.world && NR.world.collide) for (let i = 1; i <= 8 && !hid; i++) {
      const f = 0.12 + i * 0.1, px = c.x + (q.x - c.x) * f, py = c.y + (q.y - c.y) * f, pz = c.z + (q.z - c.z) * f;
      hb2.min.x = px - 0.6; hb2.max.x = px + 0.6; hb2.min.y = py - 0.6; hb2.max.y = py + 0.6; hb2.min.z = pz - 0.6; hb2.max.z = pz + 0.6;
      if (NR.world.collide(hb2).hit) hid = true;
    }
    hidNow = hid; hidT = hid ? hidT + 0.1 : 0;
  }
  function updateHud() {
    if (!hud || core.state !== 'PLAY' && core.state !== 'PAUSE') return;
    const w = hud.clientWidth || 360, h = hud.clientHeight || 640;
    if (core.state === 'PLAY') checkHidden(core.dt);
    v3.copy(Qo.pos).project(core.camera);
    const nx = v3.x, ny = v3.y, front = v3.z < 1;
    v3.set(Qo.pos.x, Qo.pos.y + 1.9 * S, Qo.pos.z).project(core.camera); const tyN = v3.y, txN = v3.x;
    const txt = 'RUNAWAY REPLICANT ' + Math.round(gap) + ' m';
    const onscreen = front && Math.abs(nx) < 0.9 && ny < 0.86 && ny > -0.8 && hidT <= 0.5;
    if (onscreen) {
      if (lastMode !== 1) { lastMode = 1; chevEl.style.display = 'none'; chevLbl.style.display = 'none'; tagEl.style.display = 'block'; }
      tagEl.style.transform = 'translate(' + clamp((txN * 0.5 + 0.5) * w - tagEl.offsetWidth / 2, 2, w - tagEl.offsetWidth - 2).toFixed(1) + 'px,' + ((0.5 - tyN * 0.5) * h - 14).toFixed(1) + 'px)';
      if (txt !== lastTxt) { lastTxt = txt; tagEl.textContent = txt; }
      if (gap > 50) { ringEl.style.display = 'block'; ringEl.style.transform = 'translate(' + ((nx * 0.5 + 0.5) * w).toFixed(1) + 'px,' + ((0.5 - ny * 0.5) * h).toFixed(1) + 'px)'; } else ringEl.style.display = 'none';
    } else {
      if (lastMode !== 2) { lastMode = 2; ringEl.style.display = 'none'; tagEl.style.display = 'none'; chevEl.style.display = 'block'; chevLbl.style.display = 'block'; }
      let dx = front ? nx : -nx, dy = front ? ny : -ny; if (Math.abs(dx) + Math.abs(dy) < 1e-3) dy = 1;
      const s = 0.84 / Math.max(Math.abs(dx), Math.abs(dy), 1e-3);
      const ex = clamp(dx * s, -0.72, 0.72), ey = clamp(dy * s, -0.8, 0.84);
      const px = (ex * 0.5 + 0.5) * w, py = (0.5 - ey * 0.5) * h;
      chevEl.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px) rotate(' + (Math.atan2(-dx, -dy) * 180 / Math.PI).toFixed(1) + 'deg)';
      chevLbl.style.transform = 'translate(' + clamp(px - chevLbl.offsetWidth / 2, 4, w - chevLbl.offsetWidth - 4).toFixed(1) + 'px,' + (py + (ey > 0 ? 16 : -30)).toFixed(1) + 'px)';
      if (txt !== lastTxt) { lastTxt = txt; chevLbl.textContent = txt; }
    }
  }
})();
