// LightPartyCinematic (DOM) — the Light Party event's theatrics.
//
// FFXIV-flavored cousin to SoloLevelingCinematic. Three layers, all pure
// presentation (gameplay lives in LightPartyAi / EventSystem / BossSystem):
//
//   1. ENTRANCE — a full-screen title card when the party arrives
//      (LIGHT_PARTY_BEGAN): dim → "◆ LIGHT PARTY ◆" → "WARRIORS OF LIGHT"
//      → role icons fading in one at a time (🛡️ ⚕️ ⚔️ ☄️). Auto-dismisses
//      (or click to skip), then hands the screen back so the player can
//      watch them march in.
//
//   2. CORNER PANEL — a persistent FFXIV party-list panel (4 or 8 stacked
//      HP bars + role icons + LB gauge). Lives the whole time the party is
//      in the dungeon, lifted when the duel begins (cinematic UI takes
//      over) or the party is wiped/gone.
//
//   3. DUEL — when the party reaches the throne (LIGHT_PARTY_DUEL_BEGAN),
//      letterbox bars + boss HP top-center + party HP bars bottom-left +
//      boss cast bar. A scripted FFXIV-style beat sequence plays out (cast
//      bars, telegraphed AoEs, stack markers), climaxing in the LB3 cinematic.
//      Win / loss climax card on the way out.
//
// Same self-injected CSS pattern as SoloLevelingCinematic — keeps the
// feature's styling self-contained.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

// FFXIV-style job glyphs — role-appropriate so the colored job-icon frame
// reads at a glance (tank shield / healer staff-of-asclepius / melee blades /
// caster comet, matching the reference Black Mage comet icon).
const ROLE_ICON = {
  tank:      '🛡️',
  healer:    '⚕️',
  meleeDps:  '⚔️',
  rangedDps: '☄️',
}
const ROLE_LABEL = {
  tank:      'TANK',
  healer:    'HEALER',
  meleeDps:  'MELEE DPS',
  rangedDps: 'RANGED DPS',
}
const ROLE_COLOR = {
  tank:      '#6aaaff',
  healer:    '#aef0c4',
  meleeDps:  '#ff8a6a',
  rangedDps: '#c9a9ff',
}

export class LightPartyCinematic {
  constructor() {
    this._stage = document.getElementById('hud-stage')
    this._listeners = []
    this._timers = []
    this._members = []           // {instanceId, role, name, maxHp, hp}
    this._lbValue = 0
    this._lbMax = 100
    this._entrance = null
    this._vignette = null
    this._cornerPanel = null
    this._cornerBars = {}        // instanceId → {fillEl, numEl, rowEl}
    this._cornerLbFill = null
    this._castBars = {}          // healerId → {wrapEl, fillEl, timer}
    this._duelStarted = false
    this._duelEl = null
    this._duelBossFill = null
    this._duelBossCastFill = null
    this._duelPartyBars = {}     // instanceId → {fillEl, numEl}
    this._letterbox = null
    if (!this._stage) return
    this._ensureCss()
    this._wire()
  }

