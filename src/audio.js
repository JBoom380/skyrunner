// SKYRUNNER audio: two-track music playlist (HTMLAudio) + all SFX synthesized with WebAudio (no files).
// NR.audio = { init, update, reset, nowPlaying, setMusic(v), setSfx(v), unlock(), hazard(d) }  (listens: roll, hazard {kind, phase, pos})
(function () {
  window.NR = window.NR || {};
  const AC = window.AudioContext || window.webkitAudioContext;
  const MUSIC = NR.MUSIC || [];
  const S = (v, d) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

  // ================= synth voices (built against any BaseAudioContext so tests can render offline) =================
  function makeNoise(ctx, seconds) {
    const n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let s = 1234567;
    for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 1073741823.5) - 1; }
    return b;
  }
  // gain envelope: 0 -> peak in a, exponential tail to silence at t+a+r
  function env(p, t, a, peak, r) {
    p.cancelScheduledValues(t); p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + a); p.exponentialRampToValueAtTime(0.0001, t + a + r);
  }
  function osc(ctx, type, f) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
  function gain(ctx, v) { const g = ctx.createGain(); g.gain.value = v; return g; }
  function filt(ctx, type, f, q) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
  function noiseSrc(ctx, buf, loop) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = !!loop; return s;
  }
  function panner(ctx, pan) {
    if (!ctx.createStereoPanner) return gain(ctx, 1);
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0)); return p;
  }
  function run(srcs, t, end) { for (const s of srcs) { s.start(t); s.stop(t + end); } return srcs[0]; }

  const VOICES = {
    // near miss: doppler whoosh (bright noise sweeping down + falling tone), panned to the side of the passed car
    nearMiss(ctx, out, nb, o) {
      const t = ctx.currentTime + 0.005, pan = (o && o.pan) || 0, k = (o && o.k) || 1;
      const p = panner(ctx, pan); p.connect(out);
      if (p.pan) { p.pan.setValueAtTime(pan, t); p.pan.linearRampToValueAtTime(pan * 0.25, t + 0.45); }
      const n = noiseSrc(ctx, nb), bp = filt(ctx, 'bandpass', 3200, 1.4), g = gain(ctx, 0);
      bp.frequency.setValueAtTime(3600, t); bp.frequency.exponentialRampToValueAtTime(420, t + 0.5);
      env(g.gain, t, 0.07, 1.0 * k, 0.45); n.connect(bp); bp.connect(g); g.connect(p);
      const o1 = osc(ctx, 'sawtooth', 540), lp = filt(ctx, 'lowpass', 1600, 0.7), g2 = gain(ctx, 0);
      o1.frequency.setValueAtTime(560, t); o1.frequency.exponentialRampToValueAtTime(250, t + 0.42);
      env(g2.gain, t, 0.05, 0.16 * k, 0.4); o1.connect(lp); lp.connect(g2); g2.connect(p);
      return run([n, o1], t, 0.6);
    },
    // hit: metal clank (inharmonic partials) + thump + noise crack, then two alarm beeps
    hit(ctx, out, nb) {
      const t = ctx.currentTime + 0.005, bus = gain(ctx, 1); bus.connect(out);
      const srcs = [];
      for (const [f, a, r] of [[223, 0.32, 0.55], [571, 0.22, 0.4], [1187, 0.14, 0.3], [1693, 0.08, 0.22]]) {
        const o = osc(ctx, 'triangle', f), g = gain(ctx, 0); env(g.gain, t, 0.003, a, r);
        o.frequency.setValueAtTime(f * 1.04, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
        o.connect(g); g.connect(bus); srcs.push(o);
      }
      const th = osc(ctx, 'sine', 110), tg = gain(ctx, 0); th.frequency.setValueAtTime(120, t); th.frequency.exponentialRampToValueAtTime(42, t + 0.25);
      env(tg.gain, t, 0.004, 0.6, 0.3); th.connect(tg); tg.connect(bus); srcs.push(th);
      const n = noiseSrc(ctx, nb), hp = filt(ctx, 'highpass', 1800, 0.7), ng = gain(ctx, 0);
      env(ng.gain, t, 0.002, 0.5, 0.09); n.connect(hp); hp.connect(ng); ng.connect(bus); srcs.push(n);
      const bp = osc(ctx, 'square', 1040), bl = filt(ctx, 'lowpass', 2600, 0.7), bg = gain(ctx, 0);
      bg.gain.setValueAtTime(0, t);
      for (const s of [0.16, 0.36]) { bg.gain.setValueAtTime(0, t + s); bg.gain.linearRampToValueAtTime(0.09, t + s + 0.008); bg.gain.setValueAtTime(0.09, t + s + 0.11); bg.gain.linearRampToValueAtTime(0, t + s + 0.125); }
      bp.connect(bl); bl.connect(bg); bg.connect(bus); srcs.push(bp);
      return run(srcs, t, 0.65);
    },
    // crash: big noise blast with a closing filter, sub drop, scattered debris crackles
    crash(ctx, out, nb) {
      const t = ctx.currentTime + 0.005, bus = gain(ctx, 1); bus.connect(out);
      const n = noiseSrc(ctx, nb, true), lp = filt(ctx, 'lowpass', 3000, 0.5), g = gain(ctx, 0);
      lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(160, t + 2.4);
      env(g.gain, t, 0.01, 0.75, 2.6); n.connect(lp); lp.connect(g); g.connect(bus);
      const sub = osc(ctx, 'sine', 70), sg = gain(ctx, 0); sub.frequency.setValueAtTime(78, t); sub.frequency.exponentialRampToValueAtTime(24, t + 1.6);
      env(sg.gain, t, 0.01, 0.7, 1.7); sub.connect(sg); sg.connect(bus);
      const c = noiseSrc(ctx, nb, true), hp = filt(ctx, 'bandpass', 2400, 0.9), cg = gain(ctx, 0);
      cg.gain.setValueAtTime(0, t); let s = 0.25;
      for (let i = 0; i < 9; i++) { const at = t + s; cg.gain.setValueAtTime(0, at); cg.gain.linearRampToValueAtTime(0.35 - i * 0.03, at + 0.006); cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.07); s += 0.09 + ((i * 37) % 11) * 0.03; }
      c.connect(hp); hp.connect(cg); cg.connect(bus);
      return run([n, sub, c], t, 2.8);
    },
    // boost ignition: low whump + air burst (the sustained roar is a continuous voice)
    boost(ctx, out, nb) {
      const t = ctx.currentTime + 0.005;
      const o = osc(ctx, 'sine', 140), g = gain(ctx, 0); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.35);
      env(g.gain, t, 0.01, 0.55, 0.38); o.connect(g); g.connect(out);
      const n = noiseSrc(ctx, nb), bp = filt(ctx, 'bandpass', 500, 0.8), ng = gain(ctx, 0);
      bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.4);
      env(ng.gain, t, 0.05, 0.4, 0.45); n.connect(bp); bp.connect(ng); ng.connect(out);
      return run([o, n], t, 0.55);
    },
    // siren: two-tone hi/lo wail for 1 s (two detuned voices through a soft lowpass)
    siren(ctx, out) {
      const t = ctx.currentTime + 0.005, lp = filt(ctx, 'lowpass', 2400, 1.2), g = gain(ctx, 0); lp.connect(g); g.connect(out);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13, t + 0.03); g.gain.setValueAtTime(0.13, t + 0.95); g.gain.linearRampToValueAtTime(0, t + 1.05);
      const a = osc(ctx, 'square', 960), b = osc(ctx, 'sawtooth', 962);
      for (const o of [a, b]) {
        o.frequency.setValueAtTime(960, t);
        for (let i = 1; i < 4; i++) { const f = i % 2 ? 720 : 960, at = t + i * 0.25; o.frequency.setValueAtTime(o === a ? (i % 2 ? 960 : 720) : (i % 2 ? 962 : 722), at - 0.02); o.frequency.linearRampToValueAtTime(o === a ? f : f + 2, at + 0.02); }
        o.connect(lp);
      }
      return run([a, b], t, 1.1);
    },
    // thunder: close crack, then a long rolling low rumble
    thunder(ctx, out, nb) {
      const t = ctx.currentTime + 0.005, bus = gain(ctx, 1); bus.connect(out);
      const c = noiseSrc(ctx, nb), hp = filt(ctx, 'highpass', 900, 0.6), cg = gain(ctx, 0);
      env(cg.gain, t, 0.004, 0.5, 0.35); c.connect(hp); hp.connect(cg); cg.connect(bus);
      const r = noiseSrc(ctx, nb, true), lp = filt(ctx, 'lowpass', 220, 0.9), rg = gain(ctx, 0);
      lp.frequency.setValueAtTime(420, t + 0.15); lp.frequency.exponentialRampToValueAtTime(90, t + 3.8);
      rg.gain.setValueAtTime(0.0001, t); rg.gain.setValueAtTime(0.0001, t + 0.12); rg.gain.linearRampToValueAtTime(1.1, t + 0.45);
      rg.gain.linearRampToValueAtTime(0.6, t + 1.0); rg.gain.linearRampToValueAtTime(0.9, t + 1.5); rg.gain.exponentialRampToValueAtTime(0.0001, t + 4.0);
      r.connect(lp); lp.connect(rg); rg.connect(bus);
      return run([c, r], t, 4.1);
    },
    // ui: click (move/select), confirm (start/ok), back
    ui(ctx, out, nb, o) {
      const t = ctx.currentTime + 0.003, kind = (o && o.kind) || 'click', srcs = [];
      const notes = kind === 'confirm' ? [[660, 0, 0.07], [990, 0.07, 0.12]] : kind === 'back' ? [[520, 0, 0.06], [350, 0.06, 0.09]] : [[1320, 0, 0.035]];
      for (const [f, at, r] of notes) {
        const v = osc(ctx, 'square', f), lp = filt(ctx, 'lowpass', 3000, 0.7), g = gain(ctx, 0);
        g.gain.setValueAtTime(0, t); env(g.gain, t + at, 0.003, kind === 'click' ? 0.1 : 0.13, r);
        v.connect(lp); lp.connect(g); g.connect(out); srcs.push(v);
      }
      return run(srcs, t, 0.3);
    },
    // district change: filtered air swoosh rising and falling + a dark low fifth
    district(ctx, out, nb) {
      const t = ctx.currentTime + 0.005, bus = gain(ctx, 1); bus.connect(out);
      const n = noiseSrc(ctx, nb, true), bp = filt(ctx, 'bandpass', 300, 1.6), g = gain(ctx, 0);
      bp.frequency.setValueAtTime(220, t); bp.frequency.exponentialRampToValueAtTime(3800, t + 0.8); bp.frequency.exponentialRampToValueAtTime(300, t + 1.8);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      n.connect(bp); bp.connect(g); g.connect(bus);
      const srcs = [n];
      for (const f of [55, 82.4, 110]) {
        const o = osc(ctx, 'sawtooth', f), lp = filt(ctx, 'lowpass', 500, 0.7), og = gain(ctx, 0);
        og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.07, t + 0.6); og.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
        o.connect(lp); lp.connect(og); og.connect(bus); srcs.push(o);
      }
      return run(srcs, t, 2.3);
    },
  };

  // ---- round 2: roll whoosh + hazard voices (o: {phase, pan, k, boost}) ----
  // noise through a filter with a gain envelope, panned; returns the source
  function nz(ctx, out, nb, type, f, q, t, a, peak, r, loop) {
    const n = noiseSrc(ctx, nb, loop), b = filt(ctx, type, f, q), g = gain(ctx, 0);
    env(g.gain, t, a, peak, r); n.connect(b); b.connect(g); g.connect(out); return { n, b, g };
  }
  function hzOut(ctx, out, o) { const p = panner(ctx, (o && o.pan) || 0), g = gain(ctx, (o && o.k) || 1); g.connect(p); p.connect(out); return g; }
  Object.assign(VOICES, {
    // barrel roll: air whoosh that sweeps up and back down with a rotating wobble, panned across in the roll direction
    roll(ctx, out, nb, o) {
      const t = ctx.currentTime + 0.005, boost = !!(o && o.boost), d = boost ? 0.38 : 0.48, k = boost ? 1.45 : 1, pan = (o && o.pan) || 0;
      const p = panner(ctx, -pan * 0.6); p.connect(out);
      if (p.pan) { p.pan.setValueAtTime(-pan * 0.6, t); p.pan.linearRampToValueAtTime(pan * 0.8, t + d); }
      const am = gain(ctx, 0.75); am.connect(p);
      const w = nz(ctx, am, nb, 'bandpass', 600, 1.6, t, d * 0.45, 0.85 * k, d * 0.75);
      w.b.frequency.setValueAtTime(500, t); w.b.frequency.exponentialRampToValueAtTime(boost ? 4200 : 3000, t + d * 0.5); w.b.frequency.exponentialRampToValueAtTime(600, t + d * 1.2);
      const lfo = osc(ctx, 'sine', 2.2 / d), lg = gain(ctx, 0.3); lfo.connect(lg); lg.connect(am.gain); // one wobble per half turn
      const lo = osc(ctx, 'sine', 170), log = gain(ctx, 0); lo.frequency.setValueAtTime(boost ? 220 : 170, t); lo.frequency.exponentialRampToValueAtTime(80, t + d);
      env(log.gain, t, 0.04, 0.22 * k, d); lo.connect(log); log.connect(p);
      return run([w.n, lfo, lo], t, d * 1.6);
    },
    // police drone spotted you: two quick rising/falling chirps
    hzChirp(ctx, out, nb, o) {
      const t = ctx.currentTime + 0.005, b = hzOut(ctx, out, o), srcs = [];
      for (const [at, f0, f1] of [[0, 1500, 2300], [0.11, 2300, 1500]]) {
        const v = osc(ctx, 'square', f0), lp = filt(ctx, 'lowpass', 3200, 0.8), g = gain(ctx, 0);
        v.frequency.setValueAtTime(f0, t + at); v.frequency.exponentialRampToValueAtTime(f1, t + at + 0.08);
        g.gain.setValueAtTime(0, t); env(g.gain, t + at, 0.005, 0.07, 0.08); v.connect(lp); lp.connect(g); g.connect(b); srcs.push(v);
      }
      return run(srcs, t, 0.3);
    },
    // flame jet: warn = rising gas hiss as the glow ramps; active = roaring burst with low flutter
    hzFlame(ctx, out, nb, o) {
      const t = ctx.currentTime + 0.005, b = hzOut(ctx, out, o);
      if (o && o.phase === 'warn') {
        const h = nz(ctx, b, nb, 'bandpass', 900, 1.2, t, 0.8, 0.28, 0.25, true); h.b.frequency.setValueAtTime(700, t); h.b.frequency.exponentialRampToValueAtTime(3200, t + 0.9);
        return run([h.n], t, 1.15);
      }
      const r = nz(ctx, b, nb, 'lowpass', 1100, 0.8, t, 0.04, 0.7, 1.1, true); r.b.frequency.setValueAtTime(1800, t); r.b.frequency.exponentialRampToValueAtTime(400, t + 1.1);
      const fl = osc(ctx, 'sine', 13), fg = gain(ctx, 0.25); fl.connect(fg); fg.connect(r.g.gain);
      const sub = osc(ctx, 'sawtooth', 52), sl = filt(ctx, 'lowpass', 180, 0.7), sg = gain(ctx, 0); env(sg.gain, t, 0.05, 0.35, 1.0); sub.connect(sl); sl.connect(sg); sg.connect(b);
      return run([r.n, fl, sub], t, 1.25);
    },
    // laser fence: warn = rising electric hum; active = zap (falling saw) with a crackle
    hzLaser(ctx, out, nb, o) {
      const t = ctx.currentTime + 0.005, b = hzOut(ctx, out, o);
      if (o && o.phase === 'warn') {
        const h = osc(ctx, 'sawtooth', 110), h2 = osc(ctx, 'square', 221), lp = filt(ctx, 'lowpass', 300, 4), g = gain(ctx, 0);
        lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(1800, t + 0.55);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
        h.connect(lp); h2.connect(lp); lp.connect(g); g.connect(b); return run([h, h2], t, 0.65);
      }
      const z = osc(ctx, 'sawtooth', 2600), zl = filt(ctx, 'bandpass', 2000, 2), zg = gain(ctx, 0);
      z.frequency.setValueAtTime(2600, t); z.frequency.exponentialRampToValueAtTime(160, t + 0.2); zl.frequency.setValueAtTime(3000, t); zl.frequency.exponentialRampToValueAtTime(300, t + 0.2);
      env(zg.gain, t, 0.003, 0.4, 0.22); z.connect(zl); zl.connect(zg); zg.connect(b);
      const c = nz(ctx, b, nb, 'highpass', 2500, 0.7, t, 0.002, 0.3, 0.12);
      const bz = osc(ctx, 'square', 60), bg = gain(ctx, 0); env(bg.gain, t, 0.005, 0.06, 0.25); bz.connect(bg); bg.connect(b);
      return run([z, c.n, bz], t, 0.35);
    },
    // blast shutter / swinging gantry: warn = ratchet clicks; active = heavy low clank with a long ring
    hzClank(ctx, out, nb, o) {
      const t = ctx.currentTime + 0.005, b = hzOut(ctx, out, o);
      if (o && o.phase === 'warn') {
        const n = noiseSrc(ctx, nb, true), bp = filt(ctx, 'bandpass', 1900, 3), g = gain(ctx, 0);
        g.gain.setValueAtTime(0, t);
        for (let i = 0; i < 7; i++) { const at = t + i * 0.085; g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.32, at + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.035); }
        n.connect(bp); bp.connect(g); g.connect(b); return run([n], t, 0.7);
      }
      const srcs = [];
      for (const [f, a, r] of [[96, 0.4, 0.9], [233, 0.26, 0.7], [517, 0.16, 0.5], [861, 0.09, 0.35]]) {
        const v = osc(ctx, 'triangle', f), g = gain(ctx, 0); env(g.gain, t, 0.003, a, r);
        v.frequency.setValueAtTime(f * 1.06, t); v.frequency.exponentialRampToValueAtTime(f, t + 0.1); v.connect(g); g.connect(b); srcs.push(v);
      }
      const n = nz(ctx, b, nb, 'lowpass', 1400, 0.7, t, 0.002, 0.5, 0.15); srcs.push(n.n);
      return run(srcs, t, 1.0);
    },
    // dust storm gust (and steam hiss, brighter): a swelling band of wind
    hzGust(ctx, out, nb, o) {
      const t = ctx.currentTime + 0.005, b = hzOut(ctx, out, o), steam = !!(o && o.steam), warn = o && o.phase === 'warn';
      const d = warn ? 0.9 : 1.5, w = nz(ctx, b, nb, steam ? 'highpass' : 'bandpass', 400, steam ? 0.7 : 1.1, t, d * 0.4, warn ? 0.3 : 0.6, d * 0.7, true);
      if (steam) { w.b.frequency.setValueAtTime(3000, t); w.b.frequency.linearRampToValueAtTime(5000, t + d); }
      else { w.b.frequency.setValueAtTime(260, t); w.b.frequency.exponentialRampToValueAtTime(1300, t + d * 0.45); w.b.frequency.exponentialRampToValueAtTime(380, t + d * 1.1); }
      return run([w.n], t, d * 1.15);
    },
    // falling debris: warn = low grinding rumble; active = rock impacts with gravel
    hzDebris(ctx, out, nb, o) {
      const t = ctx.currentTime + 0.005, b = hzOut(ctx, out, o);
      if (o && o.phase === 'warn') {
        const r = nz(ctx, b, nb, 'lowpass', 140, 1.5, t, 0.8, 0.8, 0.5, true);
        const g = osc(ctx, 'sawtooth', 38), gl = filt(ctx, 'lowpass', 120, 1), gg = gain(ctx, 0); env(gg.gain, t, 0.7, 0.2, 0.5); g.connect(gl); gl.connect(gg); gg.connect(b);
        return run([r.n, g], t, 1.35);
      }
      const srcs = [];
      for (const [at, f] of [[0, 92], [0.13, 70], [0.3, 110], [0.42, 60]]) {
        const v = osc(ctx, 'sine', f), g = gain(ctx, 0); g.gain.setValueAtTime(0, t);
        v.frequency.setValueAtTime(f * 1.5, t + at); v.frequency.exponentialRampToValueAtTime(f * 0.5, t + at + 0.2);
        env(g.gain, t + at, 0.004, 0.5, 0.25); v.connect(g); g.connect(b); srcs.push(v);
      }
      const c = nz(ctx, b, nb, 'bandpass', 1600, 0.8, t, 0.01, 0.3, 0.6); srcs.push(c.n);
      return run(srcs, t, 0.8);
    },
    // lightning strike: warn = static crackle building on the ring; active = the sharp crack (thunder comes from `lightning`)
    hzLightning(ctx, out, nb, o) {
      const t = ctx.currentTime + 0.005, b = hzOut(ctx, out, o);
      if (o && o.phase === 'warn') {
        const n = noiseSrc(ctx, nb, true), bp = filt(ctx, 'bandpass', 3400, 1.2), g = gain(ctx, 0);
        g.gain.setValueAtTime(0, t); let s = 0;
        for (let i = 0; s < 1.15; i++) { const at = t + s, a = 0.05 + 0.25 * (s / 1.15); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(a, at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03); s += 0.03 + ((i * 53) % 7) * 0.012 * (1 - s / 1.3); }
        const h = osc(ctx, 'square', 50), hl = filt(ctx, 'lowpass', 400, 1), hg = gain(ctx, 0);
        hg.gain.setValueAtTime(0.0001, t); hg.gain.linearRampToValueAtTime(0.08, t + 1.1); hg.gain.linearRampToValueAtTime(0.0001, t + 1.2);
        n.connect(bp); bp.connect(g); g.connect(b); h.connect(hl); hl.connect(hg); hg.connect(b);
        return run([n, h], t, 1.25);
      }
      const c = nz(ctx, b, nb, 'highpass', 1500, 0.6, t, 0.002, 0.9, 0.3);
      const s = nz(ctx, b, nb, 'bandpass', 600, 1, t, 0.003, 0.6, 0.5);
      const sub = osc(ctx, 'sine', 60), sg = gain(ctx, 0); sub.frequency.setValueAtTime(90, t); sub.frequency.exponentialRampToValueAtTime(35, t + 0.5);
      env(sg.gain, t, 0.004, 0.6, 0.6); sub.connect(sg); sg.connect(b);
      return run([c.n, s.n, sub], t, 0.75);
    },
    // sea wall spray column: warn = swell rising; active = breaking wave crash
    hzWave(ctx, out, nb, o) {
      const t = ctx.currentTime + 0.005, b = hzOut(ctx, out, o);
      if (o && o.phase === 'warn') {
        const s = nz(ctx, b, nb, 'lowpass', 300, 0.9, t, 0.9, 0.5, 0.35, true); s.b.frequency.setValueAtTime(250, t); s.b.frequency.exponentialRampToValueAtTime(1400, t + 1.0);
        return run([s.n], t, 1.3);
      }
      const c = nz(ctx, b, nb, 'lowpass', 2600, 0.6, t, 0.03, 0.85, 1.5, true); c.b.frequency.setValueAtTime(3200, t); c.b.frequency.exponentialRampToValueAtTime(260, t + 1.5);
      const f = nz(ctx, b, nb, 'highpass', 3500, 0.6, t + 0.1, 0.2, 0.25, 1.0, true);
      const sub = osc(ctx, 'sine', 48), sg = gain(ctx, 0); env(sg.gain, t, 0.02, 0.45, 0.8); sub.connect(sg); sg.connect(b);
      return run([c.n, f.n, sub], t, 1.7);
    },
  });
  // hazard kind -> voice (world names are free-form; match loosely)
  function hazardVoice(kind) {
    const k = String(kind || '').toLowerCase();
    if (/spot|search|drone/.test(k)) return 'drone';
    if (/flame|fire|jet|burn/.test(k)) return 'hzFlame';
    if (/laser|fence|beam/.test(k)) return 'hzLaser';
    if (/shutter|blast|gate|door|gantry|sign|swing|clank/.test(k)) return 'hzClank';
    if (/steam|vent/.test(k)) return 'steam';
    if (/dust|storm|gust|wind/.test(k)) return 'hzGust';
    if (/debris|rock|fall|rubble/.test(k)) return 'hzDebris';
    if (/lightning|bolt|strike/.test(k)) return 'hzLightning';
    if (/wave|spray|sea|surf/.test(k)) return 'hzWave';
    return null;
  }

  // continuous voices: engine hum, turbine whine, wind rush, boost roar, drone hum (searchlight)
  function makeLoops(ctx, out, nb) {
    const L = {};
    L.eng = gain(ctx, 0); L.eng.connect(out);
    L.engLP = filt(ctx, 'lowpass', 500, 2.2); L.engLP.connect(L.eng);
    L.o1 = osc(ctx, 'sawtooth', 48); L.o2 = osc(ctx, 'sawtooth', 48.6); L.o3 = osc(ctx, 'sine', 24);
    L.o1.connect(L.engLP); L.o2.connect(L.engLP); L.o3.connect(L.eng);
    L.whineG = gain(ctx, 0); L.whineG.connect(out); L.whine = osc(ctx, 'sine', 900); L.whine.connect(L.whineG);
    L.wind = gain(ctx, 0); L.wind.connect(out); L.windBP = filt(ctx, 'bandpass', 700, 0.6); L.windBP.connect(L.wind);
    L.wn = noiseSrc(ctx, nb, true); L.wn.connect(L.windBP);
    L.boost = gain(ctx, 0); L.boost.connect(out); L.boostLP = filt(ctx, 'lowpass', 900, 0.9); L.boostLP.connect(L.boost);
    L.bn = noiseSrc(ctx, nb, true); L.bn.playbackRate.value = 0.7; L.bn.connect(L.boostLP);
    L.bo = osc(ctx, 'sawtooth', 70); L.bo.connect(L.boostLP);
    // drone hum: detuned buzz with a fast rotor tremolo; gain follows how recently a drone spotted the car
    L.drone = gain(ctx, 0); L.drone.connect(out); L.droneAM = gain(ctx, 0.7); L.droneAM.connect(L.drone);
    L.droneLP = filt(ctx, 'lowpass', 700, 3); L.droneLP.connect(L.droneAM);
    L.d1 = osc(ctx, 'sawtooth', 118); L.d2 = osc(ctx, 'sawtooth', 120.5); L.d1.connect(L.droneLP); L.d2.connect(L.droneLP);
    L.dl = osc(ctx, 'sine', 23); L.dlg = gain(ctx, 0.3); L.dl.connect(L.dlg); L.dlg.connect(L.droneAM.gain);
    for (const s of [L.o1, L.o2, L.o3, L.whine, L.wn, L.bn, L.bo, L.d1, L.d2, L.dl]) s.start();
    return L;
  }

  // ================= module =================
  const A = NR.audio = {
    nowPlaying: MUSIC[0] ? MUSIC[0].title : '',
    ctx: null, unlocked: false, playing: false, track: 0, voices: 0,
    init, update, reset, setMusic, setSfx, unlock,
  };
  let core = null, ctx = null, nb = null, sfxBus = null, musicGain = null, comp = null, loops = null;
  let dropGesture = null, el = null, pre = null, routed = false, musicV = 0.7, sfxV = 0.8, boosting = false, hiddenPaused = false, failCount = 0, paramT = 0;

  function settings() { return (core && core.settings) || {}; }
  function init(c) {
    core = c; musicV = S(settings().music, 0.7); sfxV = S(settings().sfx, 0.8);
    const evs = ['pointerdown', 'touchend', 'mousedown', 'keydown', 'click'];
    const h = () => { if (!(A.playing && ctx && ctx.state === 'running')) unlock(); };
    for (const e of evs) addEventListener(e, h, true);
    dropGesture = () => { for (const e of evs) removeEventListener(e, h, true); };
    const B = NR.bus; if (!B) return;
    B.on('nearMiss', d => {
      let pan = 0; const p = NR.player && NR.player.pos;
      if (d && d.pos && typeof d.pos.x === 'number') pan = Math.max(-0.9, Math.min(0.9, (d.pos.x - (p ? p.x : 0)) / 6));
      play('nearMiss', { pan, k: d && typeof d.dist === 'number' ? 1.15 - Math.min(0.4, d.dist / 8) : 1 });
    });
    B.on('hit', () => play('hit'));
    B.on('crash', () => { play('crash'); boosting = false; });
    B.on('boost', d => { const on = !!(d && d.on); if (on && !boosting) play('boost'); boosting = on; });
    B.on('siren', () => play('siren'));
    B.on('lightning', () => play('thunder'));
    B.on('district', d => { if (d && (d.index || d.loop)) play('district'); });
    B.on('ui', d => {
      unlock();
      const a = String((d && d.action) || 'click').toLowerCase();
      const kind = /start|confirm|ok|retry|select|enter|resume|play/.test(a) ? 'confirm' : /back|quit|menu|close|cancel/.test(a) ? 'back' : 'click';
      play('ui', { kind });
    });
    B.on('state', d => { if (d && d.state === 'DEAD') { boosting = false; spotted = 0; } });
    B.on('roll', d => { lastRoll = now(); playRoll(d && d.dir, d && d.boost); });
    B.on('hazard', onHazard);
    document.addEventListener('visibilitychange', onVis);
  }

  function ensureCtx() {
    if (ctx || !AC) return ctx;
    try { ctx = A.ctx = new AC(); } catch (e) { return null; }
    nb = makeNoise(ctx, 2);
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    sfxBus = gain(ctx, sfxV); sfxBus.connect(comp);
    musicGain = gain(ctx, musicV); musicGain.connect(ctx.destination);
    loops = makeLoops(ctx, sfxBus, nb);
    return ctx;
  }

  // must run inside a user gesture (first tap / key): resume WebAudio, start track 0
  function unlock() {
    const c = ensureCtx();
    if (c) {
      if (c.state !== 'running' && c.resume) { try { c.resume().catch(() => {}); } catch (e) {} }
      if (!A.unlocked) { try { const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch (e) {} }
      A.unlocked = true;
    }
    if (!A.playing) startMusic();
  }

  // one element plays the whole playlist (it stays gesture-blessed on mobile); a hidden element warms the cache for the next track
  function startMusic() {
    if (!MUSIC.length) return;
    if (!el) {
      el = new Audio(); el.preload = 'auto'; if (/^https?:/.test(location.protocol)) el.crossOrigin = 'anonymous';
      el.addEventListener('ended', next);
      el.addEventListener('error', () => { if (++failCount < MUSIC.length * 2) next(); });
      el.addEventListener('playing', () => { failCount = 0; A.playing = true; preloadNext(); if (dropGesture && ctx && ctx.state === 'running') { dropGesture(); dropGesture = null; } });
      el.src = MUSIC[A.track].file;
      if (ctx && /^https?:/.test(location.protocol) && ctx.createMediaElementSource) {
        try { ctx.createMediaElementSource(el).connect(musicGain); routed = true; } catch (e) { routed = false; }
      }
      applyMusic();
    }
    const p = el.play(); A.playing = true;
    if (p && p.catch) p.catch(() => { A.playing = false; });
  }
  function preloadNext() {
    const n = (A.track + 1) % MUSIC.length; if (n === A.track) return;
    if (!pre) { pre = new Audio(); pre.preload = 'auto'; pre.muted = true; }
    if (pre.dataset.f !== MUSIC[n].file) { pre.dataset.f = MUSIC[n].file; pre.src = MUSIC[n].file; try { pre.load(); } catch (e) {} }
  }
  function next() {
    A.track = (A.track + 1) % MUSIC.length; A.nowPlaying = MUSIC[A.track].title;
    el.src = MUSIC[A.track].file;
    const p = el.play(); if (p && p.catch) p.catch(() => { A.playing = false; });
  }

  function musicLevel() { return musicV * (core && core.state === 'PAUSE' ? 0.5 : 1); }
  function applyMusic() {
    const v = musicLevel();
    if (routed && musicGain) { musicGain.gain.setTargetAtTime(v, ctx.currentTime, 0.08); if (el) el.volume = 1; }
    else if (el) el.volume = v;
  }
  function setMusic(v) { musicV = S(v, musicV); if (core && core.settings) core.settings.music = musicV; applyMusic(); }
  function setSfx(v) {
    sfxV = S(v, sfxV); if (core && core.settings) core.settings.sfx = sfxV;
    if (sfxBus) sfxBus.gain.setTargetAtTime(sfxV, ctx.currentTime, 0.03);
  }

  function play(name, o) {
    if (!ctx || ctx.state !== 'running' || sfxV <= 0 || A.voices > 24) return;
    const v = VOICES[name]; if (!v) return;
    A.voices++;
    const s = v(ctx, sfxBus, nb, o);
    if (s) s.onended = () => { A.voices--; }; else A.voices--;
  }
  A.play = play;

  // ---- roll + hazards ----
  let spotted = 0, lastRoll = -9, rollWas = false;
  const lastHz = {};
  const now = () => (core && typeof core.time === 'number' ? core.time : performance.now() / 1000);
  function playRoll(dir, boost) {
    const dx = dir && typeof dir.x === 'number' ? dir.x : 0;
    play('roll', { pan: Math.max(-1, Math.min(1, dx)), boost: !!boost });
  }
  // pan from the hazard's x against the car; gentle fade with distance ahead so warnings far up the corridor stay audible
  function hzOpts(d, phase) {
    const p = NR.player && NR.player.pos, pos = d && d.pos;
    let pan = 0, k = 1;
    if (pos && typeof pos.x === 'number') {
      pan = Math.max(-0.85, Math.min(0.85, (pos.x - (p ? p.x : 0)) / 14));
      const dz = Math.abs((pos.z || 0) - (p ? p.z : 0));
      k = 0.4 + 0.6 * Math.max(0, Math.min(1, 1 - dz / 260));
    }
    return { phase, pan, k };
  }
  const HZ_GAP = { warn: 0.4, active: 0.22 };
  function onHazard(d) {
    if (!d) return;
    const v = hazardVoice(d.kind), phase = d.phase === 'warn' ? 'warn' : 'active', t = now();
    if (!v || (core && core.state !== 'PLAY' && core.state !== 'TITLE')) return;
    if (v === 'drone') { // searchlight on the car (may arrive every frame): hum level + a chirp at most every 0.9 s
      spotted = Math.max(spotted, phase === 'warn' && !/spot/i.test(d.kind) ? 0.45 : 1);
      if (t - (lastHz.chirp || -9) > 0.9) { lastHz.chirp = t; play('hzChirp', hzOpts(d, phase)); }
      return;
    }
    const key = v + phase; if (t - (lastHz[key] || -9) < HZ_GAP[phase]) return; lastHz[key] = t;
    const o = hzOpts(d, phase);
    if (v === 'steam') { o.steam = true; play('hzGust', o); } else play(v, o);
  }
  A.hazard = onHazard;

  function onVis() {
    if (!el) return;
    if (document.hidden) { if (!el.paused) { el.pause(); hiddenPaused = true; } if (ctx && ctx.suspend) ctx.suspend().catch(() => {}); }
    else { if (ctx && ctx.resume) ctx.resume().catch(() => {}); if (hiddenPaused) { hiddenPaused = false; const p = el.play(); if (p && p.catch) p.catch(() => {}); } }
  }

  function reset() { boosting = false; spotted = 0; rollWas = false; }

  let lastM = -1, lastS = -1, lastPause = false;
  function update(dt, c) {
    core = c || core;
    // follow the settings object (ui may write it directly)
    const st = settings(), m = S(st.music, musicV), s = S(st.sfx, sfxV), paused = core && core.state === 'PAUSE';
    if (m !== lastM || paused !== lastPause) { lastM = m; lastPause = paused; musicV = m; applyMusic(); }
    if (s !== lastS) { lastS = s; setSfx(s); }
    // roll fallback: player rolled but no `roll` event arrived
    const P0 = NR.player, rl = !!(P0 && P0.rolling);
    if (rl && !rollWas && now() - lastRoll > 0.15) { lastRoll = now(); playRoll(P0.rollDir, P0.boosting); }
    rollWas = rl;
    if (spotted > 0) spotted = Math.max(0, spotted - (dt || 0) * 2.5);
    if (!ctx || !loops || ctx.state !== 'running') return;
    paramT += c && c.dt ? c.dt : dt; if (paramT < 1 / 30) return; paramT = 0; // param writes at 30 Hz
    const t = ctx.currentTime, state = core ? core.state : 'TITLE', C = NR.cfg || {};
    const sp = core && core.speed ? core.speed : 0;
    const p = NR.player, b = boosting || !!(p && p.boosting);
    const k = Math.max(0, Math.min(1, (sp - (C.SPEED_START || 60)) / ((C.SPEED_MAX || 150) - (C.SPEED_START || 60))));
    const live = state === 'PLAY' && !(p && p.alive === false), idle = state === 'TITLE';
    const on = live ? 1 : idle ? 0.35 : 0;
    const f = 44 + k * 26 + (b ? 14 : 0) + (p && p.vel && typeof p.vel.y === 'number' ? Math.max(-4, Math.min(4, p.vel.y * 0.25)) : 0);
    loops.o1.frequency.setTargetAtTime(f, t, 0.15); loops.o2.frequency.setTargetAtTime(f * 1.012, t, 0.15); loops.o3.frequency.setTargetAtTime(f * 0.5, t, 0.15);
    loops.engLP.frequency.setTargetAtTime(380 + k * 500 + (b ? 500 : 0), t, 0.2);
    loops.eng.gain.setTargetAtTime(0.065 * on, t, 0.12);
    loops.whine.frequency.setTargetAtTime(700 + k * 900 + (b ? 500 : 0), t, 0.25);
    loops.whineG.gain.setTargetAtTime((0.004 + k * 0.007) * on, t, 0.2);
    loops.windBP.frequency.setTargetAtTime(500 + k * 1600 + (b ? 900 : 0), t, 0.2);
    loops.wind.gain.setTargetAtTime((live ? 0.07 + k * 0.12 + (b ? 0.08 : 0) : idle ? 0.03 : 0), t, 0.2);
    loops.boostLP.frequency.setTargetAtTime(b && live ? 1400 : 500, t, 0.15);
    loops.bo.frequency.setTargetAtTime(62 + k * 20, t, 0.2);
    loops.boost.gain.setTargetAtTime(b && live ? 0.3 : 0, t, b ? 0.06 : 0.25);
    const sp2 = live || idle ? spotted : 0;
    loops.drone.gain.setTargetAtTime(0.11 * sp2, t, sp2 > 0.5 ? 0.05 : 0.2);
    loops.droneLP.frequency.setTargetAtTime(500 + 900 * sp2, t, 0.1);
  }

  // test hook: render one voice offline -> Promise<Float32Array> (mono)
  A._render = function (name, seconds, o) {
    const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!OC) return Promise.resolve(null);
    const oc = new OC(1, Math.ceil(44100 * seconds), 44100), b = makeNoise(oc, 2);
    const g = oc.createGain(); g.connect(oc.destination);
    VOICES[name](oc, g, b, o);
    return oc.startRendering().then(r => r.getChannelData(0));
  };
  A._status = function () {
    return { ctx: ctx ? ctx.state : 'none', unlocked: A.unlocked, playing: A.playing, track: A.track, nowPlaying: A.nowPlaying,
      routed, musicGain: musicGain ? musicGain.gain.value : null, elVolume: el ? el.volume : null, sfxGain: sfxBus ? sfxBus.gain.value : null,
      src: el ? el.currentSrc : '', time: el ? el.currentTime : 0, paused: el ? el.paused : true, preload: pre ? pre.src : '', voices: A.voices,
      eng: loops ? loops.eng.gain.value : null, boost: loops ? loops.boost.gain.value : null, wind: loops ? loops.wind.gain.value : null,
      drone: loops ? loops.drone.gain.value : null, spotted };
  };
  A._el = () => el;
})();
