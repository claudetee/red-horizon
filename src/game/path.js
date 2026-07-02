// RED HORIZON — A* pathfinding on the tile grid with a per-tick request queue.

import { Heap } from '../engine/core.js';

const SQRT2 = Math.SQRT2;

export class Pathfinder {
  constructor(map) {
    this.map = map;
    const n = map.w * map.h;
    this.closed = new Int32Array(n);
    this.gscore = new Float64Array(n);
    this.cameFrom = new Int32Array(n);
    this.gen = 0;
    this.queue = [];
  }

  // request async path (processed with per-tick budget); cb(path|null)
  request(sx, sy, tx, ty, cb) {
    this.queue.push({ sx, sy, tx, ty, cb });
  }

  processQueue(budget = 8) {
    let n = 0;
    while (this.queue.length && n < budget) {
      const r = this.queue.shift();
      r.cb(this.find(r.sx, r.sy, r.tx, r.ty));
      n++;
    }
  }

  // nearest passable cell to target (spiral) — so clicks on water/buildings still work
  nearestOpen(tx, ty, maxR = 14) {
    const m = this.map;
    if (m.isPassable(tx, ty)) return { tx, ty };
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx, y = ty + dy;
          if (m.inB(x, y) && m.isPassable(x, y)) return { tx: x, ty: y };
        }
      }
    }
    return null;
  }

  find(sx, sy, txx, tyy, maxNodes = 5200) {
    const m = this.map, w = m.w, h = m.h;
    const t = this.nearestOpen(txx, tyy);
    if (!t) return null;
    const tx = t.tx, ty = t.ty;
    if (sx === tx && sy === ty) return [];

    this.gen++;
    const gen = this.gen, closed = this.closed, gscore = this.gscore, came = this.cameFrom;
    const heap = new Heap();
    const sIdx = sy * w + sx;
    gscore[sIdx] = 0; closed[sIdx] = gen; came[sIdx] = -1;
    const hCost = (x, y) => {
      const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
      return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
    };
    heap.push({ i: sIdx, x: sx, y: sy, f: hCost(sx, sy) });
    let bestI = sIdx, bestH = hCost(sx, sy);
    let nodes = 0;

    const done = new Uint8Array(0); // placeholder (visited tracked via closed generation + gscore)

    while (heap.size) {
      const cur = heap.pop();
      const ci = cur.i;
      // stale heap entry?
      if (cur.f > gscore[ci] + hCost(cur.x, cur.y) + 1e-6) continue;
      if (ci === ty * w + tx) { bestI = ci; break; }
      if (++nodes > maxNodes) break;
      const hh = hCost(cur.x, cur.y);
      if (hh < bestH) { bestH = hh; bestI = ci; }

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cur.x + dx, ny = cur.y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (!m.isPassable(nx, ny)) continue;
          // no corner cutting through blocked orthogonals
          if (dx && dy && (!m.isPassable(cur.x + dx, cur.y) || !m.isPassable(cur.x, cur.y + dy))) continue;
          const ni = ny * w + nx;
          const step = (dx && dy) ? SQRT2 : 1;
          const g = gscore[ci] + step;
          if (closed[ni] === gen && g >= gscore[ni]) continue;
          closed[ni] = gen; gscore[ni] = g; came[ni] = ci;
          heap.push({ i: ni, x: nx, y: ny, f: g + hCost(nx, ny) });
        }
      }
    }

    // rebuild path from bestI (goal or closest reached)
    const path = [];
    let i = bestI;
    while (i !== -1 && i !== sIdx) {
      path.push([i % w, (i / w) | 0]);
      i = came[i];
    }
    path.reverse();
    if (!path.length) return null;
    return this.smooth(sx, sy, path);
  }

  // string-pulling: drop intermediate waypoints when a straight walk is clear
  smooth(sx, sy, path) {
    const out = [];
    let cx = sx, cy = sy;
    let k = 0;
    while (k < path.length) {
      // furthest visible waypoint from current
      let far = k;
      for (let j = Math.min(path.length - 1, k + 18); j > k; j--) {
        if (this.lineClear(cx, cy, path[j][0], path[j][1])) { far = j; break; }
      }
      out.push(path[far]);
      cx = path[far][0]; cy = path[far][1];
      k = far + 1;
    }
    return out;
  }

  lineClear(x0, y0, x1, y1) {
    // supercover grid walk
    const m = this.map;
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let x = x0, y = y0;
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      if (!m.isPassable(x, y)) return false;
      if (x === x1 && y === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) {
        if (e2 < dx && !m.isPassable(x, y + sy)) return false; // diagonal squeeze check
        err -= dy; x += sx;
      } else {
        err += dx; y += sy;
      }
    }
  }
}