  // ── CSS injection (self-contained, mirrors SoloLevelingCinematic) ──────
  _ensureCss() {
    if (document.getElementById('qf-lp-cinematic-css')) return
    const css = `
/* Entrance card */
.qf-lp-entrance { position:absolute; inset:0; z-index:50; pointer-events:auto; cursor:pointer;
  opacity:0; transition:opacity .35s ease; }
.qf-lp-entrance.show { opacity:1; }
.qf-lp-entrance .qf-lp-dim { position:absolute; inset:0;
  background:radial-gradient(circle at 50% 50%, rgba(255,250,220,.0) 30%, rgba(8,12,30,.78) 100%); }
.qf-lp-entrance.flash::after { content:''; position:absolute; inset:0;
  background:#fff8d8; opacity:.85; animation:qf-lp-flash .42s ease-out forwards; }
@keyframes qf-lp-flash { from{opacity:.85} to{opacity:0} }
.qf-lp-entrance .qf-lp-stack { position:absolute; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:14px; font-family:'Press Start 2P','Courier New',monospace; }
.qf-lp-kicker, .qf-lp-title, .qf-lp-sub, .qf-lp-roles { opacity:0; transform:translateY(8px); }
.qf-lp-kicker { font-size:clamp(10px,1.2vw,14px); letter-spacing:6px; color:#ffd66b;
  text-shadow:0 0 12px rgba(255,214,107,.8); }
.qf-lp-title  { font-size:clamp(28px,4vw,56px); letter-spacing:4px; color:#fff7d8;
  text-shadow:0 0 28px rgba(255,214,107,.85), 0 3px 0 #2a1505; }
.qf-lp-sub    { font-size:clamp(11px,1.4vw,18px); letter-spacing:5px; color:#bfe3ff;
  text-shadow:0 0 16px rgba(170,210,255,.7); }
.qf-lp-roles  { display:flex; gap:28px; margin-top:6px; }
.qf-lp-role-chip { display:flex; flex-direction:column; align-items:center; gap:4px; opacity:0;
  transform:scale(.5); transition:opacity .35s ease, transform .35s cubic-bezier(.16,.84,.3,1); }
.qf-lp-role-chip.in { opacity:1; transform:scale(1); }
.qf-lp-role-chip .qf-lp-role-icon { font-size:clamp(22px,2.6vw,34px);
  filter:drop-shadow(0 0 8px rgba(255,214,107,.7)); }
.qf-lp-role-chip .qf-lp-role-label { font-family:'Press Start 2P','Courier New',monospace;
  font-size:clamp(8px,.9vw,11px); letter-spacing:2px; color:#fff7d8; }
.qf-lp-kicker.in, .qf-lp-title.in, .qf-lp-sub.in, .qf-lp-roles.in {
  opacity:1; transform:translateY(0); transition:opacity .5s ease, transform .5s ease; }

/* Persistent vignette */
.qf-lp-vignette { position:absolute; inset:0; pointer-events:none; z-index:30;
  background:radial-gradient(circle at 50% 65%, rgba(255,214,107,0) 55%, rgba(255,214,107,.16) 100%);
  opacity:0; transition:opacity .5s ease; }
.qf-lp-vignette.show { opacity:1; }

/* ── Persistent corner party panel — FFXIV party-list look ──────────────
   Rebuilt 2026-05-29 from a real FFXIV party-list reference: a big gold
   "LIMIT BREAK" parallelogram bar on top, a gold "LIGHT PARTY" label, then
   one row per member with a colored beveled job-icon frame, a gold slot
   badge, "Lv50" text, the name, and a half-width HP bar with the current
   HP value beneath it. Uses a smooth bold font (NOT the pixel font) so the
   gold headers + names read like FFXIV's UI letterforms. No panel box /
   border — FFXIV's list floats on the screen with no frame. */
.qf-lp-corner { position:absolute; top:calc(var(--hud-top,96px) + 10px);
  left:calc(var(--hud-side,320px) + 12px); z-index:42; pointer-events:auto;
  font-family:'Trebuchet MS','Segoe UI',Arial,sans-serif; opacity:0;
  transition:opacity .4s ease; display:flex; flex-direction:column; gap:3px;
  padding:4px 8px 8px; min-width:296px; }
.qf-lp-corner.show { opacity:1; }

/* Gold beveled header text (LIMIT BREAK + LIGHT PARTY) — gradient fill
   clipped to the glyphs + a dark drop-shadow outline + warm glow. */
.qf-lp-gold-text { font-weight:900; font-style:italic; letter-spacing:1px;
  background:linear-gradient(180deg,#fff6c4 0%,#ffe07a 42%,#e9a82a 56%,#ffd24a 78%,#fff0a0 100%);
  -webkit-background-clip:text; background-clip:text;
  -webkit-text-fill-color:transparent; color:#ffd24a;
  filter:drop-shadow(0 1px 0 #2a1a02) drop-shadow(0 0 5px rgba(255,190,60,.55)); }

/* LIMIT BREAK section */
.qf-lp-limit { margin-bottom:1px; }
.qf-lp-limit-head { font-size:16px; line-height:1; margin:0 0 3px 3px; }
.qf-lp-limit-bar { position:relative; height:17px; margin:0 2px;
  filter:drop-shadow(0 0 5px rgba(255,200,60,.5)); }
/* gold frame (right-leaning parallelogram, chamfered ends) */
.qf-lp-limit-bar::before { content:''; position:absolute; inset:0;
  background:linear-gradient(180deg,#ffe488,#caa030 55%,#9a7414);
  clip-path:polygon(11px 0,100% 0,calc(100% - 11px) 100%,0 100%); }
.qf-lp-limit-track { position:absolute; inset:2px; overflow:hidden;
  background:#241a05; clip-path:polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%); }
.qf-lp-limit-fill { position:absolute; inset:0; width:0%;
  background:linear-gradient(180deg,#fff6b0 0%,#ffdb45 45%,#f0a81e 70%,#d98a12 100%);
  transition:width .25s ease; }
/* bright highlight stripe across the top of the fill (the FFXIV gloss) */
.qf-lp-limit-fill::after { content:''; position:absolute; left:0; right:0; top:1px; height:5px;
  background:linear-gradient(180deg,rgba(255,255,235,.9),rgba(255,255,235,0)); }
.qf-lp-limit.full .qf-lp-limit-bar { animation:qf-lp-lb-pulse 1.1s ease-in-out infinite; }
@keyframes qf-lp-lb-pulse { 0%,100%{filter:drop-shadow(0 0 5px rgba(255,200,60,.5))}
  50%{filter:drop-shadow(0 0 13px rgba(255,220,90,.95))} }

/* LIGHT PARTY label */
.qf-lp-corner-title { font-size:14px; line-height:1; margin:3px 0 4px 3px; }

/* Member row */
.qf-lp-row { display:flex; align-items:center; gap:7px; }
.qf-lp-row.dead { opacity:.45; filter:grayscale(.5); }

/* Colored beveled job-icon frame per role */
.qf-lp-job { width:36px; height:36px; flex-shrink:0; border-radius:6px;
  display:flex; align-items:center; justify-content:center; font-size:18px;
  position:relative; color:#fff;
  box-shadow:inset 0 0 0 2px rgba(255,238,190,.9), inset 0 0 0 4px rgba(30,22,8,.85),
             inset 0 3px 6px rgba(255,255,255,.22), 0 1px 3px rgba(0,0,0,.7);
  text-shadow:0 1px 2px rgba(0,0,0,.8); }
.qf-lp-job.tank      { background:linear-gradient(160deg,#5b8fe0,#1f3c84); }
.qf-lp-job.healer    { background:linear-gradient(160deg,#6cc24f,#2c6a22); }
.qf-lp-job.meleeDps  { background:linear-gradient(160deg,#c25050,#6e1f1f); }
.qf-lp-job.rangedDps { background:linear-gradient(160deg,#d3a13a,#7c5510); }

/* Right column: top line (badge + Lv + name) then HP bar + HP number */
.qf-lp-rowmain { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.qf-lp-rowtop { display:flex; align-items:center; gap:5px; }
.qf-lp-badge { flex-shrink:0; width:15px; height:15px; display:inline-flex;
  align-items:center; justify-content:center; border-radius:3px; font-weight:900;
  font-size:10px; color:#3a2706;
  background:linear-gradient(180deg,#ffe488,#d9a01c);
  box-shadow:inset 0 0 0 1px rgba(90,60,6,.8),0 1px 1px rgba(0,0,0,.5); }
.qf-lp-lv { flex-shrink:0; color:#f4e3a0; font-weight:700; font-size:13px;
  text-shadow:0 1px 1px #000; }
.qf-lp-lv .sm { font-size:9px; opacity:.85; margin-right:1px; }
.qf-lp-name { flex:1; min-width:0; color:#fff; font-weight:700; font-size:13px;
  letter-spacing:.3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  text-shadow:0 1px 0 #1a1408,0 0 3px rgba(0,0,0,.85); }

/* HP bar — 50% width (half the row length), left-aligned. (MP bar removed
   2026-05-30: MP was cosmetic-only and never tracked anything.) */
.qf-lp-bar { position:relative; height:9px; width:50%; border-radius:1px; overflow:hidden;
  background:#0a0e16;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.75), inset 0 1px 2px rgba(0,0,0,.6); }
.qf-lp-bar-fill { position:absolute; left:0; top:0; bottom:0; width:100%;
  transition:width .18s linear; }
.qf-lp-bar.hp .qf-lp-bar-fill { background:linear-gradient(180deg,#fbfdff,#cfe2f4 55%,#9dc0e2); }
.qf-lp-bar-fill::after { content:''; position:absolute; left:0; right:0; top:0; height:2px;
  background:rgba(255,255,255,.5); }
.qf-lp-row.dead .qf-lp-bar.hp .qf-lp-bar-fill { background:#5a1414; }

/* Number line: current HP value, left-aligned under the bar */
.qf-lp-nums { display:flex; align-items:flex-end;
  font-weight:700; color:#eef2f8; text-shadow:0 1px 1px #000,0 0 2px rgba(0,0,0,.8);
  line-height:1; font-variant-numeric:tabular-nums; }
.qf-lp-nums .qf-lp-hp { font-size:13px; }

/* (Removed an orphaned world-space `.qf-lp-castbar` rule here — leftover from
   an abandoned DOM raise-cast-bar approach. It set transform:translate(-50%,
   -100%) + width:60px, and because the real boss-cast-bar rule below doesn't
   declare `transform`, that stale translate LEAKED onto the boss cast bar and
   shoved it 115px left, overlapping the party panel. The raise cast bar is
   drawn in LightPartyRenderer (Phaser), so this CSS was dead.) */

/* Tactical-LB screen flash */
.qf-lp-lb-flash { position:absolute; inset:0; z-index:43; pointer-events:none;
  opacity:0; animation:qf-lp-flash-anim .55s ease-out forwards; }
.qf-lp-lb-flash.tank   { background:radial-gradient(circle at 50% 55%, rgba(255,214,107,0) 38%, rgba(255,214,107,.42) 100%); box-shadow:inset 0 0 130px 40px rgba(255,214,107,.55); }
.qf-lp-lb-flash.healer { background:radial-gradient(circle at 50% 55%, rgba(106,212,151,0) 38%, rgba(106,212,151,.42) 100%); box-shadow:inset 0 0 130px 40px rgba(106,212,151,.55); }
.qf-lp-lb-flash.dps    { background:radial-gradient(circle at 50% 55%, rgba(255,154,58,0) 38%, rgba(255,154,58,.50) 100%); box-shadow:inset 0 0 130px 40px rgba(255,154,58,.62); }
@keyframes qf-lp-flash-anim { 0%{opacity:0} 22%{opacity:1} 100%{opacity:0} }
.qf-lp-lb-banner { position:absolute; left:0; right:0; top:30%; z-index:44; text-align:center;
  pointer-events:none; font-family:'Press Start 2P','Courier New',monospace;
  font-size:clamp(20px,3vw,40px); letter-spacing:6px; opacity:0;
  animation:qf-lp-banner-anim 1.2s cubic-bezier(.2,.9,.2,1) forwards; }
.qf-lp-lb-banner.tank   { color:#ffe6a0; text-shadow:0 0 22px rgba(255,214,107,.95), 0 3px 0 #2a1505; }
.qf-lp-lb-banner.healer { color:#d4ffe2; text-shadow:0 0 22px rgba(106,212,151,.95), 0 3px 0 #0a2a18; }
.qf-lp-lb-banner.dps    { color:#ffd2a8; text-shadow:0 0 22px rgba(255,154,58,.95), 0 3px 0 #2a0f04; }
@keyframes qf-lp-banner-anim { 0%{opacity:0; transform:scale(.7)} 22%{opacity:1; transform:scale(1.05)} 78%{opacity:1; transform:scale(1)} 100%{opacity:0; transform:scale(1)} }

/* Duel cinematic letterbox (same shape as Solo Leveling) */
.qf-lp-letterbox { position:absolute; inset:0; pointer-events:none; z-index:34; }
/* width:auto is REQUIRED. The party-panel qf-lp-bar rule above sets width:50%,
   and for an abs-positioned box with left + right + width all set, the browser
   ignores right — so that leaked 50% clipped these bars to the left half
   (the "cut off on the right" bug). width:auto lets left:0/right:0 span full. */
.qf-lp-letterbox .qf-lp-bar { position:absolute; left:0; right:0; width:auto; height:9vh;
  background:#0a0612; transform:scaleY(0); transition:transform .55s cubic-bezier(.16,.84,.3,1); }
.qf-lp-letterbox .qf-lp-bar.top    { top:0;    transform-origin:top;
  box-shadow:0 2px 0 rgba(255,214,107,.55), 0 12px 26px -10px rgba(255,214,107,.55); }
.qf-lp-letterbox .qf-lp-bar.bottom { bottom:0; transform-origin:bottom;
  box-shadow:0 -2px 0 rgba(255,214,107,.55), 0 -12px 26px -10px rgba(255,214,107,.55); }
.qf-lp-letterbox.show .qf-lp-bar { transform:scaleY(1); }

/* Duel HUD — boss HP top center + party HP bottom left + boss cast bar */
.qf-lp-duel { position:absolute; inset:0; z-index:35; pointer-events:none;
  font-family:'Press Start 2P','Courier New',monospace; opacity:0; transition:opacity .55s ease; }
.qf-lp-duel.show { opacity:1; }
/* Sit at the TOP OF THE GAMEPLAY WINDOW (just under the top UI bar), not over
   the chrome. --hud-top (fallback 96px) is the gameplay viewport's top edge —
   same reference the FFXIV corner party panel uses. top:24px put it over the UI. */
/* Narrowed to 560px (was 720) so the centered boss bar's left edge (stage x
   680) clears the FFXIV party panel on the left (right edge ~640) — at 720 it
   overlapped the panel by ~40px. */
.qf-lp-duel-boss { position:absolute; top:calc(var(--hud-top,96px) + 10px); left:50%; transform:translateX(-50%);
  width:min(42vw,560px); display:flex; flex-direction:column; gap:6px; }
.qf-lp-duel-boss-name { font-size:clamp(13px,1.7vw,20px); letter-spacing:3px; color:#ffd6cf;
  text-align:center; text-shadow:0 0 12px rgba(255,90,60,.8); }
.qf-lp-duel-boss-track { height:28px; background:rgba(4,8,16,.85);
  border:3px solid rgba(255,140,120,.6); border-radius:3px; overflow:hidden;
  box-shadow:0 0 16px rgba(255,90,60,.4); position:relative; }
.qf-lp-duel-boss-fill { position:absolute; right:0; top:0; bottom:0; width:100%;
  background:linear-gradient(270deg,#5a0a0a,#ff5544); transition:width .18s linear; }
.qf-lp-duel-boss-cast { height:10px; background:rgba(4,8,16,.85);
  border:2px solid rgba(255,180,80,.6); border-radius:2px; overflow:hidden; position:relative; }
.qf-lp-duel-boss-cast-fill { position:absolute; left:0; top:0; bottom:0; width:0%;
  background:linear-gradient(90deg,#6b3014,#ffb44a); transition:width .12s linear; }
.qf-lp-duel-boss-cast-label { position:absolute; inset:0; text-align:center; font-size:7px;
  line-height:8px; letter-spacing:1px; color:#fff7d8; padding-top:1px; pointer-events:none; }

/* Boss CAST bar — its own element pinned JUST RIGHT of the FFXIV corner party
   panel (left side), not under the boss HP bar. Shows the spell name + a fill
   that races over the cast's duration. Hidden (.show toggled) between casts.
   left = panel left (--hud-side + 12) + panel width (~308) + gap. */
.qf-lp-castbar { position:absolute; z-index:43; pointer-events:none;
  top:calc(var(--hud-top,96px) + 92px);
  left:calc(var(--hud-side,320px) + 12px + 320px);
  width:230px; opacity:0; transition:opacity .15s ease;
  font-family:'Press Start 2P','Courier New',monospace; }
.qf-lp-castbar.show { opacity:1; }
.qf-lp-castbar-label { font-size:8px; line-height:1.2; letter-spacing:1px; color:#fff7d8;
  margin:0 0 4px 1px; text-shadow:0 0 8px rgba(255,180,80,.85), 0 1px 0 #2a1505; }
.qf-lp-castbar-track { height:15px; background:rgba(4,8,16,.85);
  border:2px solid rgba(255,180,80,.6); border-radius:2px; overflow:hidden;
  position:relative; box-shadow:0 0 12px rgba(255,160,60,.35); }
.qf-lp-castbar-fill { position:absolute; left:0; top:0; bottom:0; width:0%;
  background:linear-gradient(90deg,#6b3014,#ffb44a); }

.qf-lp-duel-party { position:absolute; bottom:calc(9vh + 22px); left:6vw;
  display:flex; flex-direction:column; gap:5px; min-width:240px; padding:8px 10px;
  background:rgba(8,12,24,.78); border:2px solid rgba(255,214,107,.55);
  border-radius:3px; box-shadow:0 0 16px rgba(255,214,107,.35); }
.qf-lp-duel-party-title { font-size:9px; letter-spacing:3px; color:#ffd66b; text-align:center; }
.qf-lp-duel-row { display:flex; align-items:center; gap:6px; font-size:8px; }
.qf-lp-duel-row .qf-lp-role-tag { width:18px; text-align:center; font-size:11px; }
.qf-lp-duel-row .qf-lp-name { width:72px; color:#dfeaff; }
.qf-lp-duel-row .qf-lp-track { flex:1; height:11px; background:rgba(4,8,16,.85);
  border:1.5px solid rgba(120,150,200,.45); border-radius:2px; overflow:hidden; position:relative; }
.qf-lp-duel-row .qf-lp-fill { position:absolute; left:0; top:0; bottom:0; width:100%;
  transition:width .18s linear; }
.qf-lp-duel-row.tank      .qf-lp-fill { background:linear-gradient(90deg,#0a2a6b,#6aaaff); }
.qf-lp-duel-row.healer    .qf-lp-fill { background:linear-gradient(90deg,#1c4a2e,#aef0c4); }
.qf-lp-duel-row.meleeDps  .qf-lp-fill { background:linear-gradient(90deg,#6b1c14,#ff8a6a); }
.qf-lp-duel-row.rangedDps .qf-lp-fill { background:linear-gradient(90deg,#3a1c6a,#c9a9ff); }
.qf-lp-duel-row.dead { opacity:.4; }
.qf-lp-duel-row.dead .qf-lp-fill { background:#3a0a0a !important; }

.qf-lp-duel-beat { position:absolute; left:0; right:0; top:30%; z-index:36; text-align:center;
  pointer-events:none; font-family:'Press Start 2P','Courier New',monospace;
  font-size:clamp(15px,2.4vw,30px); letter-spacing:5px; opacity:0; }
.qf-lp-duel-beat.show { animation:qf-lp-beat-anim 1.6s cubic-bezier(.2,.9,.2,1) forwards; }
.qf-lp-duel-beat.aoe   { color:#ffd2a8; text-shadow:0 0 18px rgba(255,154,58,.95), 0 3px 0 #2a0f04; }
.qf-lp-duel-beat.stack { color:#aedcff; text-shadow:0 0 18px rgba(74,160,255,.95), 0 3px 0 #02040a; }
.qf-lp-duel-beat.lb3   { color:#fff7d8; text-shadow:0 0 22px rgba(255,214,107,.95), 0 3px 0 #2a1505; }
.qf-lp-duel-beat.tankbuster { color:#ff8a8a; text-shadow:0 0 18px rgba(255,48,48,.95), 0 3px 0 #2a0404; }
@keyframes qf-lp-beat-anim { 0%{opacity:0; transform:scale(.6)} 18%{opacity:1; transform:scale(1.08)}
  78%{opacity:1; transform:scale(1)} 100%{opacity:0; transform:scale(1)} }

.qf-lp-finale { position:absolute; inset:0; z-index:37; pointer-events:none;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:10px; opacity:0; transition:opacity .5s ease; }
.qf-lp-finale.show { opacity:1; }
.qf-lp-finale::before { content:''; position:absolute; inset:0;
  background:radial-gradient(circle at 50% 50%, rgba(8,12,30,.0) 30%, rgba(2,4,10,.78) 100%); }
.qf-lp-finale-kicker { position:relative; font-family:'Press Start 2P','Courier New',monospace;
  font-size:clamp(9px,1.1vw,13px); letter-spacing:5px; }
.qf-lp-finale-title { position:relative; font-family:'Press Start 2P','Courier New',monospace;
  font-size:clamp(22px,3.6vw,46px); letter-spacing:3px;
  animation:qf-lp-finale-pop .6s cubic-bezier(.18,.9,.25,1) both; }
.qf-lp-finale.win .qf-lp-finale-kicker { color:#ffd66b; text-shadow:0 0 12px rgba(255,214,107,.8); }
.qf-lp-finale.win .qf-lp-finale-title  { color:#fff7d8; text-shadow:0 0 26px rgba(255,214,107,.95), 0 3px 0 #2a1505; }
.qf-lp-finale.loss .qf-lp-finale-kicker { color:#ffb0a4; text-shadow:0 0 12px rgba(255,90,60,.8); }
.qf-lp-finale.loss .qf-lp-finale-title  { color:#ffd6cf; text-shadow:0 0 26px rgba(255,70,46,.9), 0 3px 0 #1a0202; }
.qf-lp-finale-sub   { position:relative; font-family:'Press Start 2P','Courier New',monospace;
  font-size:clamp(9px,1.2vw,15px); letter-spacing:3px; color:#dfeaff; }

/* FFXIV duty banners (DUTY COMMENCED / COMPLETE / FAILED). The art is a
   1280x360 gold word-mark with built-in glow on transparency — shown as a
   centered <img> that fades + scales in, holds, then fades out. Same screen-
   space slate treatment FFXIV uses on duty start/clear/fail. */
.qf-lp-duty { position:absolute; left:50%; top:42%; transform:translate(-50%,-50%) scale(.7);
  z-index:46; pointer-events:none; opacity:0;
  width:min(72vw,860px); height:auto;
  filter:drop-shadow(0 0 24px rgba(255,214,107,.35)); }
.qf-lp-duty.show { animation:qf-lp-duty-anim 2600ms cubic-bezier(.2,.9,.2,1) forwards; }
.qf-lp-duty.failed.show { animation:qf-lp-duty-fail 2600ms cubic-bezier(.2,.9,.2,1) forwards; }
@keyframes qf-lp-duty-anim {
  0%   { opacity:0; transform:translate(-50%,-50%) scale(.7); }
  14%  { opacity:1; transform:translate(-50%,-50%) scale(1.04); }
  24%  { opacity:1; transform:translate(-50%,-50%) scale(1); }
  78%  { opacity:1; transform:translate(-50%,-50%) scale(1); }
  100% { opacity:0; transform:translate(-50%,-50%) scale(1.02); }
}
/* Failed slams in harder + a brief shudder, like FFXIV's duty-fail stamp. */
@keyframes qf-lp-duty-fail {
  0%   { opacity:0; transform:translate(-50%,-50%) scale(1.5); }
  10%  { opacity:1; transform:translate(-50%,-50%) scale(.96); }
  16%  { transform:translate(-51.5%,-50%) scale(1); }
  20%  { transform:translate(-48.5%,-50%) scale(1); }
  24%  { transform:translate(-50%,-50%) scale(1); }
  80%  { opacity:1; transform:translate(-50%,-50%) scale(1); }
  100% { opacity:0; transform:translate(-50%,-50%) scale(1); }
}
@keyframes qf-lp-finale-pop { 0%{opacity:0; transform:scale(.6); filter:blur(6px)}
  60%{opacity:1; transform:scale(1.05); filter:blur(0)} 100%{opacity:1; transform:scale(1)} }
`
    const el = document.createElement('style')
    el.id = 'qf-lp-cinematic-css'
    el.textContent = css
    document.head.appendChild(el)
  }

