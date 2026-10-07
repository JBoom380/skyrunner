# SKYRUNNER (formerly NEON RAIN): shared build contract

Every builder reads this first. Edit ONLY your own file. Do not edit `game.js`, `config.js`, `cruiser.js`, `dev.html`, `build.py` or this file. Report any contract change you need in your final message.

## The game
An endless chase on a phone held upright. You fly a police hover cruiser through a rain-soaked neo-noir megacity at night (the look of 1980s neo-noir sci-fi film: smog, sodium-amber street light, cold teal shadows, dull red signs, searchlights, steam, crushed blacks). The car flies forward on its own and keeps getting faster. You weave through flying traffic, signs, girders and towers. Close passes ("NEAR MISS") score bonus points in chains. Near misses fill a SIREN meter; the siren clears the traffic ahead. BOOST adds speed for a short time. Three hits break the car and the run ends. The best score is saved.

Every ~2800 m the city changes district, then the cycle repeats faster: 1 NEON CANYON (tower canyon, holo ads, traffic lanes), 2 FIRE STACKS (industrial flats, chimney fire bursts, grid lights below), 3 THE ARCOLOGY (a huge stepped pyramid HQ glowing ahead, light beams), 4 DUST SEA (orange haze, dunes, giant ruined statues, no rain), 5 THE SEA WALL (a massive wall at the left, storm sea at the right, lightning).

## Legal rules (hard)
Original names only. Never write "Blade Runner", "Deckard", "spinner", "Tyrell", "replicant", "Voight-Kampff", real brands or logos anywhere (code, UI, comments). Made-up sign words only (see examples in mockups/preview.html: NEXA, OMNI, KIRA, SOMA, LUX, ネオン, 夢, 酒 ...). The car is "the cruiser" / "PATROL 47".

## Files and load order (classic scripts, global `window.NR`; no modules, no network)
1. `vendor/three.global.js` (THREE r186, done)  2. `config.js` (done: `NR.cfg`, `NR.PALETTE`, `NR.DISTRICTS`, `NR.MUSIC`, `NR.ASSET`, `NR.TITLE_ART`, `NR.rng`, `NR.bus`)
3. `cruiser.js` (done: `buildCruiser(THREE)`)  4. `audio.js` -> `NR.audio`  5. `world.js` -> `NR.world`  6. `traffic.js` -> `NR.traffic`
7. `player.js` -> `NR.player`  8. `fx.js` -> `NR.fx`  9. `controls.js` -> `NR.controls`  10. `ui.js` -> `NR.ui`  11. `game.js` (core, done)
Open `src/dev.html` over a local server (`python -m http.server` from the repo root, then /src/dev.html) to run. `build.py` inlines the scripts into `../index.html`. Music and title art are files in `../assets/` (use `NR.ASSET`).
Every module object has `init(core)`, `update(dt, core)` and `reset(core)` (run start). The core calls them in this order each frame: audio, world, traffic, player, fx, controls, then camera, then ui. A throw disables only that function and logs `[NR.module.fn]`. Every module must tolerate any other module being absent (`if (NR.x && NR.x.fn)`).

