// NEON RAIN controls: floating touch stick + BOOST/SIREN buttons, keyboard, gamepad -> NR.controls.state. See SPEC.md.
(function () {
  window.NR = window.NR || {};
  const DEAD = 0.12, PAD_DEAD = 0.15, KEY_RATE = 7;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const state = { mx: 0, my: 0, boost: false, siren: false, pause: false, any: false };
  const pend = { siren: false, pause: false, any: false };
  let core = null, root = null, el = null, shown = false, touchSeen = false, lastDevice = 'none';
  let lastState = '', cachedW = 0, cachedH = 0;

  // ---- layout (CSS px inside the 9:16 column; scaled by k = column width / 390) ----
  const L = { k: 1, R: 60, stickHomeX: 0, stickHomeY: 0, bx: 0, by: 0, br: 48, sx: 0, sy: 0, sr: 36, top: 0, w: 390, h: 693 };
  function layout() {
    const v = core && core.view;
    const w = v ? v.w : (root ? root.clientWidth : 390), h = v ? v.h : (root ? root.clientHeight : 693);
    if (!w || !h) return;
    const k = clamp(w / 390, 0.75, 1.6);
    const safeB = safeBottom();
    L.k = k; L.w = w; L.h = h;
    L.R = Math.round(60 * k);
    L.br = Math.round(50 * k); L.sr = Math.round(37 * k);
    L.bx = w - Math.round(26 * k) - L.br; L.by = h - Math.round(42 * k) - safeB - L.br;
    L.sx = L.bx - Math.round(30 * k); L.sy = L.by - L.br - Math.round(28 * k) - L.sr;
    L.stickHomeX = Math.round(34 * k) + L.R + 10; L.stickHomeY = h - Math.round(44 * k) - safeB - L.R;
    L.top = Math.round(h * 0.14);
    cachedW = w; cachedH = h;
    if (!el) return;
    place(el.boost, L.bx, L.by, L.br); place(el.siren, L.sx, L.sy, L.sr);
    el.base.style.width = el.base.style.height = (L.R * 2) + 'px';
    el.knob.style.width = el.knob.style.height = Math.round(58 * k) + 'px';
    for (let i = 0; i < 4; i++) el.arrows[i].style.transform = 'rotate(' + (i * 90) + 'deg) translateY(-' + Math.round(L.R * 0.74) + 'px)';
    el.boost.style.fontSize = Math.round(15 * k) + 'px'; el.siren.style.fontSize = Math.round(12 * k) + 'px';
    if (stick.id === null) stickHome();
  }
  function place(e, cx, cy, r) { const s = e.style; s.left = (cx - r) + 'px'; s.top = (cy - r) + 'px'; s.width = s.height = (r * 2) + 'px'; }
  function safeBottom() {
    try { const p = document.createElement('div'); p.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);visibility:hidden';
      document.body.appendChild(p); const v = p.offsetHeight || 0; p.remove(); return Math.min(40, v); } catch (e) { return 0; }
  }

  // ---- DOM ----
  const CSS = `
#nrc{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5;display:none;font-family:"Courier New",monospace;font-weight:bold;letter-spacing:1px;-webkit-user-select:none;user-select:none}
#nrc.on{display:block}
#nrc .base{position:absolute;left:0;top:0;border-radius:50%;box-sizing:border-box;border:2px solid rgba(143,176,180,.55);
 background:radial-gradient(circle,rgba(5,6,9,.10) 0 52%,rgba(54,69,76,.30) 53% 70%,rgba(5,6,9,.38) 71%);
 box-shadow:0 0 12px rgba(90,160,170,.45) inset,0 0 8px rgba(90,160,170,.25);opacity:.5;transition:opacity .15s}
#nrc .base.act{opacity:1;border-color:rgba(143,176,180,.9)}
#nrc .base i{position:absolute;left:50%;top:50%;width:0;height:0;margin:-6px 0 0 -7px;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:9px solid rgba(143,176,180,.55)}
#nrc .base i.hot{border-bottom-color:#e8c890;filter:drop-shadow(0 0 4px #d9a050)}
#nrc .knob{position:absolute;left:0;top:0;border-radius:50%;box-sizing:border-box;border:2px solid #8fb0b4;
 background:radial-gradient(circle at 40% 35%,rgba(143,176,180,.45),rgba(36,48,56,.55) 70%);box-shadow:0 0 10px rgba(90,160,170,.5);opacity:.6}
#nrc .knob.act{opacity:1;border-color:#e8c890;box-shadow:0 0 14px rgba(217,160,80,.7)}
#nrc .knob b{position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:#54666b}
#nrc .knob.act b{background:#f0d8a8;box-shadow:0 0 8px #d9a050}
#nrc .btn{position:absolute;border-radius:50%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center;transition:transform .06s}
#nrc .boost{border:2px solid #d9a050;color:#f0d8a8;text-shadow:0 0 6px rgba(217,160,80,.9);
 background:radial-gradient(circle,rgba(217,149,63,.20) 0 62%,rgba(5,6,9,.35) 63%);box-shadow:0 0 12px rgba(217,149,63,.55),0 0 10px rgba(217,149,63,.25) inset}
#nrc .boost .fuel{position:absolute;inset:-7px;border-radius:50%;
 -webkit-mask:radial-gradient(circle closest-side,transparent calc(100% - 5px),#000 calc(100% - 4px));mask:radial-gradient(circle closest-side,transparent calc(100% - 5px),#000 calc(100% - 4px))}
#nrc .boost.dn{transform:scale(.93);background:radial-gradient(circle,rgba(219,153,77,.55) 0 62%,rgba(92,51,26,.5) 63%);box-shadow:0 0 22px rgba(232,180,100,.9),0 0 16px rgba(245,214,158,.5) inset;color:#fff4dc}
#nrc .boost.burn{animation:nrcBurn .18s infinite alternate}
#nrc .siren{border:2px solid rgba(201,88,74,.5);color:#a88a80;text-shadow:none;box-shadow:0 0 6px rgba(201,88,74,.25)}
#nrc .siren.ready{border-color:#c9584a;color:#f0c0b0;text-shadow:0 0 6px rgba(201,88,74,.9);opacity:1;animation:nrcReady 1s infinite}
#nrc .siren.dn{transform:scale(.92)}
#nrc .siren.no{animation:nrcNo .25s}
@keyframes nrcReady{0%,100%{box-shadow:0 0 10px rgba(201,88,74,.7)}50%{box-shadow:0 0 22px rgba(201,88,74,1),0 0 10px rgba(122,179,184,.6) inset}}
@keyframes nrcBurn{from{box-shadow:0 0 18px rgba(232,180,100,.8)}to{box-shadow:0 0 30px rgba(245,214,158,1)}}
@keyframes nrcNo{0%,100%{margin-left:0}25%{margin-left:-5px}75%{margin-left:5px}}`;

  function buildDom() {
    const ui = document.getElementById('ui') || document.body;
    if (!document.getElementById('nrc-css')) { const s = document.createElement('style'); s.id = 'nrc-css'; s.textContent = CSS; document.head.appendChild(s); }
    root = document.createElement('div'); root.id = 'nrc';
    root.innerHTML = '<div class="base"><i></i><i></i><i></i><i></i></div><div class="knob"><b></b></div>' +
      '<div class="btn siren"><span>SIREN</span></div><div class="btn boost"><div class="fuel"></div><span>BOOST</span></div>';
    ui.appendChild(root);
    el = { base: root.querySelector('.base'), knob: root.querySelector('.knob'), boost: root.querySelector('.boost'), siren: root.querySelector('.siren'),
      fuel: root.querySelector('.fuel'), arrows: root.querySelectorAll('.base i') };
    el.siren.addEventListener('animationend', () => el.siren.classList.remove('no'));
  }

  // ---- stick ----
  const stick = { id: null, bx: 0, by: 0, x: 0, y: 0, mx: 0, my: 0 };
  let knobX = NaN, knobY = NaN, baseX = NaN, baseY = NaN, arrowMask = -1;
  function stickHome() { stick.bx = stick.x = L.stickHomeX; stick.by = stick.y = L.stickHomeY; stick.mx = stick.my = 0; }
  function stickCalc() {
    let dx = stick.x - stick.bx, dy = stick.y - stick.by, len = Math.hypot(dx, dy);
    const lim = L.R * 1.1;
    if (len > lim) { const f = (len - lim) / len; stick.bx = clamp(stick.bx + dx * f, L.R * 0.9, L.w - L.R * 0.9); stick.by = clamp(stick.by + dy * f, L.top, L.h - L.R * 0.9); dx = stick.x - stick.bx; dy = stick.y - stick.by; len = Math.hypot(dx, dy); }
    const raw = Math.min(1, len / L.R), m = raw < DEAD ? 0 : (raw - DEAD) / (1 - DEAD);
    stick.mx = len > 0 ? dx / len * m : 0; stick.my = len > 0 ? -dy / len * m : 0;
  }
  function stickRelease() { stick.id = null; stickHome(); }

  // ---- touch ----
  const owner = new Map(); // touch id -> 'stick' | 'boost' | 'siren'
  let boostTouches = 0, sirenTouches = 0;
  const isTarget = t => t && t.closest && t.closest('button,a,input,select,textarea,label,[data-tap]');
  function local(t) {
    const v = core && core.view;
    if (v) return [t.clientX - v.left, t.clientY - v.top];
    const r = (root || document.body).getBoundingClientRect(); return [t.clientX - r.left, t.clientY - r.top];
  }
  const inPlay = () => !!core && core.state === 'PLAY';
  function onTouchStart(e) {
    touchSeen = true; pend.any = true; lastDevice = 'touch';
    if (!inPlay()) return;
    if (cachedW !== (core.view ? core.view.w : cachedW) || cachedH !== (core.view ? core.view.h : cachedH)) layout();
    let used = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (isTarget(t.target)) continue;
      const [x, y] = local(t);
      const ds = Math.hypot(x - L.sx, y - L.sy), db = Math.hypot(x - L.bx, y - L.by);
      if (ds < L.sr * 1.3 && ds < db) { owner.set(t.identifier, 'siren'); sirenTouches++; pend.siren = true; sirenPressFx(); used = true; }
      else if (db < L.br * 1.45 || (x > L.w * 0.55 && y > L.by - L.br * 0.4)) { owner.set(t.identifier, 'boost'); boostTouches++; used = true; }
      else if (x < L.w * 0.55 && y > L.top && stick.id === null) {
        stick.id = t.identifier; owner.set(t.identifier, 'stick');
        stick.bx = clamp(x, L.R * 0.9, L.w * 0.55 - L.R * 0.5); stick.by = clamp(y, L.top + L.R * 0.9, L.h - L.R * 0.9);
        stick.x = x; stick.y = y; stickCalc(); used = true;
      }
    }
    if (used && e.cancelable) e.preventDefault();
  }
  function onTouchMove(e) {
    let used = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const k = owner.get(t.identifier); if (!k) continue;
      used = true;
      if (k === 'stick') { const p = local(t); stick.x = p[0]; stick.y = p[1]; stickCalc(); }
    }
    if (used && e.cancelable) e.preventDefault();
  }
  function onTouchEnd(e) {
    let used = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const k = owner.get(t.identifier); if (!k) continue;
      owner.delete(t.identifier); used = true;
      if (k === 'stick') stickRelease();
      else if (k === 'boost') boostTouches = Math.max(0, boostTouches - 1);
      else if (k === 'siren') sirenTouches = Math.max(0, sirenTouches - 1);
    }
    if (used && e.cancelable) e.preventDefault();
  }
  function releaseTouches() { owner.clear(); boostTouches = sirenTouches = 0; stickRelease(); }
  function sirenPressFx() {
    const p = NR.player;
    if (el && !(p && p.siren >= 1)) { el.siren.classList.remove('no'); void el.siren.offsetWidth; el.siren.classList.add('no'); }
  }

  // ---- keyboard ----
  const keys = new Set();
  const GAME = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyQ', 'KeyP', 'Escape']);
  const typing = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  function onKeyDown(e) {
    if (typing(e.target)) return;
    const c = e.code;
    if (GAME.has(c) && (inPlay() || c.startsWith('Arrow') || c === 'Space')) e.preventDefault();
    lastDevice = 'keys';
    if (e.repeat) return;
    keys.add(c);
    pend.any = true;
    if (c === 'KeyE' || c === 'KeyQ') { if (inPlay()) { pend.siren = true; sirenPressFx(); } }
    else if (c === 'Escape' || c === 'KeyP') pend.pause = true;
  }
  function onKeyUp(e) { keys.delete(e.code); }
  const kd = (a, b) => keys.has(a) || keys.has(b);
  let kx = 0, ky = 0;

  // ---- gamepad (standard mapping) ----
  let padOn = false;
  const padPrev = new Uint8Array(20);
  const pad = { x: 0, y: 0, boost: false };
  const pdz = v => { const a = Math.abs(v); return a < PAD_DEAD ? 0 : Math.sign(v) * (a - PAD_DEAD) / (1 - PAD_DEAD); };
  function pollPad() {
    pad.x = pad.y = 0; pad.boost = false;
    if (!padOn || !navigator.getGamepads) return;
    let gp = null;
    try { const l = navigator.getGamepads(); for (let i = 0; i < l.length; i++) if (l[i] && l[i].connected) { gp = l[i]; break; } } catch (e) { return; }
    if (!gp) return;
    const B = gp.buttons, n = Math.min(B.length, 20);
    const bt = i => !!(B[i] && (B[i].pressed || B[i].value > 0.4));
    let x = pdz(gp.axes[0] || 0), y = -pdz(gp.axes[1] || 0);
    if (bt(14)) x -= 1; if (bt(15)) x += 1; if (bt(12)) y += 1; if (bt(13)) y -= 1;
    pad.x = clamp(x, -1, 1); pad.y = clamp(y, -1, 1);
    pad.boost = bt(0) || bt(7);
    let anyEdge = false;
    for (let i = 0; i < n; i++) { const d = bt(i); if (d && !padPrev[i]) { anyEdge = true; if (i === 2 || i === 3) { if (inPlay()) { pend.siren = true; sirenPressFx(); } } else if (i === 9) pend.pause = true; } padPrev[i] = d ? 1 : 0; }
    if (anyEdge) { pend.any = true; lastDevice = 'pad'; }
    else if (Math.abs(pad.x) + Math.abs(pad.y) > 0) lastDevice = 'pad';
  }

  // ---- visibility ----
  function setShown(on) {
    if (!root || on === shown) return;
    shown = on; root.classList.toggle('on', on);
    if (on) layout();
  }
  function neutral() { state.mx = state.my = 0; state.boost = false; kx = ky = 0; }

  // ---- per-frame visuals (style writes only when a value changes) ----
  let vBoostDn = null, vBurn = null, vReady = null, vSirenQ = -1, vFuelQ = -1, vSirenDn = null, vAct = null;
  function draw(boostDown) {
    const act = stick.id !== null;
    if (act !== vAct) { vAct = act; el.base.classList.toggle('act', act); el.knob.classList.toggle('act', act); }
    if (stick.bx !== baseX || stick.by !== baseY) {
      baseX = stick.bx; baseY = stick.by;
      el.base.style.transform = 'translate3d(' + (baseX - L.R) + 'px,' + (baseY - L.R) + 'px,0)';
    }
    let kx2 = stick.bx, ky2 = stick.by;
    if (act) { const dx = stick.x - stick.bx, dy = stick.y - stick.by, l = Math.hypot(dx, dy), m = Math.min(l, L.R); if (l > 0) { kx2 += dx / l * m; ky2 += dy / l * m; } }
    kx2 = Math.round(kx2); ky2 = Math.round(ky2);
    if (kx2 !== knobX || ky2 !== knobY) {
      knobX = kx2; knobY = ky2; const kr = Math.round(29 * L.k);
      el.knob.style.transform = 'translate3d(' + (knobX - kr) + 'px,' + (knobY - kr) + 'px,0)';
    }
    const mask = (state.my > 0.25 ? 1 : 0) | (state.mx > 0.25 ? 2 : 0) | (state.my < -0.25 ? 4 : 0) | (state.mx < -0.25 ? 8 : 0);
    if (mask !== arrowMask) { arrowMask = mask; for (let i = 0; i < 4; i++) el.arrows[i].classList.toggle('hot', !!(mask & (1 << i))); }
    if (boostDown !== vBoostDn) { vBoostDn = boostDown; el.boost.classList.toggle('dn', boostDown); }
    const p = NR.player;
    const burn = !!(p && p.boosting);
    if (burn !== vBurn) { vBurn = burn; el.boost.classList.toggle('burn', burn); }
    const fuel = p && typeof p.boostFuel === 'number' ? clamp(p.boostFuel, 0, 1) : 1;
    const fq = Math.round(fuel * 60);
    if (fq !== vFuelQ) {
      vFuelQ = fq; const a = (fq / 60 * 100).toFixed(1);
      el.fuel.style.background = 'conic-gradient(' + (fq >= 60 ? '#e8c890' : '#d9a050') + ' 0 ' + a + '%,rgba(84,102,107,.35) ' + a + '% 100%)';
    }
    const sv = p && typeof p.siren === 'number' ? clamp(p.siren, 0, 1) : 0;
    const ready = sv >= 1;
    if (ready !== vReady) { vReady = ready; el.siren.classList.toggle('ready', ready); }
    const sq = Math.round(sv * 50);
    if (sq !== vSirenQ) {
      vSirenQ = sq; const a = (sq * 2) + '%';
      el.siren.style.background = ready ? 'radial-gradient(circle,rgba(201,88,74,.55),rgba(77,26,23,.65))'
        : 'conic-gradient(rgba(201,88,74,.5) 0 ' + a + ',rgba(5,6,9,.45) ' + a + ' 100%)';
    }
    const sd = sirenTouches > 0 || keys.has('KeyE') || keys.has('KeyQ');
    if (sd !== vSirenDn) { vSirenDn = sd; el.siren.classList.toggle('dn', sd); }
  }

  // ---- module API ----
  function init(c) {
    core = c || NR.core || null;
    try { buildDom(); } catch (e) { console.error('[NR.controls.dom]', e); }
    const o = { passive: false };
    addEventListener('touchstart', onTouchStart, o);
    addEventListener('touchmove', onTouchMove, o);
    addEventListener('touchend', onTouchEnd, o);
    addEventListener('touchcancel', onTouchEnd, o);
    addEventListener('keydown', onKeyDown, true);
    addEventListener('keyup', onKeyUp, true);
    addEventListener('mousedown', () => { pend.any = true; });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('gesturestart', e => e.preventDefault());
    addEventListener('dblclick', e => e.preventDefault());
    addEventListener('gamepadconnected', () => { padOn = true; });
    if (navigator.getGamepads) { try { for (const g of navigator.getGamepads()) if (g) padOn = true; } catch (e) {} }
    const clear = () => { keys.clear(); releaseTouches(); };
    addEventListener('blur', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clear(); if (inPlay()) pend.pause = true; } });
    addEventListener('resize', () => { setTimeout(layout, 0); });
    stickHome(); layout();
  }

  function update(dt, c) {
    if (c) core = c;
    const s = core ? core.state : '';
    if (s !== lastState) { lastState = s; releaseTouches(); keys.forEach(k => { if (k !== 'Space' && !k.startsWith('Shift')) keys.delete(k); }); setShown(s === 'PLAY' && !!(touchSeen || (core && core.isTouch))); }
    else if (s === 'PLAY' && !shown && touchSeen) setShown(true);
    pollPad();
    const play = s === 'PLAY';
    if (play) {
      const step = KEY_RATE * (core.dt || dt || 0.016);
      const tx = (kd('KeyD', 'ArrowRight') ? 1 : 0) - (kd('KeyA', 'ArrowLeft') ? 1 : 0);
      const ty = (kd('KeyW', 'ArrowUp') ? 1 : 0) - (kd('KeyS', 'ArrowDown') ? 1 : 0);
      let r = tx === 0 || tx * kx < 0 ? step * 1.6 : step; kx += clamp(tx - kx, -r, r);
      r = ty === 0 || ty * ky < 0 ? step * 1.6 : step; ky += clamp(ty - ky, -r, r);
      state.mx = clamp(stick.mx + kx + pad.x, -1, 1);
      state.my = clamp(stick.my + ky + pad.y, -1, 1);
      state.boost = boostTouches > 0 || keys.has('Space') || kd('ShiftLeft', 'ShiftRight') || pad.boost;
    } else neutral();
    state.siren = play && pend.siren;
    state.pause = pend.pause;
    state.any = pend.any;
    pend.siren = pend.pause = pend.any = false;
    if (shown && el) draw(state.boost);
    keyHud(play);
  }

  // Keyboard players get a small key panel (bottom of the screen): BOOST and SIREN keys, SIREN lights up when ready.
  let kh = null, khOn = false, khReady = null, khFuel = -1;
  function keyHud(play) {
    const on = play && !shown && !(core && core.isTouch) && lastDevice !== 'touch';
    if (!kh) {
      const ui = document.getElementById('ui'); if (!ui) return;
      kh = document.createElement('div'); kh.id = 'nrkeys';
      kh.style.cssText = 'position:absolute;left:0;right:0;bottom:18px;display:none;justify-content:center;gap:14px;font-family:"Courier New",monospace;font-size:13px;letter-spacing:2px;pointer-events:none;z-index:6';
      kh.innerHTML = '<div class="k b" style="padding:7px 12px;border:2px solid #d9a050;color:#f0d8a8;background:rgba(5,6,9,.6)"><b style="color:#fff">SPACE</b> BOOST</div>' +
        '<div class="k s" style="padding:7px 12px;border:2px solid #54666b;color:#8a9496;background:rgba(5,6,9,.6)"><b>E</b> SIREN <span class="st">CHARGING</span></div>';
      ui.appendChild(kh);
    }
    if (on !== khOn) { khOn = on; kh.style.display = on ? 'flex' : 'none'; }
    if (!on) return;
    const p = NR.player, ready = !!(p && p.siren >= 1);
    if (ready !== khReady) {
      khReady = ready; const sEl = kh.querySelector('.s');
      sEl.style.borderColor = ready ? '#c9584a' : '#54666b'; sEl.style.color = ready ? '#f0c0b0' : '#8a9496';
      sEl.style.boxShadow = ready ? '0 0 12px rgba(201,88,74,.9)' : 'none';
      sEl.querySelector('b').style.color = ready ? '#fff' : '#8a9496';
      sEl.querySelector('.st').textContent = ready ? 'READY' : 'CHARGING';
    }
    const fuel = p ? Math.round((p.boostFuel || 0) * 10) : 10;
    if (fuel !== khFuel) { khFuel = fuel; kh.querySelector('.b').style.opacity = 0.45 + fuel * 0.055; }
  }

  function reset() { releaseTouches(); neutral(); pend.siren = pend.pause = pend.any = false; state.siren = state.pause = state.any = false; }

  NR.controls = { state, init, update, reset, layout,
    get root() { return root; }, get els() { return el; }, get lastDevice() { return lastDevice; }, get stick() { return stick; },
    get touchLayout() { return L; } };
})();