  _wire() {
    const sub = (evt, fn) => { EventBus.on(evt, fn); this._listeners.push([evt, fn]) }
    sub('LIGHT_PARTY_BEGAN',       (p) => this._onBegan(p ?? {}))
    sub('LIGHT_PARTY_LB_GAUGE',    (p) => this._onLbGauge(p ?? {}))
    sub('LIGHT_PARTY_LB_FIRED',    (p) => this._onLbFired(p ?? {}))
    sub('LIGHT_PARTY_RAISE_STARTED',     (p) => this._onRaiseStarted(p ?? {}))
    sub('LIGHT_PARTY_RAISE_INTERRUPTED', (p) => this._onRaiseEnded(p ?? {}))
    sub('LIGHT_PARTY_RAISED',            (p) => this._onRaiseEnded(p ?? {}))
    sub('LIGHT_PARTY_RAISE_CANCELLED',   (p) => this._onRaiseEnded(p ?? {}))
    // Per-member HP feed for the corner panel. AdventurerRenderer publishes
    // these on its update tick for Light Party members (a noop the rest of
    // the time, same gating shape Solo Leveling uses for SHADOW_MONARCH_HP).
    sub('LIGHT_PARTY_HP',          (p) => this._onMemberHp(p ?? {}))
    sub('ADVENTURER_DIED',         (p) => this._onAdvDied(p ?? {}))
    // Duel beats — driven by BossSystem when the party reaches the throne.
    sub('LIGHT_PARTY_DUEL_BEGAN',  (p) => this._onDuelBegan(p ?? {}))
    sub('LIGHT_PARTY_DUEL_HP',     (p) => this._onDuelHp(p ?? {}))
    sub('LIGHT_PARTY_DUEL_BEAT',   (p) => this._onDuelBeat(p ?? {}))
    sub('LIGHT_PARTY_DUEL_CAST',   (p) => this._onDuelCast(p ?? {}))
    sub('LIGHT_PARTY_DUEL_END',    (p) => this._onDuelEnd(p ?? {}))
    sub('LIGHT_PARTY_DUTY_BANNER', (p) => this._onDutyBanner(p ?? {}))
    sub('DAY_PHASE_ENDED',         () => this._end())
  }

