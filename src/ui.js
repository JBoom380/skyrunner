// NEON RAIN ui: title screen (draft A, no subtitle), menus, HUD, pause and results. All DOM lives inside #ui. See SPEC.md.
// NR.ui = { init, update, reset, screen, artMode, ember, open(name), move(d), activate(), back(), runs(), showDead() }
(function () {
  window.NR = window.NR || {};
  const C = NR.cfg || {};
  const RUNS_KEY = 'neonRain.runs';
  const DNAMES = (NR.DISTRICTS || []).map(d => d.name);
  const fmt = n => Math.max(0, Math.floor(n || 0)).toLocaleString('en-US');
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const emit = (e, d) => { if (NR.bus && NR.bus.emit) NR.bus.emit(e, d); };
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (e) {} };

  // ---------------------------------------------------------------- CSS
  const CSS = `
#nru{position:absolute;inset:0;pointer-events:none;font-family:"Courier New",monospace;color:#e8c890;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
#nru button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
#nru .lay{position:absolute;inset:0;transition:opacity .4s,visibility .4s}
#nru .lay.off{opacity:0;visibility:hidden}
#nru .lay.off *{pointer-events:none!important}
#nru canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges}
#nru .ttl{z-index:10;background:#050609}
#nru .shade{position:absolute;inset:0;background:linear-gradient(to top,rgba(5,6,9,.82) 0,rgba(5,6,9,.55) 30%,rgba(5,6,9,0) 52%)}
#nru .logo{position:absolute;left:.43em;top:5.5%;margin:0;font-size:3.7em;font-weight:bold;letter-spacing:.11em;line-height:.98;color:#f0d8a8;
 text-shadow:0 0 .32em #d9953f,0 0 .06em #fff,0 0 .9em rgba(217,149,63,.45)}
#nru .logo.buzz{opacity:.72;text-shadow:0 0 .12em #d9953f}
#nru .menu{position:absolute;left:1.6em;top:57.5%;transition:opacity .25s}
#nru .menu button{display:block;height:3.5em;min-width:15em;text-align:left;font-size:1.06em;letter-spacing:.2em;color:#b9a27a;
 text-shadow:0 0 .5em rgba(217,149,63,.55)}
#nru .menu button i{display:inline-block;width:1.3em;font-style:normal;opacity:0}
#nru .menu button.sel{color:#fff;text-shadow:0 0 .6em #d9953f,0 0 .15em #d9953f}
#nru .menu button.sel i{opacity:1}
#nru .foot{position:absolute;left:0;right:0;bottom:calc(1.3em + env(safe-area-inset-bottom,0px));text-align:center;font-size:.64em;letter-spacing:.16em;color:#7f8f90;white-space:pre}
#nru .panel{position:absolute;left:1.1em;right:1.1em;top:29%;bottom:calc(4.2em + env(safe-area-inset-bottom,0px));padding:1.1em 1.2em;box-sizing:border-box;
 background:rgba(5,6,9,.86);border:1px solid rgba(217,160,80,.45);box-shadow:0 0 1.2em rgba(217,149,63,.18),inset 0 0 2em rgba(0,0,0,.6);display:none;flex-direction:column}
#nru .panel.on{display:flex}
#nru .panel h3{margin:0 0 .9em;font-size:1em;letter-spacing:.3em;color:#f0d8a8;text-shadow:0 0 .5em #d9953f;font-weight:bold}
#nru .panel .body{flex:1;overflow:hidden}
#nru .panel .back{height:3.5em;align-self:flex-start;min-width:9em;text-align:left;letter-spacing:.22em;color:#b9a27a}
#nru .panel .back.sel{color:#fff;text-shadow:0 0 .6em #d9953f}
#nru .runs{width:100%;border-collapse:collapse;font-size:.82em;letter-spacing:.06em}
#nru .runs td{padding:.55em 0;border-bottom:1px solid rgba(143,176,180,.16);vertical-align:top}
#nru .runs td.n{color:#8fb0b4;width:1.6em}
#nru .runs td.s{color:#f0d8a8;text-shadow:0 0 .4em rgba(217,149,63,.6);font-weight:bold}
#nru .runs td.k{color:#8fb0b4;text-align:right}
#nru .runs .d{display:block;font-size:.78em;color:#9a8a6a;font-weight:normal;text-shadow:none;margin-top:.2em;letter-spacing:.12em}
#nru .empty{color:#7f8f90;font-size:.8em;letter-spacing:.14em;line-height:1.8}
#nru .row{display:flex;align-items:center;min-height:3.5em;gap:.6em;letter-spacing:.16em}
#nru .row .lab{width:6em;font-size:.86em;color:#8fb0b4}
#nru .row.sel .lab{color:#f0d8a8;text-shadow:0 0 .5em #d9953f}
#nru .sld{flex:1;height:3.5em;display:flex;align-items:center;gap:3px;pointer-events:auto;touch-action:none;cursor:pointer}
#nru .sld b{flex:1;height:1.15em;background:rgba(54,69,76,.55);border:1px solid rgba(143,176,180,.18)}
#nru .sld b.on{background:#d9a050;border-color:#f0d8a8;box-shadow:0 0 .35em rgba(217,149,63,.75)}
#nru .row .val{width:2.6em;font-size:.86em;text-align:right;color:#e8c890}
#nru .tg{height:4.07em;font-size:.86em;flex:1;border:1px solid rgba(143,176,180,.3)!important;color:#8fb0b4;letter-spacing:.2em}
#nru .tg.on{border-color:#d9a050!important;color:#f0d8a8;background:rgba(217,149,63,.16);text-shadow:0 0 .5em #d9953f}
#nru .wide{flex:1;height:4.07em;font-size:.86em;border:1px solid rgba(201,88,74,.45)!important;color:#c9584a;letter-spacing:.2em}
#nru .wide.arm{background:rgba(201,88,74,.2);color:#f0c0b0;border-color:#c9584a!important}
#nru .cred{font-size:.82em;letter-spacing:.14em;line-height:1.55}
#nru .cred p{margin:0 0 1.3em}#nru .cred span{display:block;color:#8fb0b4;font-size:.8em;letter-spacing:.24em;margin-bottom:.25em}
#nru .cred b{color:#f0d8a8;font-weight:bold;text-shadow:0 0 .45em rgba(217,149,63,.6)}
/* HUD */
#nru .hud{z-index:4;padding-top:env(safe-area-inset-top,0px)}
#nru .tl{position:absolute;left:1.1em;top:calc(1em + env(safe-area-inset-top,0px))}
#nru .sc{font-size:1.4em;line-height:1.1;font-weight:bold;letter-spacing:.12em;color:#f0d8a8;text-shadow:0 0 .4em #d9953f}
#nru .bars{margin-top:.9em;font-size:.58em;letter-spacing:.2em;color:#8fb0b4}
#nru .bar{display:flex;align-items:center;gap:.6em;margin-bottom:.5em}
#nru .bar u{text-decoration:none;width:4.6em}
#nru .bar s{display:block;width:9em;height:.62em;background:rgba(36,48,56,.7);border:1px solid rgba(143,176,180,.25);position:relative;overflow:hidden}
#nru .bar s em{position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:0 50%;background:#d9a050;box-shadow:0 0 .5em #d9953f}
#nru .bar.sir s em{background:#9e4236;box-shadow:none}
#nru .bar.sir.rdy u{color:#f0c0b0}#nru .bar.sir.rdy s em{background:#c9584a;box-shadow:0 0 .6em #c9584a;animation:nruBl .5s steps(2) infinite}
#nru .rt{position:absolute;right:1.1em;top:calc(1em + env(safe-area-inset-top,0px));text-align:right}
#nru .kmh{font-size:.82em;letter-spacing:.14em;color:#e8c890;text-shadow:0 0 .4em rgba(217,149,63,.7)}
#nru .kmh small{font-size:.8em;color:#b9a27a}
#nru .hull{margin-top:.35em;font-size:.6em;letter-spacing:.22em;color:#8fb0b4;display:flex;justify-content:flex-end;align-items:center;gap:.45em}
#nru .hull i{display:inline-block;width:1.05em;height:1.05em;background:#7ab3b8;box-shadow:0 0 .5em rgba(122,179,184,.8)}
#nru .hull i.x{background:transparent;border:1px solid rgba(201,88,74,.7);box-shadow:none;box-sizing:border-box}
#nru .hull.low i:not(.x){background:#c9584a;box-shadow:0 0 .6em #c9584a;animation:nruBl .4s steps(2) infinite}
#nru .pz{position:absolute;left:50%;top:calc(.35em + env(safe-area-inset-top,0px));width:3.5em;height:3.5em;margin-left:-1.75em;display:flex;align-items:center;justify-content:center}
#nru .pz span{width:2.1em;height:2.1em;border:1px solid rgba(143,176,180,.55);display:flex;align-items:center;justify-content:center;gap:.28em;background:rgba(5,6,9,.35)}
#nru .pz span i{width:.28em;height:.85em;background:#8fb0b4}
#nru .ban{position:absolute;left:0;right:0;top:17%;text-align:center;font-size:.72em;letter-spacing:.24em;line-height:1.7;color:#e8c890;text-shadow:0 0 .5em #d9953f;opacity:0;white-space:nowrap}
#nru .ban span{display:block;font-size:.85em;color:#8fb0b4}
#nru .ban b{font-weight:normal}#nru .ban b:before,#nru .ban b:after{content:'';display:inline-block;width:1.6em;height:1px;background:rgba(217,160,80,.6);vertical-align:middle;margin:0 .8em}
#nru .ban.go{animation:nruBan 3s linear forwards}
#nru .pop{position:absolute;left:0;right:0;top:41%;text-align:center;opacity:0;font-weight:bold;pointer-events:none}
#nru .pop b{display:block;font-size:1.45em;letter-spacing:.14em;color:#f0d8a8;text-shadow:0 0 .35em #d9953f,0 0 .08em #fff}
#nru .pop small{display:block;margin-top:.25em;font-size:.85em;letter-spacing:.2em;color:#d9a050}
#nru .pop.go{animation:nruPop 1.15s ease-out forwards}
#nru .edge{position:absolute;inset:0;opacity:0;box-shadow:inset 0 0 3.2em 1.1em rgba(201,88,74,.9);border:3px solid rgba(201,88,74,.55)}
#nru .edge.go{animation:nruEdge .55s ease-out}
/* PAUSE and DEAD */
#nru .ov{z-index:12;background:rgba(5,6,9,.74);display:flex;flex-direction:column;align-items:center;justify-content:center}
#nru .ov h2{margin:0 0 1.6em;font-size:1.9em;letter-spacing:.24em;color:#f0d8a8;text-shadow:0 0 .4em #d9953f}
#nru .big{display:block;width:13.5em;height:3.5em;margin:.45em 0;border:1px solid rgba(217,160,80,.5)!important;letter-spacing:.24em;color:#e8c890;background:rgba(5,6,9,.4)}
#nru .big.sel{border-color:#f0d8a8!important;color:#fff;background:rgba(217,149,63,.18);text-shadow:0 0 .6em #d9953f;box-shadow:0 0 .8em rgba(217,149,63,.35)}
#nru .dead{background:linear-gradient(rgba(5,6,9,.55),rgba(5,6,9,.9) 40%,rgba(5,6,9,.94))}
#nru .dead h2{color:#c9584a;text-shadow:0 0 .4em #c9584a,0 0 .08em #f0c0b0;margin-bottom:.9em;font-size:1.6em}
#nru .fs{font-size:2.6em;font-weight:bold;letter-spacing:.1em;color:#f0d8a8;text-shadow:0 0 .35em #d9953f}
#nru .nb{margin:.5em 0 0;height:1.4em;font-size:.86em;letter-spacing:.34em;color:#050609;background:#e8c890;padding:.15em .8em 0;box-shadow:0 0 1em #d9953f;visibility:hidden}
#nru .nb.on{visibility:visible;animation:nruBl .6s steps(2) infinite}
#nru .st{margin:1.4em 0 1.2em;width:17.5em;font-size:.8em;letter-spacing:.14em}
#nru .st div{display:flex;justify-content:space-between;padding:.6em 0;border-bottom:1px solid rgba(143,176,180,.16)}
#nru .st span{color:#8fb0b4}#nru .st b{color:#e8c890;text-align:right}
#nru .btns{display:flex;gap:.8em}
#nru .btns .big{width:8.2em}
#nru .dead.hold *{pointer-events:none!important}
@keyframes nruBl{0%{opacity:1}100%{opacity:.35}}
@keyframes nruBan{0%{opacity:0;letter-spacing:.6em}12%{opacity:1;letter-spacing:.26em}80%{opacity:1}100%{opacity:0}}
@keyframes nruPop{0%{opacity:0;transform:translateY(.4em) scale(1.35)}12%{opacity:1;transform:translateY(0) scale(1)}70%{opacity:1}100%{opacity:0;transform:translateY(-2.2em) scale(.96)}}
@keyframes nruEdge{0%{opacity:1}100%{opacity:0}}
`;

  // ---------------------------------------------------------------- state
  let core = null, root = null, E = {}, built = false;
  let lastState = '', lastW = 0, lastH = 0;
  const ui = NR.ui = {
    init, update, reset, screen: 'title', artMode: 'loading', ember: [0.815, 0.42],
    open, move, activate, back, runs: loadRuns, showDead,
  };

  // ---------------------------------------------------------------- build DOM
  function h(tag, cls, html, parent) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
  function build() {
    const host = document.getElementById('ui') || document.body;
    if (!document.getElementById('nru-css')) { const s = document.createElement('style'); s.id = 'nru-css'; s.textContent = CSS; document.head.appendChild(s); }
    root = h('div', '', null, host); root.id = 'nru';

    // TITLE
    const t = E.title = h('div', 'lay ttl', null, root);
    E.bg = h('canvas', '', null, t); E.fx = h('canvas', '', null, t); E.fx.width = 270; E.fx.height = 480;
    h('div', 'shade', null, t);
    E.logo = h('h1', 'logo', 'NEON<br>RAIN', t);
    E.menu = h('div', 'menu', null, t);
    E.menuBtns = ['START PURSUIT', 'BEST RUNS', 'SETTINGS', 'CREDITS'].map((s, i) => {
      const b = h('button', '', '<i>&#9656;</i>' + s, E.menu); b.dataset.i = i;
      b.addEventListener('pointerdown', () => { if (ui.screen === 'title') setSel(i); });
      b.addEventListener('click', () => { if (ui.screen === 'title') { setSel(i); activate(); } });
      return b;
    });
    E.foot = h('div', 'foot', '', t);
    // sub panels
    E.pBest = panel('BEST RUNS'); E.pSet = panel('SETTINGS'); E.pCred = panel('CREDITS');
    E.pCred.body.innerHTML = '<div class="cred"><p><span>A GAME BY</span><b>JOHN SLAGBOOM</b></p>' +
      '<p><span>MUSIC BY JOHN SLAGBOOM</span><b>RAINY SAX</b><br><b>OLD SCHOOL TEST 1</b></p><p><span>BUILT WITH</span><b>THREE.JS</b></p></div>';
    buildSettings();

    // HUD
    const hd = E.hud = h('div', 'lay hud off', null, root);
    E.edge = h('div', 'edge', null, hd);
    const tl = h('div', 'tl', null, hd);
    E.sc = h('div', 'sc', '0', tl);
    E.bars = h('div', 'bars', '<div class="bar"><u>BOOST</u><s><em></em></s></div><div class="bar sir"><u>SIREN</u><s><em></em></s></div>', tl);
    const bs = E.bars.querySelectorAll('.bar'); E.fuel = bs[0].querySelector('em'); E.sirBar = bs[1]; E.sir = bs[1].querySelector('em');
    E.rt = h('div', 'rt', '<div class="kmh"><span>0</span> <small>KM/H</small></div><div class="hull">HULL <i></i><i></i><i></i></div>', hd);
    E.kmh = E.rt.querySelector('.kmh span'); E.hull = E.rt.querySelector('.hull'); E.pips = E.hull.querySelectorAll('i');
    E.pz = h('button', 'pz', '<span><i></i><i></i></span>', hd); E.pz.setAttribute('aria-label', 'pause');
    E.pz.addEventListener('click', () => { if (core && core.state === 'PLAY') { emit('ui', { action: 'pause' }); core.pause(true); } });
    E.ban = h('div', 'ban', '', hd);
    E.pops = [0, 1, 2].map(() => { const p = h('div', 'pop', '<b></b><small></small>', hd); p.addEventListener('animationend', () => p.classList.remove('go')); return p; });
    E.ban.addEventListener('animationend', () => E.ban.classList.remove('go'));
    E.edge.addEventListener('animationend', () => E.edge.classList.remove('go'));

    // PAUSE
    E.pause = h('div', 'lay ov off', '<h2>PAUSED</h2>', root);
    E.pauseBtns = [['RESUME', () => { if (core) core.pause(false); }], ['QUIT TO TITLE', () => { if (core) core.toTitle(); }]].map(([s, f], i) => {
      const b = h('button', 'big', s, E.pause); b.addEventListener('click', () => { emit('ui', { action: i ? 'quit' : 'resume' }); f(); }); return b;
    });

    // DEAD
    E.dead = h('div', 'lay ov dead off hold', '<h2>PURSUIT ENDED</h2><div class="fs">0</div><div class="nb">NEW BEST</div><div class="st"></div><div class="btns"></div>', root);
    E.fs = E.dead.querySelector('.fs'); E.nb = E.dead.querySelector('.nb'); E.st = E.dead.querySelector('.st');
    const bw = E.dead.querySelector('.btns');
    E.deadBtns = [['RETRY', () => { if (core) core.start(); }], ['MENU', () => { if (core) core.toTitle(); }]].map(([s, f], i) => {
      const b = h('button', 'big', s, bw); b.addEventListener('click', () => { emit('ui', { action: i ? 'menu' : 'retry' }); f(); }); return b;
    });
    built = true;
  }
  function panel(title) {
    const p = h('div', 'panel', '<h3>' + title + '</h3>', E.title);
    p.body = h('div', 'body', '', p);
    p.backBtn = h('button', 'back', '&#9666; BACK', p);
    p.backBtn.addEventListener('click', () => back());
    return p;
  }

  // ---------------------------------------------------------------- settings
  const SEG = 10;
  function buildSettings() {
    const b = E.pSet.body; E.setRows = [];
    for (const key of ['music', 'sfx']) {
      const r = h('div', 'row', '<span class="lab">' + key.toUpperCase() + '</span>', b);
      const s = h('div', 'sld', new Array(SEG + 1).join('<b></b>'), r); s.dataset.tap = '1';
      const v = h('span', 'val', '', r);
      const set = ev => { const rc = s.getBoundingClientRect(); setVol(key, Math.round(clamp((ev.clientX - rc.left) / rc.width, 0, 1) * SEG) / SEG); };
      s.addEventListener('pointerdown', ev => { s.setPointerCapture && s.setPointerCapture(ev.pointerId); s.drag = true; set(ev); selRow(E.setRows.indexOf(r)); });
      s.addEventListener('pointermove', ev => { if (s.drag) set(ev); });
      const end = () => { if (s.drag) { s.drag = false; emit('ui', { action: 'click' }); } };
      s.addEventListener('pointerup', end); s.addEventListener('pointercancel', end);
      r.kind = 'vol'; r.key = key; r.segs = s.querySelectorAll('b'); r.val = v; E.setRows.push(r);
    }
    const q = h('div', 'row', '<span class="lab">QUALITY</span>', b); q.kind = 'q';
    q.btns = ['high', 'low'].map(m => { const t = h('button', 'tg', m.toUpperCase(), q); t.addEventListener('click', () => { setQ(m); selRow(E.setRows.indexOf(q)); }); return t; });
    E.setRows.push(q);
    const rb = h('div', 'row', '', b); rb.kind = 'reset';
    rb.btn = h('button', 'wide', 'RESET BEST', rb); rb.btn.addEventListener('click', () => { resetBest(); selRow(E.setRows.indexOf(rb)); });
    E.setRows.push(rb);
  }
  function setVol(key, v) {
    if (!core) return;
    core.settings[key] = v;
    const a = NR.audio; if (a) { if (key === 'music' && a.setMusic) a.setMusic(v); if (key === 'sfx' && a.setSfx) a.setSfx(v); }
    if (core.saveSettings) core.saveSettings();
    paintSettings();
  }
  function setQ(m) {
    if (!core) return;
    if (core.settings.quality !== m) { if (core.setQuality) core.setQuality(m); else { core.settings.quality = m; if (core.saveSettings) core.saveSettings(); } }
    emit('ui', { action: 'select' }); paintSettings();
  }
  let resetArm = 0;
  function resetBest() {
    if (!resetArm) { resetArm = 3; E.setRows[3].btn.classList.add('arm'); E.setRows[3].btn.textContent = 'TAP AGAIN TO CONFIRM'; emit('ui', { action: 'click' }); return; }
    resetArm = 0; if (core) core.best = 0;
    lsDel(C.BEST_KEY || 'neonRain.best'); lsDel(RUNS_KEY);
    E.setRows[3].btn.classList.remove('arm'); E.setRows[3].btn.textContent = 'BEST CLEARED';
    emit('ui', { action: 'confirm' }); paintFoot(true);
  }
  function paintSettings() {
    if (!core) return;
    for (const r of E.setRows) {
      if (r.kind === 'vol') { const v = clamp(+core.settings[r.key] || 0, 0, 1), n = Math.round(v * SEG); r.segs.forEach((s, i) => s.classList.toggle('on', i < n)); r.val.textContent = Math.round(v * 100); }
      else if (r.kind === 'q') r.btns.forEach((t, i) => t.classList.toggle('on', (i ? 'low' : 'high') === core.settings.quality));
    }
  }
  function selRow(i) { setI = i; E.setRows.forEach((r, j) => r.classList.toggle('sel', j === i)); E.pSet.backBtn.classList.toggle('sel', i === E.setRows.length); }
  let setI = 0;

  // ---------------------------------------------------------------- runs (top 5)
  function loadRuns() { const r = lsGet(RUNS_KEY); return Array.isArray(r) ? r : []; }
  function saveRun(d) {
    const r = loadRuns(); r.push({ score: d.score | 0, dist: d.dist | 0, district: d.district | 0, loop: d.loop | 0, t: Date.now() });
    r.sort((a, b) => b.score - a.score); lsSet(RUNS_KEY, r.slice(0, 5));
  }
  const dLabel = (d, loop) => 'DISTRICT ' + ((d | 0) + 1) + ' // ' + (DNAMES[d | 0] || '?') + (loop > 0 ? ' // CYCLE ' + ((loop | 0) + 1) : '');
  function paintBest() {
    const r = loadRuns();
    if (!r.length) { E.pBest.body.innerHTML = '<div class="empty">NO RUNS ON FILE.<br>FLY A PURSUIT TO SET ONE.</div>'; return; }
    E.pBest.body.innerHTML = '<table class="runs">' + r.map((x, i) =>
      `<tr><td class="n">${i + 1}</td><td class="s">${fmt(x.score)}<span class="d">${dLabel(x.district, x.loop)}</span></td><td class="k">${(x.dist / 1000).toFixed(2)} KM</td></tr>`).join('') + '</table>';
  }

  // ---------------------------------------------------------------- navigation
  let menuI = 0, ovI = 0;
  function setSel(i) { menuI = (i + 4) % 4; E.menuBtns.forEach((b, j) => b.classList.toggle('sel', j === menuI)); }
  function setOv(btns, i) { ovI = (i + btns.length) % btns.length; btns.forEach((b, j) => b.classList.toggle('sel', j === ovI)); }
  function open(name) {
    if (!built) return;
    ui.screen = name;
    const sub = name === 'best' || name === 'settings' || name === 'credits';
    E.menu.style.opacity = sub ? '0' : '1'; E.menu.style.visibility = sub ? 'hidden' : 'visible';
    E.pBest.classList.toggle('on', name === 'best'); E.pSet.classList.toggle('on', name === 'settings'); E.pCred.classList.toggle('on', name === 'credits');
    E.pBest.backBtn.classList.add('sel'); E.pCred.backBtn.classList.add('sel');
    if (name === 'best') paintBest();
    if (name === 'settings') { resetArm = 0; const rb = E.setRows[3].btn; rb.classList.remove('arm'); rb.textContent = 'RESET BEST'; paintSettings(); selRow(0); }
  }
  function activate() {
    if (!core) return;
    const s = ui.screen;
    if (s === 'title') {
      if (menuI === 0) { emit('ui', { action: 'start' }); if (NR.audio && NR.audio.unlock) { try { NR.audio.unlock(); } catch (e) {} } core.start(); }
      else { emit('ui', { action: 'select' }); open(['', 'best', 'settings', 'credits'][menuI]); }
    } else if (s === 'best' || s === 'credits') back();
    else if (s === 'settings') { const r = E.setRows[setI]; if (!r) back(); else if (r.kind === 'reset') resetBest(); else if (r.kind === 'q') setQ(core.settings.quality === 'high' ? 'low' : 'high'); }
    else if (s === 'pause') E.pauseBtns[ovI].click();
    else if (s === 'dead' && deadShown) E.deadBtns[ovI].click();
  }
  function back() { if (ui.screen === 'best' || ui.screen === 'settings' || ui.screen === 'credits') { emit('ui', { action: 'back' }); open('title'); } }
  function move(d) {
    const s = ui.screen;
    if (s === 'title') { setSel(menuI + d); emit('ui', { action: 'click' }); }
    else if (s === 'settings') { selRow(clamp(setI + d, 0, E.setRows.length)); }
    else if (s === 'pause') setOv(E.pauseBtns, ovI + d);
    else if (s === 'dead') setOv(E.deadBtns, ovI + d);
  }
  function adjust(d) {
    if (ui.screen === 'settings') { const r = E.setRows[setI]; if (r && r.kind === 'vol') setVol(r.key, clamp(Math.round((+core.settings[r.key] || 0) * SEG + d) / SEG, 0, 1)); else if (r && r.kind === 'q') setQ(d < 0 ? 'high' : 'low'); }
    else if (ui.screen === 'dead') move(d);
  }
  function onKey(e) {
    if (!core || e.repeat) return;
    const c = e.code, st = core.state;
    if (st === 'PLAY') { if (!NR.controls && (c === 'Escape' || c === 'KeyP')) core.pause(true); return; }
    if (st === 'PAUSE' && !NR.controls && (c === 'Escape' || c === 'KeyP')) { core.pause(false); return; }
    if (c === 'ArrowUp' || c === 'KeyW') move(-1);
    else if (c === 'ArrowDown' || c === 'KeyS') move(1);
    else if (c === 'ArrowLeft' || c === 'KeyA') adjust(-1);
    else if (c === 'ArrowRight' || c === 'KeyD') adjust(1);
    else if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') { e.preventDefault(); activate(); }
    else if (c === 'Escape' || c === 'Backspace') back();
  }

  // ---------------------------------------------------------------- state sync
  function sync(st) {
    lastState = st;
    E.title.classList.toggle('off', st !== 'TITLE');
    E.hud.classList.toggle('off', st !== 'PLAY' && st !== 'PAUSE');
    E.pause.classList.toggle('off', st !== 'PAUSE');
    if (st !== 'DEAD') { E.dead.classList.add('off'); deadShown = false; clearTimeout(deadTimer); }
    if (st === 'TITLE') { open('title'); setSel(0); paintFoot(true); }
    else if (st === 'PLAY') ui.screen = 'hud';
    else if (st === 'PAUSE') { ui.screen = 'pause'; setOv(E.pauseBtns, 0); }
    else if (st === 'DEAD') { ui.screen = 'dead'; E.hud.classList.add('off'); }
  }

  // ---------------------------------------------------------------- DEAD results
  let deadShown = false, deadTimer = 0, lastRun = null, countT = 0;
  function showDead() {
    if (!lastRun) return;
    const d = lastRun;
    E.fs.textContent = '0'; countT = 0;
    E.nb.classList.toggle('on', !!d.isBest);
    E.st.innerHTML = `<div><span>BEST</span><b>${fmt(d.best)}</b></div><div><span>DISTANCE</span><b>${(d.dist / 1000).toFixed(2)} KM</b></div>` +
      `<div><span>NEAR MISSES</span><b>${d.nearMisses | 0}</b></div><div><span>REACHED</span><b>${(d.district | 0) + 1} // ${DNAMES[d.district | 0] || '?'}${d.loop > 0 ? '<br>CYCLE ' + ((d.loop | 0) + 1) : ''}</b></div>`;
    setOv(E.deadBtns, 0);
    E.dead.classList.remove('off'); deadShown = true;
    setTimeout(() => E.dead.classList.remove('hold'), 450);
  }

  // ---------------------------------------------------------------- HUD values (only touch the DOM on change)
  let vScore = -1, vKmh = -1, vHull = -1, vFuel = -1, vSir = -1, vRdy = null;
  function hud() {
    const sc = Math.floor(core.score || 0);
    if (sc !== vScore) { vScore = sc; E.sc.textContent = fmt(sc); }
    const p = NR.player;
    const kmh = Math.round(((core.speed || 0) + (p && p.boosting ? (C.BOOST_ADD || 0) : 0)) * 3.6);
    if (kmh !== vKmh) { vKmh = kmh; E.kmh.textContent = kmh; }
    const hull = p && typeof p.hull === 'number' ? p.hull : (C.HULL || 3);
    if (hull !== vHull) { vHull = hull; for (let i = 0; i < 3; i++) E.pips[i].classList.toggle('x', i >= hull); E.hull.classList.toggle('low', hull === 1); }
    const fuel = p && typeof p.boostFuel === 'number' ? Math.round(clamp(p.boostFuel, 0, 1) * 100) : 100;
    if (fuel !== vFuel) { vFuel = fuel; E.fuel.style.transform = 'scaleX(' + fuel / 100 + ')'; }
    const sir = p && typeof p.siren === 'number' ? Math.round(clamp(p.siren, 0, 1) * 100) : 0;
    if (sir !== vSir) { vSir = sir; E.sir.style.transform = 'scaleX(' + sir / 100 + ')'; }
    const rdy = sir >= 100; if (rdy !== vRdy) { vRdy = rdy; E.sirBar.classList.toggle('rdy', rdy); }
  }
  let popI = 0;
  function pop(big, small) {
    const p = E.pops[popI]; popI = (popI + 1) % E.pops.length;
    for (const q of E.pops) if (q !== p) q.classList.remove('go');
    p.firstChild.textContent = big; p.lastChild.textContent = small || '';
    p.classList.remove('go'); void p.offsetWidth; p.classList.add('go');
  }
  function banner(d) {
    E.ban.innerHTML = '<b>DISTRICT ' + ((d.index | 0) + 1) + ' // ' + (DNAMES[d.index | 0] || '?') + '</b>' + (d.loop > 0 ? '<span> // CYCLE ' + ((d.loop | 0) + 1) + '</span>' : '');
    E.ban.classList.remove('go'); void E.ban.offsetWidth; E.ban.classList.add('go');
  }

  // ---------------------------------------------------------------- footer
  let footT = 0, vFoot = '';
  function paintFoot(force) {
    const a = NR.audio, mus = (a && a.nowPlaying) || ((NR.MUSIC && NR.MUSIC[0] && NR.MUSIC[0].title) || '');
    const s = 'MUSIC: ' + mus + '  ·  BEST ' + fmt(core ? core.best : 0);
    if (force || s !== vFoot) { vFoot = s; E.foot.textContent = s; }
  }

  // ---------------------------------------------------------------- title art
  // 18-colour film palette crush with a 4x4 Bayer dither (same as the core post pass and mockups/title.html)
  const PAL = (NR.PALETTE || [0x050609]).map(x => [(x >> 16) & 255, (x >> 8) & 255, x & 255]);
  const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function crush(g, W, H) {
    const d = g.getImageData(0, 0, W, H), a = d.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, o = (BAY[(x & 3) + (y & 3) * 4] / 16 - 0.5) * 16;
      const r = a[i] + o, gg = a[i + 1] + o, b = a[i + 2] + o; let bd = 1e9, best = PAL[0];
      for (let k = 0; k < PAL.length; k++) { const c = PAL[k], e = (r - c[0]) ** 2 + 1.3 * (gg - c[1]) ** 2 + 0.8 * (b - c[2]) ** 2; if (e < bd) { bd = e; best = c; } }
      a[i] = best[0]; a[i + 1] = best[1]; a[i + 2] = best[2];
    }
    g.putImageData(d, 0, 0);
  }
  function loadArt() {
    const src = NR.TITLE_ART;
    if (!src) { codeArt(); return; }
    const im = new Image();
    im.onload = () => { try { paintedArt(im); } catch (e) { console.error('[NR.ui title art]', e); codeArt(); } };
    im.onerror = () => codeArt();
    im.src = src;
  }
  function paintedArt(im) {
    const W = 360, H = 640, cv = E.bg; cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const s = Math.max(W / im.width, H / im.height), w = im.width * s, hh = im.height * s;
    g.drawImage(im, (W - w) / 2, (H - hh) / 2, w, hh);
    // find the cigarette ember: the hottest warm pixel in the right-middle of the frame
    if (Array.isArray(NR.TITLE_EMBER)) ui.ember = NR.TITLE_EMBER.slice(0, 2);
    else {
      const x0 = W * 0.45 | 0, y0 = H * 0.25 | 0, x1 = W - 2, y1 = H * 0.65 | 0;
      const a = g.getImageData(x0, y0, x1 - x0, y1 - y0).data, rw = x1 - x0;
      let best = 0, bx = -1, by = -1;
      for (let i = 0; i < a.length; i += 4) {
        const r = a[i], gg = a[i + 1], b = a[i + 2]; if (r < 170 || r < gg || gg < b) continue;
        const v = r + gg * 0.6 - b * 1.2; if (v > best) { best = v; bx = (i / 4) % rw; by = (i / 4 / rw) | 0; }
      }
      if (bx >= 0 && best > 200) ui.ember = [(x0 + bx) / W, (y0 + by) / H]; else ui.ember = [0.83, 0.413];
    }
    crush(g, W, H);
    ui.artMode = 'painted';
  }

  // code fallback: mockups/title.html k=0 (alley under the sign), with a procedural city in place of the screenshot
  function codeArt() {
    const W = 270, H = 480, cv = E.bg; cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const R = NR.rng ? NR.rng(99) : Math.random, rnd = (a, b) => a + (b - a) * R();
    const TEAL = '#7fb8bc', EMBER = '#ffcf80';
    // sky: crushed black to sodium smog
    let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#06080b'); gr.addColorStop(0.45, '#1a1a1a'); gr.addColorStop(0.75, '#1b2226'); gr.addColorStop(1, '#0b0e10');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    gr = g.createRadialGradient(150, 230, 10, 150, 230, 170); gr.addColorStop(0, 'rgba(160,96,40,.35)'); gr.addColorStop(1, 'rgba(160,96,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // three tower layers with window grids
    const layer = (n, yb, hMin, hMax, col, lit, win) => {
      for (let i = 0; i < n; i++) {
        const w = rnd(18, 46), x = rnd(-20, W), hh = rnd(hMin, hMax), y = yb - hh;
        g.fillStyle = col; g.fillRect(x, y, w, hh + 200);
        for (let wy = y + 4; wy < yb; wy += win) for (let wx = x + 3; wx < x + w - 2; wx += win) {
          if (R() < lit) { const t = R(); g.fillStyle = t < 0.8 ? `rgba(219,153,77,${rnd(0.25, 0.8)})` : t < 0.93 ? `rgba(122,179,184,${rnd(0.3, 0.7)})` : 'rgba(201,88,74,.7)'; g.fillRect(wx, wy, 1, 1); }
        }
      }
    };
    layer(22, 330, 120, 300, '#0d1115', 0.16, 3);
    haze('rgba(40,46,50,A)', 150, 360, 0.5);
    layer(10, 360, 80, 260, '#090c0f', 0.1, 4);
    // red holo block at the left (scan lines), teal vertical sign behind the figure, dark slab centre
    g.fillStyle = 'rgba(158,66,54,.75)'; g.fillRect(0, 118, 58, 150);
    for (let y = 118; y < 268; y += 3) { g.fillStyle = y % 6 ? 'rgba(235,170,150,.55)' : 'rgba(80,20,18,.5)'; g.fillRect(0, y, 58 - (y % 9), 1); }
    g.fillStyle = 'rgba(235,237,230,.6)'; for (let i = 0; i < 6; i++) g.fillRect(2 + i * 8, 252, 5, 4);
    g.fillStyle = '#07090b'; g.fillRect(80, 60, 80, 330);
    for (let y = 70; y < 380; y += 5) for (let x = 84; x < 156; x += 5) if (R() < 0.08) { g.fillStyle = 'rgba(219,153,77,.6)'; g.fillRect(x, y, 1, 1); }
    g.fillStyle = 'rgba(56,115,125,.5)'; g.fillRect(186, 150, 30, 100);
    for (let y = 152; y < 248; y += 3) { g.fillStyle = 'rgba(122,179,184,.85)'; g.fillRect(188 + (y % 5), y, 24 - (y % 7), 1); }
    g.fillStyle = 'rgba(219,153,77,.5)'; g.fillRect(150, 196, 10, 14); // small amber sign
    // amber light specks floating in the smog
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(219,153,77,${rnd(0.15, 0.6)})`; g.fillRect(rnd(0, W), rnd(0, 380), 1, 1); }
    // from title.html k=0
    haze('rgba(30,40,45,A)', 250, 480, 0.8);
    g.fillStyle = '#05070a'; g.fillRect(0, 380, W, 100);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(232,160,74,${rnd(0.05, 0.2)})`; g.fillRect(rnd(0, W), rnd(384, 470), rnd(6, 30), 1); }
    for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(122,179,184,${rnd(0.05, 0.16)})`; g.fillRect(rnd(0, W), rnd(384, 470), rnd(4, 20), 1); }
    const sg = g.createLinearGradient(0, 0, 120, 0); sg.addColorStop(0, 'rgba(127,184,188,.35)'); sg.addColorStop(1, 'rgba(127,184,188,0)'); g.fillStyle = sg; g.fillRect(0, 150, 140, 260);
    figure(g, 140, 150, 1.25, TEAL, 1.8);
    g.save(); g.translate(213, 203); g.rotate(-0.2); g.fillStyle = '#d8d0c0'; g.fillRect(0, -0.6, 7, 1.2); g.restore();
    const ex = 213 + Math.cos(-0.2) * 7, ey = 203 + Math.sin(-0.2) * 7;
    gr = g.createRadialGradient(ex, ey, 0, ex, ey, 11); gr.addColorStop(0, 'rgba(255,190,90,.9)'); gr.addColorStop(1, 'rgba(255,120,30,0)'); g.fillStyle = gr; g.fillRect(ex - 11, ey - 11, 22, 22);
    g.fillStyle = EMBER; g.fillRect(ex - 0.8, ey - 0.8, 1.6, 1.6);
    gr = g.createRadialGradient(W / 2, H * 0.45, H * 0.15, W / 2, H * 0.5, H * 0.75); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.8)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    crush(g, W, H);
    ui.ember = Array.isArray(NR.TITLE_EMBER) ? NR.TITLE_EMBER.slice(0, 2) : [ex / W, ey / H];
    ui.artMode = 'code';
    function haze(col, y0, y1, a) { const q = g.createLinearGradient(0, y0, 0, y1); q.addColorStop(0, col.replace('A', 0)); q.addColorStop(0.5, col.replace('A', a)); q.addColorStop(1, col.replace('A', 0)); g.fillStyle = q; g.fillRect(0, y0, W, y1 - y0); }
  }
  function standing(p) { // trench coat, collar up, hand at the mouth (mockups/title.html)
    p.moveTo(44, 16); p.quadraticCurveTo(52, 9, 59, 15); p.lineTo(61, 22); p.quadraticCurveTo(62, 34, 56, 38);
    p.lineTo(66, 34); p.lineTo(70, 46); p.lineTo(78, 52); p.lineTo(84, 70); p.lineTo(80, 92);
    p.lineTo(66, 54); p.lineTo(62, 44); p.lineTo(58, 42); p.lineTo(60, 48); p.lineTo(72, 66); p.lineTo(74, 110); p.lineTo(80, 150); p.lineTo(86, 206);
    p.lineTo(60, 206); p.lineTo(56, 160); p.lineTo(50, 206); p.lineTo(18, 206);
    p.lineTo(24, 150); p.lineTo(26, 110); p.lineTo(22, 74); p.lineTo(28, 54); p.lineTo(38, 46);
    p.lineTo(34, 34); p.lineTo(42, 40); p.quadraticCurveTo(38, 26, 44, 18); p.closePath();
  }
  function figure(g, x, y, s, rim, dx) {
    const draw = (col, ox, oy) => { g.save(); g.translate(x + ox, y + oy); g.scale(s, s); g.beginPath(); standing(g); g.fillStyle = col; g.fill(); g.restore(); };
    draw(rim, 0, 0); draw('#06080a', dx, 0.6);
  }

  // ---------------------------------------------------------------- title overlays (smoke, ember drags, rain, light sweep)
  const FW = 270, FH = 480, NS = 46, NR_ = 130;
  const sm = { x: new Float32Array(NS), y: new Float32Array(NS), age: new Float32Array(NS), life: new Float32Array(NS), sd: new Float32Array(NS), sz: new Float32Array(NS) };
  const rn = { x: new Float32Array(NR_), y: new Float32Array(NR_), v: new Float32Array(NR_), l: new Float32Array(NR_) };
  let fxg = null, puff = null, glow = null, sweep = null, smI = 0, smAcc = 0, dragT = 3, drag = 0, fxT = 0;
  function sprite(r, stops) {
    const c = document.createElement('canvas'); c.width = c.height = r * 2; const g = c.getContext('2d');
    const gr = g.createRadialGradient(r, r, 0, r, r, r); for (const [o, col] of stops) gr.addColorStop(o, col); g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2); return c;
  }
  function initFx() {
    fxg = E.fx.getContext('2d');
    puff = sprite(16, [[0, 'rgba(176,186,186,.55)'], [0.55, 'rgba(150,165,168,.22)'], [1, 'rgba(140,150,150,0)']]);
    glow = sprite(24, [[0, 'rgba(255,214,140,1)'], [0.18, 'rgba(255,170,80,.75)'], [0.5, 'rgba(219,110,40,.22)'], [1, 'rgba(219,100,30,0)']]);
    sweep = document.createElement('canvas'); sweep.width = 64; sweep.height = 8;
    { const g = sweep.getContext('2d'), gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, 'rgba(160,200,200,0)'); gr.addColorStop(0.5, 'rgba(170,205,205,.9)'); gr.addColorStop(1, 'rgba(160,200,200,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 8); }
    for (let i = 0; i < NS; i++) sm.life[i] = 0;
    const r = NR.rng ? NR.rng(5) : Math.random;
    for (let i = 0; i < NR_; i++) { rn.x[i] = r() * FW; rn.y[i] = r() * FH; rn.v[i] = 300 + r() * 240; rn.l[i] = 5 + r() * 7; }
  }
  function spawnSmoke(ex, ey, big) {
    const i = smI; smI = (smI + 1) % NS;
    sm.x[i] = ex + (Math.random() - 0.5) * 1.5; sm.y[i] = ey - 1; sm.age[i] = 0; sm.life[i] = (big ? 3.2 : 4.2) + Math.random() * 1.6;
    sm.sd[i] = Math.random() * 6.28; sm.sz[i] = big ? 2.2 : 1;
  }
  function titleFx(dt) {
    if (!fxg) return;
    fxT += dt;
    const g = fxg, ex = ui.ember[0] * FW, ey = ui.ember[1] * FH;
    // drag cycle: ember swells, then an exhale puff
    dragT -= dt;
    if (dragT <= 0) { drag = 0.001; dragT = 5 + Math.random() * 2.5; }
    let k = 0;
    if (drag > 0) {
      drag += dt; const t = drag;
      k = t < 0.7 ? t / 0.7 : t < 1.0 ? 1 : Math.max(0, 1 - (t - 1.0) / 1.6);
      if (t > 1.15 && t - dt <= 1.15) for (let j = 0; j < 9; j++) spawnSmoke(ex - 3 - j * 0.6, ey + 1, true);
      if (t > 2.6) drag = 0;
    }
    smAcc += dt * (7 + k * 6);
    while (smAcc >= 1) { smAcc -= 1; spawnSmoke(ex, ey, false); }
    g.clearRect(0, 0, FW, FH);
    // slow searchlight sweep through the smog
    const sp = (fxT % 11) / 11;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.07 * Math.sin(sp * Math.PI);
    g.setTransform(1, 0, 0, 1, -60 + sp * 400, -40); g.rotate(0.42); g.drawImage(sweep, 0, 0, 70, 640);
    g.setTransform(1, 0, 0, 1, 0, 0);
    // smoke (soft puffs that curl and widen as they rise)
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < NS; i++) {
      if (sm.life[i] <= 0) continue;
      const a = (sm.age[i] += dt), L = sm.life[i];
      if (a >= L) { sm.life[i] = 0; continue; }
      const u = a / L;
      sm.y[i] -= dt * (13 - u * 5) * (sm.sz[i] > 1 ? 0.75 : 1);
      sm.x[i] += dt * (Math.sin(a * 1.7 + sm.sd[i]) * (4 + u * 16) + 2.5 + (sm.sz[i] > 1 ? -4 : 0));
      const r = (1.6 + u * 12) * sm.sz[i];
      g.globalAlpha = 0.5 * Math.min(1, a * 4) * (1 - u) * (1 - u) * (sm.sz[i] > 1 ? 0.8 : 1);
      g.drawImage(puff, sm.x[i] - r, sm.y[i] - r, r * 2, r * 2);
    }
    // ember glow
    g.globalCompositeOperation = 'lighter';
    const fl = 0.85 + Math.sin(fxT * 23) * 0.06 + Math.sin(fxT * 7.3) * 0.05;
    const gs = 7 + k * 9;
    g.globalAlpha = (0.45 + k * 0.55) * fl; g.drawImage(glow, ex - gs, ey - gs, gs * 2, gs * 2);
    if (k > 0.05) { const ws = 20 + k * 22; g.globalAlpha = 0.18 * k; g.drawImage(glow, ex - ws, ey - ws * 0.8, ws * 2, ws * 2); }
    g.globalAlpha = 1; g.fillStyle = k > 0.4 ? '#fff4d8' : '#ffcf80'; g.fillRect(ex - 1, ey - 1, 2, 2);
    // rain streaks, one stroke
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.strokeStyle = 'rgba(180,196,200,.26)'; g.lineWidth = 1; g.beginPath();
    for (let i = 0; i < NR_; i++) {
      let y = rn.y[i] + rn.v[i] * dt, x = rn.x[i] - rn.v[i] * dt * 0.2;
      if (y > FH) { y -= FH + 12; x = Math.random() * (FW + 40); }
      rn.x[i] = x; rn.y[i] = y; const l = rn.l[i];
      g.moveTo(x, y); g.lineTo(x - l * 0.2, y + l);
    }
    g.stroke();
    // neon logo buzz (rare double flicker)
    if (Math.random() < dt * 0.25) buzz = 0.16;
    if (buzz > 0) { buzz -= dt; const on = buzz > 0 && ((buzz * 30) | 0) % 2 === 0; if (on !== vBuzz) { vBuzz = on; E.logo.classList.toggle('buzz', on); } }
    else if (vBuzz) { vBuzz = false; E.logo.classList.remove('buzz'); }
  }
  let buzz = 0, vBuzz = false;

  // ---------------------------------------------------------------- module API
  // Phones block sound until a tap. A "TAP TO ENTER" gate in front of the title makes the first tap start the menu music.
  function gate() {
    if (document.getElementById('nrgate')) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {} // iOS: play even with the silent switch on
    const g = document.createElement('div'); g.id = 'nrgate';
    g.style.cssText = 'position:fixed;inset:0;z-index:50;display:flex;align-items:flex-end;justify-content:center;padding-bottom:16vh;' +
      'background:rgba(5,6,9,.55);font-family:"Courier New",monospace;color:#f0d8a8;letter-spacing:6px;font-size:18px;text-shadow:0 0 10px #d9953f;cursor:pointer;touch-action:none';
    g.innerHTML = '<span style="animation:nrblink 1.6s steps(2) infinite">TAP TO ENTER</span><style>@keyframes nrblink{50%{opacity:.25}}</style>';
    const go = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (NR.audio && NR.audio.unlock) { try { NR.audio.unlock(); } catch (err) {} }
      g.remove(); removeEventListener('keydown', key, true);
    };
    const key = (e) => go(e);
    g.addEventListener('click', go); g.addEventListener('touchend', go);
    addEventListener('keydown', key, true);
    document.body.appendChild(g);
  }
  function init(c) {
    core = c;
    if (!built) build();
    initFx(); loadArt();
    setSel(0); paintFoot(true);
    const B = NR.bus;
    if (B) {
      B.on('state', d => sync(d && d.state));
      B.on('score', d => { if (core.state === 'PLAY' && d) pop(d.reason || '', d.points ? '+' + fmt(d.points) : ''); });
      B.on('district', d => { if (d) banner(d); });
      B.on('hit', () => { E.edge.classList.remove('go'); void E.edge.offsetWidth; E.edge.classList.add('go'); });
      B.on('sirenReady', () => { if (core.state === 'PLAY') pop('SIREN READY', ''); });
      B.on('siren', () => { if (core.state === 'PLAY') pop('SIREN!', ''); });
      B.on('runEnd', d => {
        lastRun = d || {}; saveRun(lastRun);
        E.dead.classList.add('hold'); clearTimeout(deadTimer);
        deadTimer = setTimeout(() => { if (core.state === 'DEAD') showDead(); }, 1400);
      });
    }
    addEventListener('keydown', onKey);
    gate();
    document.addEventListener('visibilitychange', () => { if (document.hidden && core && core.state === 'PLAY') core.pause(true); });
    sync(core.state || 'TITLE');
  }
  function reset() {
    vScore = vKmh = vHull = vFuel = vSir = -1; vRdy = null;
    for (const p of E.pops) p.classList.remove('go');
    E.ban.classList.remove('go'); E.edge.classList.remove('go');
  }
  function update(dt, c) {
    core = c || core;
    if (!built || !core) return;
    if (core.state !== lastState) sync(core.state);
    const v = core.view;
    if (v && (v.w !== lastW || v.h !== lastH)) { lastW = v.w; lastH = v.h; root.style.fontSize = (16 * clamp(v.w / 390, 0.7, 1.8)).toFixed(2) + 'px'; }
    if (core.state === 'TITLE') { titleFx(dt); if ((footT += dt) > 0.5) { footT = 0; paintFoot(false); } }
    else if (core.state === 'PLAY') hud();
    else if (core.state === 'DEAD' && deadShown && lastRun) {
      if (countT < 1) { countT = Math.min(1, countT + dt / 0.9); const e = 1 - (1 - countT) ** 3; E.fs.textContent = fmt((lastRun.score || 0) * e); }
    }
  }
})();
