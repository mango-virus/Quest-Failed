// HudSfx — DOM-side audio bridge for the new HUD.
//
// Phaser's SfxSystem owns gameplay SFX (combat, deaths, doors, etc).
// This module handles the UI-only cues that originate from DOM events
// the EventBus can't observe: button clicks, panel switches, toast
// appearances. Routes through `window.__game.sound` so it shares the
// existing master/SfxVolume slider math.
//
// Rate-limited per-key so a rapid-fire click doesn't machine-gun the
// chip. UI cues respect the master + SFX volume sliders via SfxVolume
// (read fresh each play — the user can adjust mid-session).
//
// Mounted once from HudRoot. No event subscriptions — `playUi(key)`
// is called directly by the surfaces that want a click feel.

import { SfxVolume } from '../systems/SfxVolume.js'

// Per-cue base gain. Kept conservative so UI clicks don't drown out
// gameplay SFX. Tweak via SettingsOverlay's master + sfx sliders.
// Bumped 2026-05-19 — values calibrated to the actual source files
// (e.g. `Press button.wav` is naturally quiet, needs ~2.5 base to
// cut through; `cursor hover button.mp3` is brighter, lower base).
const UI_VOL = {
  hover:        0.55,  // soft hover whisper — still subtle, now audible
  click:        2.50,  // Press button.wav — needs heavy boost to cut through
  click_danger: 1.80,  // sacrifice / abandon — louder so it feels weighty
  denied:       1.60,  // locked-companion click / disallowed action
  toast:        0.65,  // toast appear chip
  tab:          0.70,  // tab switch in overlays
  open_panel:   0.90,  // overlay open
  close_panel:  0.75,  // overlay close
  // Unlock-notification overlay chips — celebratory, slightly punchier.
  // Both files are well-mixed at source, so base ~1.0 reads fine without
  // overpowering the ambient menu music.
  unlock_reward:      1.10,  // boss / companion / title card pops in
  unlock_achievement: 1.10,  // achievement card pops in (gold trophy)
  demote:             1.20,  // leaderboard-demotion card — ominous, weighty
  whats_new:          1.10,  // WHAT'S NEW panel auto-pops for a returning player
  // ── Cinematic apex stingers (UI_POLISH_PLAN P2-1) ──────────────────────
  // Hero-moment one-shots fired from the full-screen cinematics at their apex
  // beats. DORMANT until their audio files are added + registered in Preload —
  // playUi silently no-ops while the key isn't in the Phaser cache (see the
  // cache-existence guard below), so wiring these ships NO assets. Base gains
  // are starting points; tune once the real files are in. Louder than UI chips
  // (these are dramatic beats, not clicks).
  cin_arise:      1.60,
  cin_ascension:  1.60,
  cin_kingdom:    1.55,
  cin_bladelock:  1.30,
  cin_finalblow:  1.60,
  cin_collapse:   1.60,
  cin_verdict:    1.45,
  cin_duty:       1.45,
  cin_lb3:        1.55,
  cin_coin_land:  1.25,
  cin_coin_win:   1.55,
}

// Global UI-boost multiplier — mirrors SfxSystem.SFX_BOOST (1.5) so the
// UI chips don't read as quieter than gameplay sounds. Phaser's WebAudio
// gain accepts >1, and the SfxSystem already relies on this for boosted
// payouts (collect-gold pickup, dark-pact stinger).
const UI_BOOST = 1.6

// Map cue → existing SFX key. Reuses gameplay sounds to avoid shipping
// new assets; the design's audio README marked the new UI cues as
// "wire to existing SfxVolume" so this matches the spec.
const UI_KEY = {
  hover:        'sfx-btn-hover',     // dedicated cursor-hover chip
  click:        'sfx-btn-click',     // dedicated press-button chip
  click_danger: 'sfx-error',         // descending tone for destructive choice
  denied:       'sfx-error',         // same error.wav as click_danger; semantic alias for "locked / disallowed"
  toast:        'sfx-door-open',     // gentle "arrives" feel
  tab:          'sfx-chest-open',    // hollow flip
  open_panel:   'sfx-chest-open',
  close_panel:  'sfx-close-door',
  unlock_reward:      'sfx-unlock-reward',      // boss / companion / title card
  unlock_achievement: 'sfx-unlock-achievement', // achievement card
  demote:             'sfx-boss-death',          // dethroned — "the mighty have fallen"
  whats_new:          'sfx-whats-new',           // WHAT'S NEW auto-pop chime
  // Cinematic apex stingers (P2-1) — these audio keys are NOT loaded yet; the
  // game ships no files for them, so each cue no-ops until the file is added to
  // Preload under the matching key. Add e.g. `this.load.audio('sfx-cin-arise',
  // 'assets/audio/cin/arise.mp3')` in Preload, then it lights up automatically.
  cin_arise:      'sfx-cin-arise',
  cin_ascension:  'sfx-cin-ascension',
  cin_kingdom:    'sfx-cin-kingdom',
  cin_bladelock:  'sfx-cin-bladelock',
  cin_finalblow:  'sfx-cin-finalblow',
  cin_collapse:   'sfx-cin-collapse',
  cin_verdict:    'sfx-cin-verdict',
  cin_duty:       'sfx-cin-duty',
  cin_lb3:        'sfx-cin-lb3',
  cin_coin_land:  'sfx-cin-coin-land',
  cin_coin_win:   'sfx-cin-coin-win',
}