  // FFXIV duty banner — kind: 'commenced' | 'complete' | 'failed'. Shows the
  // matching gold word-mark sprite center-screen with a fade+scale slate
  // animation, then removes it. BossSystem fires these at the duel's start
  // (commenced) and resolution (complete/failed).
  _onDutyBanner({ kind = 'commenced' } = {}) {
    const SRC = {
      commenced: 'assets/ui/duty/duty-commenced.png',
      complete:  'assets/ui/duty/duty-complete.png',
      failed:    'assets/ui/duty/duty-failed.png',
    }
    const src = SRC[kind]
    if (!src || !this._stage) return
    // Build the <img> and set src/alt directly (not via h's attr handling) so
    // the banner loads regardless of what keys the DOM helper whitelists.
    const img = h('img', { className: `qf-lp-duty${kind === 'failed' ? ' failed' : ''}` })
    img.src = src
    img.alt = ''
    this._stage.appendChild(img)
    // eslint-disable-next-line no-unused-expressions
    img.offsetHeight
    img.classList.add('show')
    // The animation runs 2600ms; remove a hair after it ends.
    setTimeout(() => img.remove(), 2800)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    this._clearTimers()
    this._end()
  }

  _after(ms, fn) { const t = setTimeout(fn, ms); this._timers.push(t); return t }
  _clearTimers() { for (const t of this._timers) clearTimeout(t); this._timers = [] }

