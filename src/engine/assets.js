// RED HORIZON — asset loading, team recolor baking, cameo icons, procedural decals.

import { PLAYER, ENEMY } from '../game/data.js';

const store = {
  meta: {},        // name -> {file,w,h,pivot,meta}
  img: {},         // name -> HTMLCanvasElement (team 0 / neutral)
  enemy: {},       // name -> canvas (crimson remap)
  cameo: {},       // name -> canvas
  decal: {},       // procedural: crater, scorch...
};

function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

// remap teal-ish pixels to crimson (enemy house color)
function bakeEnemy(srcCanvas) {
  const c = document.createElement('canvas');
  c.width = srcCanvas.width; c.height = srcCanvas.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx === 0) continue;
    const sat = (mx - mn) / mx;
    // teal/cyan: green & blue dominant over red
    if (sat > 0.28 && g > r * 1.25 && b > r * 1.1 && g > 60) {
      // keep luminance, swap to crimson
      const lum = 0.3 * r + 0.55 * g + 0.15 * b;
      d[i] = Math.min(255, lum * 1.55 + 40);
      d[i + 1] = lum * 0.28;
      d[i + 2] = lum * 0.30;
    }
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

function makeCameo(sprite, w = 100, h = 86) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#232d3c'); g.addColorStop(0.55, '#141a24'); g.addColorStop(1, '#0d1119');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(120,150,190,0.14)'; ctx.lineWidth = 5;
  for (let x = -h; x < w + h; x += 14) {
    ctx.beginPath(); ctx.moveTo(x, h + 3); ctx.lineTo(x + h + 6, -3); ctx.stroke();
  }
  const img = sprite;
  const scale = Math.min((w - 26) / img.width, (h - 34) / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, (w - dw) / 2, (h - 34 - dh) / 2 + 6, dw, dh);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
  return c;
}

function makeDecals() {
  // scorch / crater marks
  for (let v = 0; v < 3; v++) {
    const s = 44 + v * 14;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');
    const cx = s / 2, cy = s / 2;
    const rg = ctx.createRadialGradient(cx, cy, 1, cx, cy, s / 2);
    rg.addColorStop(0, 'rgba(10,8,6,0.5)');
    rg.addColorStop(0.55, 'rgba(14,12,9,0.3)');
    rg.addColorStop(1, 'rgba(14,12,9,0)');
    ctx.fillStyle = rg;
    // irregular blob
    ctx.beginPath();
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = (s / 2) * (0.7 + 0.3 * Math.sin(a * 3 + v * 2.1));
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    store.decal['scorch' + v] = c;
  }
  // husk tint pass happens per-unit at death (cheap darken via filter)
}

export async function loadAssets(onProgress) {
  const res = await fetch('assets/sprites.json');
  if (!res.ok) throw new Error(`sprites.json HTTP ${res.status}`);
  store.meta = await res.json();
  const names = Object.keys(store.meta);
  let done = 0;
  await Promise.all(names.map(name => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = toCanvas(img);
      store.img[name] = c;
      if (name.startsWith('unit_') || name.startsWith('bld_')) {
        store.enemy[name] = bakeEnemy(c);
      }
      done++; onProgress && onProgress(done / names.length);
      resolve();
    };
    img.onerror = () => reject(new Error('load fail: ' + name));
    img.src = store.meta[name].file;
  })));
  makeDecals();
  return store;
}

export function spr(name) { return store.img[name]; }
export function sprTeam(name, owner) {
  return owner === ENEMY && store.enemy[name] ? store.enemy[name] : store.img[name];
}
export function sprMeta(name) { return store.meta[name]; }
export function decal(name) { return store.decal[name]; }
export function cameo(name) {
  if (!store.cameo[name]) store.cameo[name] = makeCameo(store.img[name]);
  return store.cameo[name];
}
export function pivotOf(name) {
  const m = store.meta[name];
  return (m && m.pivot) || [0.5, 0.5];
}
