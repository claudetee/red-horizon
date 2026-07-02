// RED HORIZON — procedural mirrored skirmish map + terrain rendering.

import { TILE, mulberry32, clamp } from '../engine/core.js';
import { spr } from '../engine/assets.js';
import { ECON } from './data.js';

export const T_GRASS = 0, T_DIRT = 1, T_WATER = 2, T_ROCK = 3, T_TREE = 4;

export class GameMap {
  constructor(seed = 20260702) {
    this.w = 96; this.h = 96;
    this.tiles = new Uint8Array(this.w * this.h);
    this.ore = new Float32Array(this.w * this.h);
    this.bld = new Int32Array(this.w * this.h).fill(-1); // building entity id per cell
    this.rng = mulberry32(seed);
    this.gen();
  }

  idx(cx, cy) { return cy * this.w + cx; }
  inB(cx, cy) { return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h; }
  tile(cx, cy) { return this.tiles[cy * this.w + cx]; }

  isPassable(cx, cy) {
    if (!this.inB(cx, cy)) return false;
    const t = this.tiles[cy * this.w + cx];
    if (t === T_WATER || t === T_ROCK || t === T_TREE) return false;
    return this.bld[cy * this.w + cx] === -1;
  }
  isBuildable(cx, cy) {
    if (!this.inB(cx, cy)) return false;
    const t = this.tiles[cy * this.w + cx];
    return (t === T_GRASS || t === T_DIRT) && this.bld[cy * this.w + cx] === -1 && this.ore[cy * this.w + cx] <= 0;
  }

  // --- generation: 180°-rotational symmetric two-player steppe ---
  gen() {
    const { w, h, rng } = this;
    const set = (cx, cy, t) => {
      if (!this.inB(cx, cy)) return;
      this.tiles[cy * w + cx] = t;
      const mx = w - 1 - cx, my = h - 1 - cy;   // mirror
      this.tiles[my * w + mx] = t;
    };

    // dirt patches via random blobs
    for (let i = 0; i < 26; i++) {
      const bx = rng() * w, by = rng() * h, r = 3 + rng() * 7;
      for (let cy = (by - r) | 0; cy <= by + r; cy++)
        for (let cx = (bx - r) | 0; cx <= bx + r; cx++) {
          const dx = cx - bx, dy = cy - by;
          if (dx * dx + dy * dy < r * r * (0.55 + rng() * 0.45)) set(cx, cy, T_DIRT);
        }
    }
    // lakes (avoid base corners)
    for (let i = 0; i < 3; i++) {
      const bx = 22 + rng() * 52, by = 22 + rng() * 52;
      const rx = 3.5 + rng() * 5, ry = 2.5 + rng() * 4.5;
      for (let cy = (by - ry - 1) | 0; cy <= by + ry + 1; cy++)
        for (let cx = (bx - rx - 1) | 0; cx <= bx + rx + 1; cx++) {
          const dx = (cx - bx) / rx, dy = (cy - by) / ry;
          if (dx * dx + dy * dy < 1) set(cx, cy, T_WATER);
        }
    }
    // rock clusters
    for (let i = 0; i < 14; i++) {
      const bx = rng() * w, by = rng() * h;
      const n = 2 + (rng() * 4) | 0;
      for (let k = 0; k < n; k++) set((bx + rng() * 4 - 2) | 0, (by + rng() * 4 - 2) | 0, T_ROCK);
    }
    // tree groves
    for (let i = 0; i < 20; i++) {
      const bx = rng() * w, by = rng() * h;
      const n = 3 + (rng() * 6) | 0;
      for (let k = 0; k < n; k++) {
        const cx = (bx + rng() * 6 - 3) | 0, cy = (by + rng() * 6 - 3) | 0;
        if (this.inB(cx, cy) && this.tiles[cy * w + cx] === T_GRASS) set(cx, cy, T_TREE);
      }
    }

    // base areas: clear ground
    this.starts = [{ cx: 14, cy: 79 }, { cx: 81, cy: 16 }];
    for (const s of this.starts) {
      for (let cy = s.cy - 9; cy <= s.cy + 9; cy++)
        for (let cx = s.cx - 9; cx <= s.cx + 9; cx++) {
          if (!this.inB(cx, cy)) continue;
          this.tiles[cy * w + cx] = ((cx + cy) % 7 === 0) ? T_DIRT : T_GRASS;
        }
    }

    // ore fields: one near each base + rich contested center (mirrored)
    const oreBlob = (bx, by, r, rich) => {
      for (let cy = (by - r) | 0; cy <= by + r; cy++)
        for (let cx = (bx - r) | 0; cx <= bx + r; cx++) {
          if (!this.inB(cx, cy)) continue;
          const dx = cx - bx, dy = cy - by;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < r && this.tiles[cy * w + cx] === T_GRASS) {
            const amt = ECON.oreCellMax * rich * (1 - d / r * 0.55) * (0.7 + rng() * 0.3);
            this.ore[cy * w + cx] = Math.min(ECON.oreCellMax, amt);
            const mx = w - 1 - cx, my = h - 1 - cy;
            if (this.tiles[my * w + mx] === T_GRASS) this.ore[my * w + mx] = this.ore[cy * w + cx];
          }
        }
    };
    oreBlob(26, 70, 5.2, 0.95);   // player-side field (mirrors to enemy side)
    oreBlob(15, 62, 3.6, 0.8);
    oreBlob(48, 48, 7.5, 1.0);    // center — self-mirrors
    oreBlob(64, 58, 4.2, 0.9);

