// NEON RAIN shared config: tuning, districts, palette, rng, event bus. Owned by the core; builders read only.
window.NR = window.NR || {};
NR.cfg = {
  RES: { high: [360, 640], low: [270, 480] },   // internal render size (portrait 9:16)
  SPEED_START: 60, SPEED_MAX: 150, SPEED_RAMP: 0.55, // m/s, gain per second of play
  BOOST_ADD: 45, BOOST_SECONDS: 2.2, BOOST_RECHARGE: 6,
  LANE_X: 18, ALT_MIN: -6, ALT_MAX: 30,           // player box (world units = metres)
  STEER_SPEED: 26, CLIMB_SPEED: 18,
  HULL: 3, INVULN: 1.5,
  NEAR_MISS_DIST: 3.2, NEAR_MISS_POINTS: 250, CHAIN_WINDOW: 2.5,
  SIREN_PER_MISS: 0.12, SIREN_CLEAR: 320,
  DISTRICT_LEN: 2800, BLEND_LEN: 320,
  RECYCLE_Z: 40, SPAWN_Z: -1400,
  BEST_KEY: 'neonRain.best', SETTINGS_KEY: 'neonRain.settings',
};
// Film palette (smog, sodium amber, cold teal, dull red). Hex for builders; the post pass uses the same 18 colours.
NR.PALETTE = [0x050609, 0x0e1216, 0x171f26, 0x243038, 0x36454c, 0x54666b, 0x1a120d, 0x331f12, 0x5c331a, 0x9e612b, 0xdb994d, 0xf5d69e, 0x4d1a17, 0x9e4236, 0x38737d, 0x7ab3b8, 0x946675, 0xebede6];
NR.DISTRICTS = [
  { id: 'canyon', name: 'NEON CANYON', fog: 0x1a1f24, sky: [0x07090c, 0x2b2620], ground: 0x07080a, density: 0.0021, accent: [0xc9584a, 0x4f9aa6, 0xd9953f, 0x9a6a7e], rain: 1.0 },
  { id: 'stacks', name: 'FIRE STACKS', fog: 0x1c1410, sky: [0x040404, 0x3a2414], ground: 0x050506, density: 0.0013, accent: [0xe07a2a, 0xe0a050, 0xb8402c, 0x4f9aa6], rain: 0.5 },
  { id: 'arcology', name: 'THE ARCOLOGY', fog: 0x1e2226, sky: [0x05060a, 0x2e2a24], ground: 0x06070a, density: 0.0009, accent: [0xe0b070, 0x5aa0aa, 0xb05a48, 0xd8d0c0], rain: 0.7 },
  { id: 'dust', name: 'DUST SEA', fog: 0x9a5426, sky: [0x4a2410, 0xc07a3a], ground: 0x5a2c12, density: 0.0026, accent: [0xf0c890, 0xd08a4a, 0x5aa0aa, 0xe8e0d0], rain: 0.0 },
  { id: 'seawall', name: 'THE SEA WALL', fog: 0x161c22, sky: [0x040608, 0x1c2228], ground: 0x050709, density: 0.0016, accent: [0x5aa0aa, 0xc9584a, 0xd8d8d0, 0xd9953f], rain: 1.4 },
];
NR.ASSET = document.querySelector('script[src="config.js"]') ? '../assets/' : 'assets/'; // dev.html lives in src/
NR.MUSIC = [{ file: NR.ASSET + 'rainy_sax.mp3', title: 'RAINY SAX' }, { file: NR.ASSET + 'old_school_test_1.mp3', title: 'OLD SCHOOL TEST 1' }];
NR.TITLE_ART = NR.ASSET + 'title.png'; NR.TITLE_EMBER = [0.79, 0.413]; // cigarette ember position in the title art (fraction of width/height) for the smoke overlay // painted title backdrop (detective in the alley); ui falls back to code-drawn art if missing
NR.rng = (seed) => { let s = (seed >>> 0) || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
NR.bus = (() => { const h = {}; return {
  on(e, f) { (h[e] = h[e] || []).push(f); }, off(e, f) { h[e] = (h[e] || []).filter(x => x !== f); },
  emit(e, d) { for (const f of (h[e] || []).slice()) { try { f(d); } catch (err) { console.error('[NR.bus ' + e + ']', err); } } },
}; })();