  // ── Entrance ───────────────────────────────────────────────────────────
  _onBegan({ members = [] } = {}) {
    this._members = members.map(a => ({
      instanceId: a.instanceId,
      role:       a._lightPartyRole,
      name:       a.name || ROLE_LABEL[a._lightPartyRole] || 'PARTY',
      maxHp:      a.resources?.maxHp ?? 100,
      hp:         a.resources?.hp ?? 100,
    }))
    this._lbValue = 0
    this._lbMax   = 100
    this._duelStarted = false
    this._startVignette()
    this._buildCornerPanel()
    this._playEntrance()
    // After the entrance card auto-dismisses (~3.8s), slam in the FFXIV
    // "DUTY COMMENCED" banner so the run-up reads like entering a duty.
    this._after(4000, () => this._onDutyBanner({ kind: 'commenced' }))
  }

  _playEntrance() {
    if (this._entrance) this._entrance.remove()
    const kicker = h('div', { className: 'qf-lp-kicker' }, '◆  LIGHT PARTY  ◆')
    const title  = h('div', { className: 'qf-lp-title' }, 'WARRIORS OF LIGHT')
    const sub    = h('div', { className: 'qf-lp-sub' }, 'TANK · HEALER · DPS · DPS')
    // Role chips — unique roles only, fade in one at a time. Order tank → healer → DPS.
    const roleOrder = ['tank', 'healer', 'meleeDps', 'rangedDps']
    const roles = roleOrder.filter(r => this._members.some(m => m.role === r))
    const chipEls = roles.map(r => h('div', { className: 'qf-lp-role-chip' }, [
      h('div', { className: 'qf-lp-role-icon' }, ROLE_ICON[r] || '·'),
      h('div', { className: 'qf-lp-role-label', style: { color: ROLE_COLOR[r] || '#fff' } }, ROLE_LABEL[r] || ''),
    ]))
    const rolesWrap = h('div', { className: 'qf-lp-roles' }, chipEls)
    this._entrance = h('div', { className: 'qf-lp-entrance' }, [
      h('div', { className: 'qf-lp-dim' }),
      h('div', { className: 'qf-lp-stack' }, [kicker, title, sub, rolesWrap]),
    ])
    this._entrance.addEventListener('click', () => this._dismissEntrance())
    this._stage.appendChild(this._entrance)
    // eslint-disable-next-line no-unused-expressions
    this._entrance.offsetHeight
    this._entrance.classList.add('show')
    this._after(220,  () => kicker.classList.add('in'))
    this._after(680,  () => title.classList.add('in'))
    this._after(1300, () => sub.classList.add('in'))
    this._after(1700, () => {
      rolesWrap.classList.add('in')
      // Stagger chip pop-ins for the "party assembled" beat.
      chipEls.forEach((c, i) => this._after(i * 250, () => c.classList.add('in')))
      // Single gold flash when the last chip lands.
      this._after(roles.length * 250 + 120, () => {
        this._entrance?.classList.add('flash')
        this._after(420, () => this._entrance?.classList.remove('flash'))
      })
    })
    this._after(3800, () => this._dismissEntrance())
  }

