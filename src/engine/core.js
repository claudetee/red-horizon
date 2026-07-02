// RED HORIZON — core utilities: math, RNG, heap, timing.

export const TILE = 32;          // px per tile
export const TPS = 30;           // logic ticks per second
export const DT = 1 / TPS;       // seconds per tick

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

// smallest signed angle from a to b, in [-PI, PI]
export function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function turnToward(cur, target, maxStep) {
  const d = angDiff(cur, target);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

// deterministic RNG
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (rng, arr) => arr[(rng() * arr.length) | 0];

export function fmtTime(sec) {
  sec = Math.max(0, sec | 0);
  const m = (sec / 60) | 0, s = sec % 60;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

export const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

// min-heap keyed by .f — for A*
export class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a; a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

// spatial hash over tile cells (entities can span cells; we bucket by center cell)
export class SpatialHash {
  constructor(cols, rows) { this.cols = cols; this.rows = rows; this.buckets = new Map(); }
  clear() { this.buckets.clear(); }
  insert(e) {
    const cx = clamp((e.x / TILE) | 0, 0, this.cols - 1);
    const cy = clamp((e.y / TILE) | 0, 0, this.rows - 1);
    const k = cy * this.cols + cx;
    let b = this.buckets.get(k);
    if (!b) { b = []; this.buckets.set(k, b); }
    b.push(e);
  }
  // visit entities whose center lies within radius r (px) of (x, y)
  queryCircle(x, y, r, fn) {
    const c0 = clamp(((x - r) / TILE) | 0, 0, this.cols - 1);
    const c1 = clamp(((x + r) / TILE) | 0, 0, this.cols - 1);
    const r0 = clamp(((y - r) / TILE) | 0, 0, this.rows - 1);
    const r1 = clamp(((y + r) / TILE) | 0, 0, this.rows - 1);
    const rr = r * r;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const b = this.buckets.get(cy * this.cols + cx);
        if (!b) continue;
        for (let i = 0; i < b.length; i++) {
          const e = b[i];
          if (dist2(x, y, e.x, e.y) <= rr) fn(e);
        }
      }
    }
  }
}
