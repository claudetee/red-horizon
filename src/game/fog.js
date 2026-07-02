// RED HORIZON — fog of war. Single-player keeps one fog layer (the human's;
// the AI is omniscient, as classic RTS AIs are). PVP computes BOTH players'
// fog identically on both peers, so visibility checks inside the simulation
// are deterministic — only rendering picks the local player's layer.

import { TILE, clamp } from '../engine/core.js';

export class Fog {
  constructor(map, pvp = false, localPlayer = 0) {
    this.map = map;
    this.w = map.w; this.h = map.h;
    this.pvp = pvp;
    this.local = localPlayer;
    this.players = pvp ? [0, 1] : [0];
    this.explored = [null, null];
    this.visible = [null, null];
    for (const p of this.players) {
      this.explored[p] = new Uint8Array(this.w * this.h);
      this.visible[p] = new Uint8Array(this.w * this.h);
    }
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d');
    this.imgData = this.ctx.createImageData(this.w, this.h);
    this.dirty = true;
    this.enabled = true;
  }

  stamp(p, cx, cy, r) {
    const w = this.w, h = this.h;
    const r2 = r * r;
    const vis = this.visible[p], exp = this.explored[p];
    const x0 = clamp(cx - r | 0, 0, w - 1), x1 = clamp(cx + r | 0, 0, w - 1);
    const y0 = clamp(cy - r | 0, 0, h - 1), y1 = clamp(cy + r | 0, 0, h - 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          const i = y * w + x;
          vis[i] = 1;
          exp[i] = 1;
        }
      }
    }
  }

  update(game) {
    if (!this.enabled) return;
    for (const p of this.players) {
      this.visible[p].fill(0);
      for (const u of game.units) {
        if (u.owner !== p || u.hp <= 0) continue;
        this.stamp(p, (u.x / TILE) | 0, (u.y / TILE) | 0, u.d.sight);
      }
      for (const b of game.buildings) {
        if (b.owner !== p || b.hp <= 0) continue;
        this.stamp(p, (b.x / TILE) | 0, (b.y / TILE) | 0, b.d.sight);
      }
      // enemy buildings inside vision become "known" to player p
      for (const b of game.buildings) {
        if (b.owner === p) continue;
        const i = ((b.y / TILE) | 0) * this.w + ((b.x / TILE) | 0);
        if (this.visible[p][i]) b.known[p] = true;
      }
    }
    this.dirty = true;
  }

  revealAll() {
    for (const p of this.players) {
      this.explored[p].fill(1);
      this.visible[p].fill(1);
    }
    for (const b of window.__game.buildings) b.known[this.local] = true;
    this.dirty = true;
  }

  // --- local-view queries (rendering, UI) ---
  isVisibleCell(cx, cy) {
    if (!this.enabled) return true;
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return false;
    return !!this.visible[this.local][cy * this.w + cx];
  }
  isVisiblePx(x, y) { return this.isVisibleCell((x / TILE) | 0, (y / TILE) | 0); }
  isExploredCell(cx, cy) {
    if (!this.enabled) return true;
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return false;
    return !!this.explored[this.local][cy * this.w + cx];
  }
  isExploredPx(x, y) { return this.isExploredCell((x / TILE) | 0, (y / TILE) | 0); }

  // --- simulation-side query (deterministic on both peers) ---
  // In single-player only player 0 has a fog layer; everyone else sees all.
  isVisibleForPx(owner, x, y) {
    if (!this.enabled) return true;
    if (!this.visible[owner]) return true;
    const cx = (x / TILE) | 0, cy = (y / TILE) | 0;
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return false;
    return !!this.visible[owner][cy * this.w + cx];
  }

  refreshCanvas() {
    if (!this.dirty) return;
    const d = this.imgData.data;
    const n = this.w * this.h;
    const vis = this.visible[this.local], exp = this.explored[this.local];
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      d[o] = 4; d[o + 1] = 6; d[o + 2] = 9;
      d[o + 3] = this.enabled ? (vis[i] ? 0 : exp[i] ? 132 : 255) : 0;
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