  _dismissEntrance() {
    if (!this._entrance) return
    const el = this._entrance
    this._entrance = null
    el.classList.remove('show')
    setTimeout(() => el.remove(), 400)
  }

  // ── Persistent vignette ────────────────────────────────────────────────
  _startVignette() {
    if (this._vignette) return
    this._vignette = h('div', { className: 'qf-lp-vignette' })
    this._stage.appendChild(this._vignette)
    // eslint-disable-next-line no-unused-expressions
    this._vignette.offsetHeight
    this._vignette.classList.add('show')
  }

  _hideVignette() {
    if (!this._vignette) return
    const v = this._vignette
    this._vignette = null
    v.classList.remove('show')
    setTimeout(() => v.remove(), 500)
  }

  // ── Corner party panel (persistent) ────────────────────────────────────
  // FFXIV party-list layout: gold LIMIT BREAK bar on top, gold LIGHT PARTY
  // label, then one row per member — colored job-icon frame + (badge / Lv /
  // name) + a half-width HP bar with the current HP value beneath it. The HP
  // bar tracks live damage via _onMemberHp (fed by LIGHT_PARTY_HP from
  // AISystem). (MP bar removed 2026-05-30 — it was cosmetic and tracked nothing.)
  _buildCornerPanel() {
    if (this._cornerPanel) this._hideCornerPanel()
    this._cornerBars = {}

    // LIMIT BREAK section (top of the panel).
    const lbFill = h('div', { className: 'qf-lp-limit-fill' })
    this._cornerLbFill = lbFill
    this._cornerLb = h('div', { className: 'qf-lp-limit' }, [
      h('div', { className: 'qf-lp-limit-head qf-lp-gold-text' }, 'LIMIT BREAK'),
      h('div', { className: 'qf-lp-limit-bar' }, [
        h('div', { className: 'qf-lp-limit-track' }, [lbFill]),
      ]),
    ])
    // Restore the gauge fill if already partway up (save/load mid-event).
    if (this._lbMax > 0) {
      lbFill.style.width = `${Math.round((this._lbValue / this._lbMax) * 100)}%`
      this._cornerLb.classList.toggle('full', this._lbValue >= this._lbMax)
    }

    const rows = this._members.map((m, i) => {
      const hpFill = h('div', { className: 'qf-lp-bar-fill' })
      const hpNum  = h('div', { className: 'qf-lp-hp' }, this._fmtInt(m.hp))
      const row = h('div', { className: `qf-lp-row ${m.role}` }, [
        h('div', { className: `qf-lp-job ${m.role}` }, ROLE_ICON[m.role] || '◆'),
        h('div', { className: 'qf-lp-rowmain' }, [
          h('div', { className: 'qf-lp-rowtop' }, [
            h('div', { className: 'qf-lp-badge' }, String(i + 1)),
            h('div', { className: 'qf-lp-lv' }, [h('span', { className: 'sm' }, 'Lv'), '50']),
            h('div', { className: 'qf-lp-name' }, m.name || ''),
          ]),
          h('div', { className: 'qf-lp-bar hp' }, [hpFill]),
          h('div', { className: 'qf-lp-nums' }, [hpNum]),
        ]),
      ])
      this._cornerBars[m.instanceId] = { fillEl: hpFill, numEl: hpNum, rowEl: row }
      return row
    })

    this._cornerPanel = h('div', { className: 'qf-lp-corner' }, [
      this._cornerLb,
      h('div', { className: 'qf-lp-corner-title qf-lp-gold-text' }, 'LIGHT PARTY'),
      ...rows,
    ])
    this._stage.appendChild(this._cornerPanel)
    // eslint-disable-next-line no-unused-expressions
    this._cornerPanel.offsetHeight
    this._cornerPanel.classList.add('show')
  }

