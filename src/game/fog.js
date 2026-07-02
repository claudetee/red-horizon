// RED HORIZON — fog of war: explored / visible layers with soft rendering.

import { TILE, clamp } from '../engine/core.js';
import { PLAYER } from './data.js';

export class Fog {
  constructor(map) {
    this.map = map;
    this.w = map.w; this.h = map.h;
    this.explored = new Uint8Array(this.w * this.h);
    this.visible = new Uint8Array(this.w * this.h);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d');
    this.imgData = this.ctx.createImageData(this.w, this.h);
    this.dirty = true;
    this.enabled = true;
  }

  stamp(cx, cy, r) {
    const w = this.w, h = this.h;
    const r2 = r * r;
    const x0 = clamp(cx - r | 0, 0, w - 1), x1 = clamp(cx + r | 0, 0, w - 1);
    const y0 = clamp(cy - r | 0, 0, h - 1), y1 = clamp(cy + r | 0, 0, h - 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          const i = y * w + x;
          this.visible[i] = 1;
          this.explored[i] = 1;
        }
      }
    }
  }

  update(game) {
    if (!this.enabled) return;
    this.visible.fill(0);
    for (const u of game.units) {
      if (u.owner !== PLAYER || u.hp <= 0) continue;
      this.stamp((u.x / TILE) | 0, (u.y / TILE) | 0, u.d.sight);
    }
    for (const b of game.buildings) {
      if (b.owner !== PLAYER || b.hp <= 0) continue;
      this.stamp((b.x / TILE) | 0, (b.y / TILE) | 0, b.d.sight);
      // buildings inside vision become "known" to the player
    }
    for (const b of game.buildings) {
      if (b.owner === PLAYER) continue;
      const i = ((b.y / TILE) | 0) * this.w + ((b.x / TILE) | 0);
      if (this.visible[i]) b.known[PLAYER] = true;
    }
    this.dirty = true;
  }

  revealAll() {
    this.explored.fill(1);
    this.visible.fill(1);
    for (const b of window.__game.buildings) b.known[PLAYER] = true;
    this.dirty = true;
  }

  isVisibleCell(cx, cy) {
    if (!this.enabled) return true;
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return false;
    return !!this.visible[cy * this.w + cx];
  }
  isVisiblePx(x, y) { return this.isVisibleCell((x / TILE) | 0, (y / TILE) | 0); }
  isExploredCell(cx, cy) {
    if (!this.enabled) return true;
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return false;
    return !!this.explored[cy * this.w + cx];
  }
  isExploredPx(x, y) { return this.isExploredCell((x / TILE) | 0, (y / TILE) | 0); }

  refreshCanvas() {
    if (!this.dirty) return;
    const d = this.imgData.data;
    const n = this.w * this.h;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      d[o] = 4; d[o + 1] = 6; d[o + 2] = 9;
      d[o + 3] = this.enabled ? (this.visible[i] ? 0 : this.explored[i] ? 132 : 255) : 0;
    }
    this.ctx.putImageData(this.imgData, 0, 0);
    this.dirty = false;
  }

  // draw scaled over world; bilinear smoothing gives us soft shroud edges for free
  draw(ctx, cam, vw, vh) {
    if (!this.enabled) return;
    this.refreshCanvas();
    const z = cam.zoom;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(
      this.canvas,
      cam.x / TILE - 0.5, cam.y / TILE - 0.5, vw / (TILE * z) + 1, vh / (TILE * z) + 1,
      -TILE * z * 0.5, -TILE * z * 0.5, vw + TILE * z, vh + TILE * z
    );
    ctx.restore();
  }
}