// Per-cue cooldown (ms) — prevents back-to-back clicks from layering.
const COOLDOWN = {
  hover:        80,
  click:        90,
  click_danger: 200,
  denied:       180,
  toast:        180,
  tab:          120,
  open_panel:   200,
  close_panel:  150,
  // Unlock chips need a long cooldown — back-to-back card advances
  // through the queue (Enter / Space spam) shouldn't layer the same
  // sound on top of itself.
  unlock_reward:      300,
  unlock_achievement: 300,
  demote:             300,
  whats_new:          500,  // one-shot per session; long guard so it never layers
  // Cinematic apex stingers (P2-1) — long guards; each fires at most once per
  // beat, and a long cooldown stops a re-fired event from layering the sting.
  cin_arise:      800,
  cin_ascension:  800,
  cin_kingdom:    800,
  cin_bladelock:  350,
  cin_finalblow:  600,
  cin_collapse:   800,
  cin_verdict:    800,
  cin_duty:       600,
  cin_lb3:        600,
  cin_coin_land:  500,
  cin_coin_win:   500,
}

const _lastAt = {}

export const HudSfx = {
  playUi(cue) {
    if (SfxVolume.isMuted()) return
    const cd = COOLDOWN[cue] ?? 100
    const now = performance.now()
    if (_lastAt[cue] && now - _lastAt[cue] < cd) return
    _lastAt[cue] = now

    const sound = window.__game?.sound
    const key   = UI_KEY[cue]
    if (!sound || !key) return
    // Only play if Phaser already loaded the audio in Preload — silent fail
    // otherwise. (DOM HUD ships before the Phaser cache is fully populated.)
    const scenes = window.__game.scene?.scenes ?? []
    const hasIt = scenes.some(s => s.cache?.audio?.exists?.(key))
    if (!hasIt) return

    const base = UI_VOL[cue] ?? 0.5
    // Cap at 4.0 — Phaser's WebAudio gain accepts values >1, and quiet
    // source files (Press button.wav is the prime offender) need real
    // amplification to read at the same loudness as gameplay chips.
    // SfxSystem caps at 4.0 too for its boosted payouts.
    const vol  = Math.min(4.0, base * UI_BOOST * SfxVolume.getVolume())
    if (vol <= 0) return
    try { sound.play(key, { volume: vol }) } catch {}
  },
}

// Convenience: install a delegated click + pointerover listener on the
// HUD stage so every .btn / overlay button gets the click chip for free.
// Surfaces that want a different sound can call HudSfx.playUi('...')
// directly and the delegate will be a no-op (cooldown blocks the
// generic 'click' from also firing).
export function installHudSfxDelegates() {
  const stage = document.getElementById('hud-stage')
  if (!stage || stage.dataset.sfxInstalled === '1') return
  stage.dataset.sfxInstalled = '1'

  stage.addEventListener('click', (e) => {
    const t = e.target
    if (!(t instanceof Element)) return
    const btn = t.closest('button, .btn, .qcm-item, .qf-bottombar-tool, .qf-bottombar-speed-btn, .qf-bottombar-menu, .qf-tab')
    if (!btn) return
    // Distinguish danger buttons by a data attr or known class names so
    // the sacrifice / abandon path gets the descending tone.
    const cls = btn.className || ''
    const danger = /danger|sacrifice|abandon|delete|destroy/i.test(cls)
                || btn.dataset?.kind === 'danger'
    HudSfx.playUi(danger ? 'click_danger' : 'click')
  }, true)

  stage.addEventListener('pointerover', (e) => {
    const t = e.target
    if (!(t instanceof Element)) return
    const btn = t.closest('button, .btn, .qcm-item, .qf-bottombar-tool, .qf-bottombar-speed-btn, .qf-bottombar-menu, .qf-tab')
    if (!btn) return
    HudSfx.playUi('hover')
  }, true)
}