  // Plain integer formatter for HP values (rounds, handles null).
  _fmtInt(n) { return String(Math.max(0, Math.round(n ?? 0))) }

  _hideCornerPanel() {
    if (!this._cornerPanel) return
    const el = this._cornerPanel
    this._cornerPanel = null
    this._cornerBars = {}
    this._cornerLbFill = null
    this._cornerLb = null
    el.classList.remove('show')
    setTimeout(() => el.remove(), 400)
  }

  _onMemberHp({ instanceId, hp, maxHp } = {}) {
    const bar = this._cornerBars[instanceId]
    if (!bar) return
    const m = this._members.find(x => x.instanceId === instanceId)
    if (m) { m.hp = hp ?? m.hp; m.maxHp = maxHp ?? m.maxHp }
    const frac = Math.max(0, Math.min(1, (hp ?? 0) / (maxHp || 1)))
    bar.fillEl.style.width = `${Math.round(frac * 100)}%`
    // FFXIV party list shows the current HP value only (not "hp/maxHp").
    if (bar.numEl) bar.numEl.textContent = this._fmtInt(hp)
    if (hp <= 0) bar.rowEl.classList.add('dead')
    else         bar.rowEl.classList.remove('dead')
    // Mirror to duel panel if it's up.
    const duelBar = this._duelPartyBars[instanceId]
    if (duelBar) {
      duelBar.fillEl.style.width = `${Math.round(frac * 100)}%`
      if (hp <= 0) duelBar.rowEl.classList.add('dead')
      else         duelBar.rowEl.classList.remove('dead')
    }
  }

  _onAdvDied({ adventurer } = {}) {
    if (!adventurer?._lightParty) return
    const bar = this._cornerBars[adventurer.instanceId]
    if (bar) {
      bar.fillEl.style.width = '0%'
      if (bar.numEl) bar.numEl.textContent = '0'
      bar.rowEl.classList.add('dead')
    }
    const dbar = this._duelPartyBars[adventurer.instanceId]
    if (dbar) {
      dbar.fillEl.style.width = '0%'
      dbar.rowEl.classList.add('dead')
    }
  }

  _onLbGauge({ value = 0, max = 100 } = {}) {
    this._lbValue = value
    this._lbMax   = max
    if (this._cornerLbFill) {
      this._cornerLbFill.style.width = `${Math.round((value / max) * 100)}%`
    }
    if (this._cornerLb) {
      this._cornerLb.classList.toggle('full', value >= max)
    }
  }

  // ── Tactical LB fire — screen flash + banner ───────────────────────────
  _onLbFired({ kind } = {}) {
    const cls = kind === 'tank' ? 'tank' : kind === 'healer' ? 'healer' : 'dps'
    const label = kind === 'tank'   ? 'STRONGHOLD'
                : kind === 'healer' ? 'PULSE OF LIFE'
                : 'FINAL HEAVEN'
    const flash = h('div', { className: `qf-lp-lb-flash ${cls}` })
    const banner = h('div', { className: `qf-lp-lb-banner ${cls}` }, label)
    this._stage.appendChild(flash)
    this._stage.appendChild(banner)
    setTimeout(() => flash.remove(),  600)
    setTimeout(() => banner.remove(), 1300)
  }

  // ── Healer Raise cast bar ──────────────────────────────────────────────
  // The Phaser-side LightPartyRenderer paints a world-anchored cast bar
  // above the healer's head (it can track her movement frame-to-frame in
  // world coords). The DOM cinematic layer used to paint its own duplicate
  // bar at left:50%/top:50% — a static screen-centered bar that didn't
  // track anything and just hovered annoyingly. Removed: world-space is the
  // single source of truth, these listeners are no-ops kept for the safety-
  // teardown contract (event still emits to clear gauge bookkeeping).
  _onRaiseStarted() { /* world-anchored bar is owned by LightPartyRenderer */ }
  _onRaiseEnded()   { /* world-anchored bar is owned by LightPartyRenderer */ }

  // ── Duel cinematic ─────────────────────────────────────────────────────
  // BossSystem fires LIGHT_PARTY_DUEL_BEGAN when the party reaches the
  // throne. Outcome (win/loss) is rolled at start and pinned; the cinematic
  // plays out the rolled result. LIGHT_PARTY_DUEL_BEAT lets BossSystem
  // surface the 3 mid-fight mechanic beats; LIGHT_PARTY_DUEL_CAST drives
  // the boss cast bar; LIGHT_PARTY_DUEL_HP keeps the HP bars live.
  _onDuelBegan({ bossName = 'THE BOSS', bossHp = 100, bossMaxHp = 100 } = {}) {
    this._duelStarted = true
    // KEEP the FFXIV corner party panel up through the whole duel so the player
    // watches the members' HP bars drain live as the boss hits them (it used to
    // be swapped out for a bottom party box). No letterbox bars for this fight
    // — removed at user request; the duel reads clean against the dungeon.
    this._buildDuelHud(bossName, bossHp, bossMaxHp)
  }