    // clear paths near map edge so units can always flank
    for (let i = 0; i < w; i++) {
      for (const cy of [1, h - 2]) if (this.tiles[cy * w + i] !== T_GRASS && this.tiles[cy * w + i] !== T_DIRT) this.tiles[cy * w + i] = T_GRASS;
      for (const cx of [1, w - 2]) if (this.tiles[i * w + cx] !== T_GRASS && this.tiles[i * w + cx] !== T_DIRT) this.tiles[i * w + cx] = T_GRASS;
    }
  }

  // --- rendering ---
  buildTerrainCanvas() {
    const { w, h } = this;
    const c = document.createElement('canvas');
    c.width = w * TILE; c.height = h * TILE;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const tex = { [T_GRASS]: spr('ter_grass'), [T_DIRT]: spr('ter_dirt'), [T_WATER]: spr('ter_water') };
    const texOf = t => (t === T_WATER ? tex[T_WATER] : t === T_DIRT ? tex[T_DIRT] : tex[T_GRASS]);

    // base tiles from 4x4 variants inside each 128px texture
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const t = this.tiles[cy * w + cx];
        const tx = texOf(t);
        ctx.drawImage(tx, (cx % 4) * 32, (cy % 4) * 32, 32, 32, cx * TILE, cy * TILE, TILE, TILE);
      }
    }
    // dithered transitions where terrain class changes (retro checker blend)
    const classOf = t => (t === T_WATER ? 2 : t === T_DIRT ? 1 : 0);
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const t = this.tiles[cy * w + cx];
        const myClass = classOf(t);
        // look right & down only (each boundary handled once)
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (!this.inB(nx, ny)) continue;
          const nt = this.tiles[ny * w + nx];
          if (classOf(nt) === myClass) continue;
          // stamp neighbor's texture into our cell edge as 4px checkers
          const ntex = texOf(nt);
          for (let k = 0; k < 8; k++) {
            const q = 4;
            if (dx === 1) {
              const px = cx * TILE + TILE - q, py = cy * TILE + k * q;
              if ((k % 2) === 0) ctx.drawImage(ntex, (cx % 4) * 32 + TILE - q, (cy % 4) * 32 + k * q, q, q, px, py, q, q);
              const px2 = nx * TILE, py2 = ny * TILE + k * q;
              if ((k % 2) === 1) ctx.drawImage(texOf(t), (cx % 4) * 32, (cy % 4) * 32 + k * q, q, q, px2, py2, q, q);
            } else {
              const px = cx * TILE + k * q, py = cy * TILE + TILE - q;
              if ((k % 2) === 0) ctx.drawImage(ntex, (cx % 4) * 32 + k * q, (cy % 4) * 32 + TILE - q, q, q, px, py, q, q);
              const px2 = nx * TILE + k * q, py2 = ny * TILE;
              if ((k % 2) === 1) ctx.drawImage(texOf(t), (cx % 4) * 32 + k * q, (cy % 4) * 32, q, q, px2, py2, q, q);
            }
          }
        }
      }
    }
    // props: rocks & trees (deterministic jitter)
    const jr = mulberry32(777);
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const t = this.tiles[cy * w + cx];
        if (t !== T_ROCK && t !== T_TREE) continue;
        const s = t === T_ROCK ? spr('prop_rock') : (jr() < 0.5 ? spr('prop_tree1') : spr('prop_tree2'));
        const jx = (jr() - 0.5) * 6, jy = (jr() - 0.5) * 6;
        ctx.drawImage(s, cx * TILE + TILE / 2 - s.width / 2 + jx, cy * TILE + TILE / 2 - s.height / 2 + jy);
      }
    }
    this.terrainCanvas = c;
    return c;
  }

  buildOreCanvas() {
    const { w, h } = this;
    const c = document.createElement('canvas');
    c.width = w * TILE; c.height = h * TILE;
    this.oreDrawn = new Float32Array(w * h);
    this.oreCtx = c.getContext('2d');
    this.oreCtx.imageSmoothingEnabled = false;
    for (let cy = 0; cy < h; cy++)
      for (let cx = 0; cx < w; cx++)
        if (this.ore[cy * w + cx] > 0) this.drawOreCell(cx, cy);
    this.oreCanvas = c;
    return c;
  }

  drawOreCell(cx, cy) {
    const ctx = this.oreCtx;
    ctx.clearRect(cx * TILE, cy * TILE, TILE, TILE);
    const amt = this.ore[cy * this.w + cx];
    if (this.oreDrawn) this.oreDrawn[cy * this.w + cx] = amt;
    if (amt <= 0) return;
    const frac = amt / ECON.oreCellMax;
    const s = frac > 0.55 ? spr('prop_ore1') : spr('prop_ore2');
    const scale = 0.6 + 0.4 * frac;
    const dw = s.width * scale, dh = s.height * scale;
    // deterministic per-cell jitter
    const j = ((cx * 73856093) ^ (cy * 19349663)) >>> 0;
    const jx = ((j % 7) - 3), jy = (((j >> 3) % 7) - 3);
    ctx.drawImage(s, cx * TILE + TILE / 2 - dw / 2 + jx, cy * TILE + TILE / 2 - dh / 2 + jy, dw, dh);
  }

  takeOre(cx, cy, want) {
    const i = cy * this.w + cx;
    const got = Math.min(this.ore[i], want);
    if (got > 0) {
      this.ore[i] -= got;
      if (this.ore[i] < 6) this.ore[i] = 0;
      this.drawOreCell(cx, cy);
    }
    return got;
  }

  regenOre(dt) {
    // slow regen on existing cells (call at low frequency with scaled dt)
    const n = this.w * this.h;
    for (let i = 0; i < n; i++) {
      if (this.ore[i] > 0 && this.ore[i] < ECON.oreCellMax) {
        this.ore[i] = Math.min(ECON.oreCellMax, this.ore[i] + ECON.oreRegen * dt);
        // refresh the sprite once regrowth is visually meaningful
        if (this.oreDrawn && this.ore[i] - this.oreDrawn[i] > 90) {
          this.drawOreCell(i % this.w, (i / this.w) | 0);
        }
      }
    }
  }

  // nearest cell with ore, spiraling out from (cx, cy)
  findOreNear(cx, cy, maxR = 40) {
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx, y = cy + dy;
          if (this.inB(x, y) && this.ore[y * this.w + x] > 40 && this.isPassable(x, y)) return { cx: x, cy: y };
        }
      }
    }
    return null;
  }

  // find nearest passable cell to (cx,cy) not reserved by `taken` set
  findFreeNear(cx, cy, taken, maxR = 10) {
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = clamp(cx + dx, 0, this.w - 1), y = clamp(cy + dy, 0, this.h - 1);
          const k = y * this.w + x;
          if (this.isPassable(x, y) && !taken.has(k)) { taken.add(k); return { cx: x, cy: y }; }
        }
      }
    }
    return { cx, cy };
  }
}
