// RED HORIZON — top resource bar (credits / power / clock / radar state).
// The old right-hand sidebar is gone: all production lives on per-building
// command cards in the bottom bar. Class keeps the `Sidebar` name for plumbing.

import { PLAYER } from '../game/data.js';
import { fmtTime } from '../engine/core.js';

// engineer build menu (command card) — order maps to hotkeys Q W E R T Y U I O P J
export const BUILD_MENU = ['power', 'refinery', 'barracks', 'factory', 'radar', 'turret', 'repair', 'tesla', 'silo', 'shield', 'wall'];

export class Sidebar {
  constructor(game, audio) {
    this.audio = audio;
    this.elCredits = document.getElementById('credits');
    this.elClock = document.getElementById('clockbar');
    this.elPowerFill = document.getElementById('powerfill');
    this.elPowerMark = document.getElementById('powermark');
    this.elPowerText = document.getElementById('powertext');
    this.elPowerBar = document.getElementById('powerbar');
    this.elRadarOff = document.getElementById('radar-offline');
    this.setGame(game);
  }

  setGame(game) {
    this.g = game;
    game.onSidebarDirty = () => {};   // per-building UI refreshes itself
    this.dispCredits = game.credits[PLAYER];
    this.elCredits.textContent = Math.floor(this.dispCredits);
  }

  // called every frame
  refresh() {
    const g = this.g;
    const target = Math.floor(g.credits[PLAYER]);
    if (this.dispCredits !== target) {
      const diff = target - this.dispCredits;
      this.dispCredits += Math.abs(diff) < 4 ? diff : Math.ceil(Math.abs(diff) * 0.14) * Math.sign(diff);
      this.elCredits.textContent = Math.floor(this.dispCredits);
    }
    this.elClock.textContent = fmtTime(g.time);

    const p = g.power[PLAYER];
    const scale = Math.max(100, p.out * 1.25, p.use * 1.25);
    this.elPowerFill.style.width = Math.min(100, p.out / scale * 100) + '%';
    this.elPowerMark.style.left = Math.min(98, p.use / scale * 100) + '%';
    this.elPowerText.textContent = `${p.use}/${p.out}`;
    this.elPowerBar.classList.toggle('low', p.out < p.use);

    this.elRadarOff.classList.toggle('hidden', g.hasRadar());
  }
}