  _showLetterbox() {
    if (this._letterbox) return
    const botBar = h('div', { className: 'qf-lp-bar bottom' })
    this._letterbox = h('div', { className: 'qf-lp-letterbox' }, [
      h('div', { className: 'qf-lp-bar top' }),
      botBar,
    ])
    this._stage.appendChild(this._letterbox)
    const chrome = document.querySelector('.qf-bottombar')
    const off = chrome ? chrome.offsetHeight : 0
    if (off > 0) botBar.style.bottom = `${off}px`
    // eslint-disable-next-line no-unused-expressions
    this._letterbox.offsetHeight
    this._letterbox.classList.add('show')
  }

  _hideLetterbox() {
    if (!this._letterbox) return
    const el = this._letterbox
    this._letterbox = null
    el.classList.remove('show')
    setTimeout(() => el.remove(), 600)
  }

  _buildDuelHud(bossName, bossHp, bossMaxHp) {
    if (this._duelEl) this._duelEl.remove()
    this._duelBossFill = h('div', { className: 'qf-lp-duel-boss-fill' })
    const bossBox = h('div', { className: 'qf-lp-duel-boss' }, [
      h('div', { className: 'qf-lp-duel-boss-name' }, bossName),
      h('div', { className: 'qf-lp-duel-boss-track' }, [this._duelBossFill]),
    ])
    // Cast bar is its OWN element pinned just right of the FFXIV corner party
    // panel (see .qf-lp-castbar) — NOT under the boss HP bar. Hidden until a
    // cast fires (_onDuelCast toggles .show).
    this._duelBossCastFill  = h('div', { className: 'qf-lp-castbar-fill' })
    this._duelBossCastLabel = h('div', { className: 'qf-lp-castbar-label' }, '')
    this._castBarEl = h('div', { className: 'qf-lp-castbar' }, [
      this._duelBossCastLabel,
      h('div', { className: 'qf-lp-castbar-track' }, [this._duelBossCastFill]),
    ])
    // The party's live HP is shown by the persistent FFXIV corner panel (left),
    // which we keep up for the whole duel — so the duel HUD is now JUST the boss
    // bar + cast bar at top-center. (The old bottom-left duel party box was a
    // duplicate of the corner panel and has been removed.)
    this._duelPartyBars = {}
    this._duelEl = h('div', { className: 'qf-lp-duel' }, [bossBox, this._castBarEl])
    this._stage.appendChild(this._duelEl)
    // eslint-disable-next-line no-unused-expressions
    this._duelEl.offsetHeight
    this._duelEl.classList.add('show')
    // Initial HP fill.
    const frac = bossMaxHp > 0 ? bossHp / bossMaxHp : 1
    this._duelBossFill.style.width = `${Math.round(frac * 100)}%`
  }

  _onDuelHp({ bossHp, bossMaxHp, members } = {}) {
    if (this._duelBossFill && bossHp != null && bossMaxHp != null) {
      const frac = Math.max(0, Math.min(1, bossHp / (bossMaxHp || 1)))
      this._duelBossFill.style.width = `${Math.round(frac * 100)}%`
    }
    // Route member HP straight to the persistent FFXIV corner panel so the
    // bars drain instantly as the boss lands hits (no 100ms wait for the
    // AISystem LIGHT_PARTY_HP tick). Reuses _onMemberHp's corner-bar logic.
    if (Array.isArray(members)) {
      for (const m of members) this._onMemberHp(m)
    }
  }

  // BossSystem fires this to surface a named mechanic moment:
  //   { kind: 'aoe' | 'stack' | 'tankbuster' | 'lb3', label?: string }
  _onDuelBeat({ kind = 'aoe', label = '' } = {}) {
    const text = label ||
      (kind === 'aoe'        ? 'DODGE THE AOE'
      : kind === 'stack'      ? 'STACK ON THE TANK'
      : kind === 'tankbuster' ? 'TANK BUSTER'
      : kind === 'lb3'        ? 'LIMIT BREAK'
      : '')
    const el = h('div', { className: `qf-lp-duel-beat ${kind}` }, text)
    this._stage.appendChild(el)
    // eslint-disable-next-line no-unused-expressions
    el.offsetHeight
    el.classList.add('show')
    setTimeout(() => el.remove(), 1700)
    if (kind === 'lb3') {
      const flash = h('div', { className: 'qf-lp-lb-flash dps' })
      this._stage.appendChild(flash)
      setTimeout(() => flash.remove(), 600)
    }
  }

  // BossSystem fires { name, durationMs } when the boss starts winding up a
  // named attack (e.g. "Allagan Megaflare"). Drives the cast bar.
  _onDuelCast({ name = '', durationMs = 0 } = {}) {
    if (!this._duelBossCastFill || !this._duelBossCastLabel) return
    this._castBarEl?.classList.add('show')
    this._duelBossCastFill.style.transition = 'none'
    this._duelBossCastFill.style.width = '0%'
    this._duelBossCastLabel.textContent = (name || '').toUpperCase()
    // Force reflow so the transition restarts cleanly.
    // eslint-disable-next-line no-unused-expressions
    this._duelBossCastFill.offsetWidth
    this._duelBossCastFill.style.transition = `width ${durationMs}ms linear`
    this._duelBossCastFill.style.width = '100%'
    // Hide the bar shortly after the cast resolves — it's empty between casts.
    clearTimeout(this._castHideT)
    this._castHideT = setTimeout(() => this._castBarEl?.classList.remove('show'), durationMs + 250)
  }

  // The duel's outro cutscene (BossSystem._tickLightPartyOutro) now owns the
  // entire ending — the FFXIV DUTY COMPLETE / DUTY FAILED banner IS the
  // headline, so there is no second VICTORY/WIPE card. By the time this fires
  // (from _finishLightPartyOutro) the survivors have already Recalled out (win)
  // or fallen (loss), so all that's left is to tear down the cinematic chrome
  // and let DayPhase roll to the post-wave summary.
  _onDuelEnd({ outcome = 'loss' } = {}) {
    void outcome
    this._end()
  }

  _end() {
    this._clearTimers()
    this._duelStarted = false
    if (this._entrance) { this._entrance.remove(); this._entrance = null }
    if (this._duelEl)   { this._duelEl.remove();   this._duelEl   = null }
    clearTimeout(this._castHideT); this._castBarEl = null
    for (const id of Object.keys(this._castBars)) this._removeCastBar(id)
    this._hideCornerPanel()
    this._hideLetterbox()
    this._hideVignette()
    this._members = []
  }
}