## Rendering (core owns it)
The core renders the scene into a low-res target (360x640 high, 270x480 low) and a post pass maps every pixel to the 18-colour film palette with a Bayer dither (see game.js). So: do NOT add post effects; do design for low resolution (big readable shapes, strong silhouettes, emissive accents). Bright neon must come from emissive materials and additive glow sprites, not lights (keep real lights to the 3 on the car + the core's ambient/key). Fog: the core sets `scene.fog` (FogExp2) colour/density from the district blend each frame. Target 60 fps on a mid phone: instancing / merged geometry, pooled objects, no per-frame allocation, MeshBasicMaterial for most city geometry, max ~150 draw calls.

## World frame and motion (treadmill)
Metres, +Y up. The player stays near z = 0 and flies toward -Z. The WORLD MOVES: every frame each module moves its objects by `core.scroll` toward +Z (`obj.position.z += core.scroll`). Objects that pass `NR.cfg.RECYCLE_Z` (+40) are recycled to the far end (around `NR.cfg.SPAWN_Z`, -1400). The flight corridor is x in [-LANE_X, LANE_X] (±18) and y in [ALT_MIN, ALT_MAX] (-6..30). Buildings and terrain live OUTSIDE the corridor (|x| > ~24) except deliberate obstacles. The camera sits behind and above the player (core.camOffset (0, 3, 10.5)) looking down -Z, portrait 9:16, fov ~70 (wider when boosting).

## Core `NR.core` (game.js)
```
{ THREE, scene, camera, renderer, settings {music, sfx, quality}, isTouch, time, dt, state: 'TITLE'|'PLAY'|'PAUSE'|'DEAD',
  input: NR.controls.state, speed (m/s), scroll (m this frame), dist (m), score, best, nearMisses,
  district (0..4), loop (cycles done), blend {a, b, t} (district a fading to b, t 0..1), view {w,h,left,top} (CSS px of the 9:16 column),
  camOffset (Vector3), shake(amount, seconds), flash(hex, seconds, alpha), start(), toTitle(), pause(bool), setQuality('high'|'low'), saveSettings() }
```
On the TITLE screen the core still updates world/traffic/fx with `core.scroll = 30*dt` (a slow drift through the city behind the menu). In DEAD the scroll is 0.

## Event bus `NR.bus` (on/off/emit)
- `state` {state, prev}  - `runStart` {}  - `district` {index, name, loop}
- `hit` {hull, kind}  (player took a hit; hull left)  - `crash` {} (hull 0; the core ends the run)  - `runEnd` {score, best, isBest, dist, nearMisses, district, loop}
- `nearMiss` {pos, dist} (traffic -> core adds chain points)  - `score` {points, reason, pos} (core -> ui popup)
- `boost` {on}  - `siren` {}  (player)  - `sirenReady` {}  - `lightning` {} (world, sea wall)  - `ui` {action} (ui -> audio click sounds)

## Modules

### NR.controls (controls.js)
`state = { mx, my (-1..1, stick: right/up positive), boost (held), siren (true for ONE frame on press), pause (one frame), any (one frame: any tap/key, used to leave the title) }`.
Touch (portrait): a FLOATING joystick on the left half of the 9:16 column (appears where the thumb lands, follows when overshot, radius ~60 CSS px, deadzone 0.12). Right side: BOOST button (big, bottom-right, hold) and SIREN button (above BOOST, slightly left; disabled look until `NR.player.siren >= 1`). Draw the stick and buttons as DOM elements inside `#ui` in the game palette (amber/teal-grey, no hot pink, no pure cyan), visible only in PLAY. Multi-touch: stick and buttons at once. Keyboard: WASD/arrows, Space or Shift = boost, E or Q = siren, Esc/P = pause. Gamepad: left stick, A/RT boost, X/Y siren, Start pause. Prevent page scroll/zoom/long-press menus. Reference: the floating stick in ../bum-rush/src/controls.js and ../freebird-simulator/src/controls.js.

### NR.player (player.js)
```
pos (Vector3, z stays 0), vel, bank (rad), boosting (bool), boostFuel (0..1), siren (0..1), hull (0..3), invuln (s), alive,
box() -> {min: Vector3, max: Vector3} (the car's collision box, about 2.6 x 1.4 x 7.5),  car (the buildCruiser object)
```
Builds the car with `buildCruiser(THREE)` and adds it to the scene. Flight: the stick moves the car in X/Y inside the corridor with smooth acceleration, bank into turns (`car.setBank`), slight nose pitch on climb/dive, a subtle hover bob. BOOST: while held and fuel > 0, `boosting = true` (the core adds speed), fuel drains over BOOST_SECONDS and recharges over BOOST_RECHARGE; emit `boost`. SIREN: when `siren >= 1` and input.siren, call `NR.traffic.clearAhead(cfg.SIREN_CLEAR)`, emit `siren`, set siren 0. Near misses add `cfg.SIREN_PER_MISS` (listen to `nearMiss`); emit `sirenReady` once when it fills. Collisions: each frame (not while invuln) test `NR.world.collide(box)` and `NR.traffic.collide(box)` (each returns `{hit, kind, normal}`). On a hit: hull--, invuln = cfg.INVULN (blink the car), push back from the normal, `core.shake(0.6, 0.4)`, `core.flash(0xc9584a, 0.25)`, emit `hit`; at hull 0 emit `crash`, `alive = false` and play a crash (the car tumbles and drops with sparks; fx handles the explosion via the `crash` event). `car.update(core.time)` for the light bar; `car.setBoost` from boost state. On TITLE: hover gently in the centre (the menu shows the city behind). `reset`: centre, hull 3, fuel 1, siren 0.

### NR.world (world.js)
```
collide(box) -> {hit, kind, normal}   // obstacles that cross the corridor (girders, sign gantries, pipes, statue arms, pyramid light pylons)
```
Builds and streams the five districts as the treadmill moves (see "World frame"). Everything is procedural in code (canvas textures allowed: window grids, sign words, ad panels). Per district (pick from `NR.DISTRICTS[core.blend.a]`, cross-fade into `.b` over the blend; spawn new chunks with the district of the distance they will appear at):
- a sky dome (gradient from the district `sky` colours, lerped by `core.blend`) and a ground/sea plane far below (y about -40);
- NEON CANYON: tall towers both sides with lit window grids (warm sodium mostly), vertical kanji-style signs, big holographic ad figures (additive, scan lines), sign gantries and walkways crossing the corridor high and low (obstacles), steam vents, searchlight beams sweeping the smog;
- FIRE STACKS: wide dark flats with thousands of grid lights below (Points or instanced sprites), chimney stacks that burst flame (animated emissive cones + glow), refinery towers, pipes crossing the corridor (obstacles);
- THE ARCOLOGY: a huge stepped pyramid far ahead that slowly grows (stays at a fixed far distance, then passes at the end), lit facade, light beams from the pyramid top, smaller towers, pylons;
- DUST SEA: orange haze, dunes, ruined towers, giant broken statues (a head, a raised arm that crosses the corridor high = obstacle), no rain;
- THE SEA WALL: a massive lit wall at the left (x about -40), storm sea at the right with low-poly animated waves, lightning flashes (call `core.flash(0xd8e0e8, 0.12, 0.35)` and emit `lightning`), towers on the wall.
Obstacles must be fair: telegraphed (lit, visible >= 1.5 s ahead at current speed), never a full wall (always a gap the car fits through), density rising with `core.loop` and distance. Use made-up sign words. Reference visuals: ../mockups/preview.html (the approved look; reuse its builders) and ../mockups/neon_rain_contact_sheet.png.

### NR.traffic (traffic.js)
```
collide(box) -> {hit, kind, normal};  clearAhead(dist);  cars (active list)
```
Flying traffic in lanes inside the corridor: same-direction slow cars (you overtake them), oncoming cars (fast, mostly in "oncoming" altitude bands), big slow cargo haulers (long, with warning lights), and police/ad blimps far above as scenery. Each car: a low-poly hover car (several original designs, dark paint, glowing head/tail lights; tail lights red facing the player for same-direction, headlights white for oncoming), with additive glow sprites. Spawn ahead (cfg.SPAWN_Z) and recycle; density and speed variety grow with distance and `core.loop`; always leave a path. Near miss: when a car passes the player's z without a hit and the closest XY gap was < cfg.NEAR_MISS_DIST, emit `nearMiss` {pos, dist} once per car. `clearAhead(d)`: cars within d metres ahead swerve out of the corridor over ~1 s (and score nothing). On title: light traffic drifting past.

### NR.fx (fx.js)
Rain (streaks in camera space, density from district `rain`, faster with speed, none in DUST SEA; slanted with the car's bank), speed lines at high speed/boost, spray/sparks when hit, the crash explosion (`crash`: fireball sprites, debris, smoke, then smoke trails), thruster heat shimmer sprites under the car, near-miss streak flash at the passed car's position, siren pulse ring (red/blue sweep across the screen edges for 1 s), boost streaks. All pooled, additive sprites, palette-friendly colours (amber, teal-grey, dull red, white).

### NR.audio (audio.js)
Music: two HTMLAudio tracks from `NR.MUSIC`. Track 0 (RAINY SAX) starts on the title screen at the first user gesture (mobile unlock) and keeps playing through menus and runs with no restart; when it ends play track 1 (OLD SCHOOL TEST 1), then track 0 again, and so on. Volume from `core.settings.music`; duck 50% while paused; a low-pass "muffled" feel is not needed. Preload track 1 only after track 0 starts. Expose `audio.nowPlaying` (title) and `audio.setMusic(v)`, `audio.setSfx(v)`. SFX by WebAudio synthesis only (no files): engine hum (pitch with speed), wind rush (noise, with speed), near-miss whoosh (doppler), hit clank + alarm beep, crash explosion, boost roar, siren wail (two-tone 1 s), lightning thunder (sea wall), UI click/confirm (`ui` events), district swoosh. Volume from `core.settings.sfx`.

### NR.ui (ui.js)
All DOM inside `#ui` (it is sized to the 9:16 column by the core). Font: "Courier New", monospace; colours amber #e8c890 / #d9a050, teal-grey #8fb0b4, dull red #c9584a, off-white #f0d8a8; soft glow text-shadows; no hot pink, no pure cyan.
- TITLE (approved draft A, see ../mockups/neon_rain_title_drafts.png panel A and mockups/title.html): full-screen title art. If `NR.TITLE_ART` loads, show it as the backdrop (pixelated, cover); else draw the code version from mockups/title.html (k=0). Overlays: animated cigarette smoke curling up from the ember, the ember glowing brighter every few seconds (a drag), rain streaks, a slow sweep of light. Logo "NEON / RAIN" top-left (NO subtitle). Menu at the lower left: START PURSUIT / BEST RUNS / SETTINGS / CREDITS (tap, or keys up/down + Enter). Footer: "MUSIC: " + audio.nowPlaying + "  ·  BEST " + best. Any tap on START starts the run (`core.start()`); the first tap also unlocks audio.
- BEST RUNS: the top 5 runs (localStorage key 'neonRain.runs', written on runEnd): score, distance km, district reached.
- SETTINGS: music volume, sfx volume, quality high/low (`core.setQuality`), reset best. Saved via `core.saveSettings()`.
- CREDITS: "A GAME BY JOHN SLAGBOOM", "MUSIC BY JOHN SLAGBOOM: RAINY SAX, OLD SCHOOL TEST 1", "BUILT WITH THREE.JS".
- HUD (PLAY): score top-left, km/h + hull pips top-right, district banner (fades in for 3 s on `district`: "DISTRICT 2 // FIRE STACKS", loop >0 adds " // CYCLE 2"), centre popups for `score` reasons, boost fuel bar, siren meter (ring around the SIREN button, or a bar), a red edge pulse on `hit`, pause button (top centre).
- PAUSE: resume / quit to title.  DEAD (on runEnd): "PURSUIT ENDED", score, best (NEW BEST flash), distance, near misses, district reached; RETRY and MENU buttons.
Big touch targets (>= 56 CSS px), safe-area insets respected.

## Testing
Each builder tests their module in the real page with Playwright (Python, `from playwright.sync_api import sync_playwright`), Chromium with args ["--use-angle=d3d11","--enable-gpu"], viewport 390x844 with has_touch=True, is_mobile=True. Serve the repo root with `python -m http.server <port>` (pick a random free port; kill only your own server by PID). Check: no console errors, your API works, 60 fps (measure `requestAnimationFrame` intervals over 5 s in PLAY), and screenshots look right. Put test scripts in `../tests/<module>_test.py`. Never `taskkill` all chrome/python; kill by PID only.

## Addendum 2026-10-06: ROLL + hazards + progression (round 2)
Core (game.js, done): `core.difficulty` (0 at start, 1 after three districts, +0.35 per completed cycle; use it for all ramps), `core.fogExtra` (world sets it 0..~3 for dust storms / steam; the core multiplies fog density by 1+fogExtra; world must ease it back to 0), near misses while `NR.player.rolling` score double as "ROLL MISS".
New/changed contracts:
- controls: `state.roll` (true ONE frame on press). Touch: a ROLL button on the right side (between SIREN and BOOST, so the right thumb can hold BOOST and tap ROLL with a slide or a second finger; size >= 64 CSS px, palette teal-grey). Keyboard: R (or Ctrl) rolls toward the held arrow/WASD direction. Gamepad: B. Add "R ROLL" to the keyboard key panel.
- player: `rolling` (bool), `rollT` (0..1 progress), `rollDir` {x, y} (unit, the stick direction snapped to the 4 directions; centre = spin in place), `rollCooldown` (s), `push(x, y)` (external sideways/vertical impulse in m/s, eased), `drainSiren(amount)`. ROLL: on `input.roll` and cooldown 0: a 0.45 s barrel roll (car rotates 360 deg on its long axis for left/right, a half loop pitch for up/down, a flat spin when centred) moving about 6 m toward rollDir (5 m up/down), 0.3 s of no-collision in the middle of the roll, 1.0 s cooldown. With boost held: 1.5x distance and 0.35 s. Emit `roll` {dir, boost}. Clamp to the corridor.
- world: progressive density and the new hazards below, all telegraphed (lit, warning blink or marker >= 1.5 s before they become dangerous), all with a fair path, introduced gradually by `core.difficulty` (a hazard type first appears rarely, then more often; cycle 2+ mixes hazards from other districts). `collide(box)` returns `kind` = the hazard name. Emit `hazard` {kind, phase:'warn'|'active', pos} for audio.
  Neon Canyon: dropping/swinging sign gantries; police drones whose searchlight cone sweeps the corridor (inside the cone: `NR.player.drainSiren(0.4*dt)` and emit `hazard` {kind:'spotted'}; touching the drone body = hit).
  Fire Stacks: flame jets that fire across the corridor on a visible timer (glow ramps up, then a burst ~1 s); steam columns (non-lethal, raise core.fogExtra while inside and hide the view).
  The Arcology: laser fences (thin bright lines in a frame) that open and close in a rhythm; blast shutters that slide shut leaving a gap that moves.
  Dust Sea: dust storms (fogExtra up to ~3, wind gusts via `player.push`); debris falling from the ruins (shadow/marker on the corridor first, then rocks fall).
  The Sea Wall: lightning strikes (a target ring glows on a spot for ~1.2 s, then a bolt hits it = hit if inside, plus core.flash); wave spray columns (push the car sideways, non-lethal) plus the existing obstacles.
- traffic: lane-changers (cars that swerve across lanes near the player with blinkers ~1 s ahead), frequency by `core.difficulty`; more density over time.
- fx: roll trail (two light ribbons from the pods during a roll), roll whoosh streaks; lightning ground ring + bolt particles if world asks (`NR.fx.sparks` etc. existing API).
- audio: `roll` whoosh (louder with boost), hazard sounds by `hazard` {kind, phase}: drone hum/warning chirp when spotted, flame jet roar, laser hum + zap, shutter clank, dust wind gust, debris rumble, lightning crack, wave crash.
