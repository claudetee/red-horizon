// RED HORIZON — camera controller + key state.

import { TILE, clamp } from './core.js';

export class CameraRig {
  constructor(game, viewport) {
    this.game = game;
    this.viewport = viewport;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, inside: false };
    this.edgeScroll = true;
    this.panning = false;
    this.panStart = null;
    this.SPEED = 900;

    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setGame(game) {
    this.game = game;
    this.panning = false;
    this.panStart = null;
    this.clampCam();
  }

  screenToWorld(sx, sy) {
    const cam = this.game.cam;
    return { x: cam.x + sx / cam.zoom, y: cam.y + sy / cam.zoom };
  }

  zoomAt(sx, sy, dir) {
    const cam = this.game.cam;
    const before = this.screenToWorld(sx, sy);
    const levels = [0.75, 1, 1.25, 1.5];
    let i = levels.indexOf(cam.zoom);
    if (i === -1) i = 1;
    i = clamp(i + dir, 0, levels.length - 1);
    cam.zoom = levels[i];
    const after = this.screenToWorld(sx, sy);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
    this.clampCam();
  }

  clampCam() {
    const cam = this.game.cam;
    const vw = this.viewport.clientWidth, vh = this.viewport.clientHeight;
    const mw = this.game.map.w * TILE, mh = this.game.map.h * TILE;
    cam.x = clamp(cam.x, 0, Math.max(0, mw - vw / cam.zoom));
    cam.y = clamp(cam.y, 0, Math.max(0, mh - vh / cam.zoom));
  }

  centerOn(x, y) {
    const cam = this.game.cam;
    const vw = this.viewport.clientWidth, vh = this.viewport.clientHeight;
    cam.x = x - vw / cam.zoom / 2;
    cam.y = y - vh / cam.zoom / 2;
    this.clampCam();
  }

  update(dt) {
    const cam = this.game.cam;
    const sp = this.SPEED * dt / cam.zoom;
    let dx = 0, dy = 0;
    const k = this.keys;
    // arrows only — WASD collides with A(attack-move)/S(stop)/QWERTY production hotkeys
    if (k.has('ArrowLeft')) dx -= 1;
    if (k.has('ArrowRight')) dx += 1;
    if (k.has('ArrowUp')) dy -= 1;
    if (k.has('ArrowDown')) dy += 1;
    // edge scroll (only after a real mouse move inside the viewport)
    if (this.edgeScroll && this.mouse.inside && this.mouse.moved && !this.panning && document.hasFocus()) {
      const vw = this.viewport.clientWidth, vh = this.viewport.clientHeight;
      const M = 14;
      if (this.mouse.x < M) dx -= 1;
      else if (this.mouse.x > vw - M) dx += 1;
      if (this.mouse.y < M) dy -= 1;
      else if (this.mouse.y > vh - M) dy += 1;
    }
    if (dx || dy) {
      const n = Math.hypot(dx, dy);
      cam.x += dx / n * sp;
      cam.y += dy / n * sp;
    }
    this.clampCam();
  }
}
