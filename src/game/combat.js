// RED HORIZON — projectiles, particles, damage resolution, explosions.

import { TILE, DT, dist, dist2, angDiff, turnToward, clamp } from '../engine/core.js';
import { WEAPONS } from './data.js';

function radialTex(size, stops) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.particles = [];
    this.tracers = [];
    // pre-baked glow textures — per-frame createRadialGradient is a frame killer
    this.texFlash = radialTex(64, [[0, 'rgba(255,240,190,1)'], [0.5, 'rgba(255,160,60,0.62)'], [1, 'rgba(255,120,40,0)']]);
    this.texFire = radialTex(64, [[0, 'rgba(255,205,80,0.92)'], [0.5, 'rgba(255,120,40,0.55)'], [1, 'rgba(200,60,20,0)']]);
  }

  // ---------- firing ----------
  fire(shooter, weapon, sx, sy, target) {
    const w = weapon;
    const g = this.game;
    const tx = target.x, ty = target.y;
    if (w.kind === 'bullet') {
      // instant hit with tracer
      this.tracers.push({ x0: sx, y0: sy, x1: tx + (g.rng() - .5) * 6, y1: ty + (g.rng() - .5) * 6, life: 0.06 });
      this.applyDamage(target, w.dmg * (w.vs[target.armorClass()] ?? 1), shooter);
      this.spark(tx, ty, 2);
    } else if (w.kind === 'shell') {
      const d = dist(sx, sy, tx, ty);
      const dur = Math.max(0.12, d / w.speed);
      this.projectiles.push({ kind: 'shell', x: sx, y: sy, sx, sy, tx, ty, t: 0, dur, w, owner: shooter.owner, shooter });
    } else if (w.kind === 'rocket') {
      const ang = Math.atan2(ty - sy, tx - sx) + (g.rng() - .5) * 0.5;
      this.projectiles.push({ kind: 'rocket', x: sx, y: sy, ang, spd: w.speed * 0.45, target, tx, ty, life: 3.2, w, owner: shooter.owner, shooter });
    }
    this.muzzle(sx, sy, Math.atan2(ty - sy, tx - sx), w.kind !== 'bullet');
    g.audio.sfx(w.sfx, { x: sx, y: sy });
    g.audio.noteCombat();
  }

  update() {
    const g = this.game;
    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.kind === 'shell') {
        p.t += DT;
        const k = Math.min(1, p.t / p.dur);
        p.x = p.sx + (p.tx - p.sx) * k;
        p.y = p.sy + (p.ty - p.sy) * k;
        if (k >= 1) {
          this.projectiles.splice(i, 1);
          this.impact(p.tx, p.ty, p.w, p.shooter);
        }
      } else if (p.kind === 'rocket') {
        p.life -= DT;
        p.spd = Math.min(p.w.speed, p.spd + 340 * DT);
        const t = p.target;
        const alive = t && t.hp > 0;
        const tx = alive ? t.x : p.tx, ty = alive ? t.y : p.ty;
        const want = Math.atan2(ty - p.y, tx - p.x);
        p.ang = turnToward(p.ang, want, 6.5 * DT);
        p.x += Math.cos(p.ang) * p.spd * DT;
        p.y += Math.sin(p.ang) * p.spd * DT;
        if ((g.tick & 1) === 0) this.puff(p.x, p.y, 'smoke', 3, 0.55);
        if (dist2(p.x, p.y, tx, ty) < 100 || p.life <= 0) {
          this.projectiles.splice(i, 1);
          this.impact(p.x, p.y, p.w, p.shooter);
        }
      }
    }
    // tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      this.tracers[i].life -= DT;
      if (this.tracers[i].life <= 0) this.tracers.splice(i, 1);
    }
    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life -= DT;
      if (q.life <= 0) { this.particles.splice(i, 1); continue; }
      q.x += q.vx * DT; q.y += q.vy * DT;
      q.vx *= q.drag; q.vy *= q.drag;
      if (q.rotV) q.rot += q.rotV * DT;
    }
  }

  impact(x, y, w, shooter) {
    const g = this.game;
    const r = (w.splash || 10);
    this.explosion(x, y, r <= 13 ? 0.55 : 0.75);
    g.audio.sfx(r > 14 ? 'boom' : 'hit', { x, y });
    // splash damage with falloff
    const seen = new Set();
    g.eachEntityNear(x, y, r + 26, e => {
      if (e.hp <= 0 || seen.has(e.id)) return;
      seen.add(e.id);
      const rr = e.isBuilding ? Math.max(e.fw, e.fh) * TILE * 0.5 : (e.d.r || 6);
      const d = Math.max(0, dist(x, y, e.x, e.y) - rr);
      if (d > r) return;
      const fall = 1 - 0.55 * (d / r);
      this.applyDamage(e, w.dmg * (w.vs[e.armorClass()] ?? 1) * fall, shooter);
    });
    if (g.rng() < 0.3) g.addDecal(x, y);
  }

  applyDamage(e, amount, attacker) {
    if (!e || e.hp <= 0 || amount <= 0) return;
    e.takeDamage(amount, attacker);
  }

  // ---------- particles ----------
  add(p) {
    if (this.particles.length > 950 && p.priority !== 1) return;
    this.particles.push(p);
  }

  muzzle(x, y, ang, big) {
    this.add({
      type: 'flash', x: x + Math.cos(ang) * 4, y: y + Math.sin(ang) * 4,
      vx: 0, vy: 0, life: 0.06, maxLife: 0.06, size: big ? 9 : 6, drag: 1, rot: ang, priority: 1,
    });
  }

  spark(x, y, n) {
    const g = this.game;
    for (let i = 0; i < n; i++) {
      const a = g.rng() * Math.PI * 2, s = 40 + g.rng() * 90;
      this.add({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.18 + g.rng() * 0.12, maxLife: 0.3, size: 2, drag: 0.9 });
    }
  }

  puff(x, y, type, size, life) {
    const g = this.game;
    this.add({
      type, x: x + (g.rng() - .5) * 4, y: y + (g.rng() - .5) * 4,
      vx: (g.rng() - .5) * 12, vy: (g.rng() - .5) * 12 - (type === 'smoke' ? 9 : 0),
      life: life * (0.8 + g.rng() * 0.4), maxLife: life, size, drag: 0.985,
    });
  }

  dust(x, y) { this.puff(x, y, 'dust', 5, 0.8); }

  explosion(x, y, scale = 1) {
    const g = this.game;
    this.add({ type: 'flash', x, y, vx: 0, vy: 0, life: 0.09, maxLife: 0.09, size: 26 * scale, drag: 1, priority: 1 });
    this.add({ type: 'ring', x, y, vx: 0, vy: 0, life: 0.34, maxLife: 0.34, size: 30 * scale, drag: 1, priority: 1 });
    const nf = Math.round(7 * scale), ns = Math.round(6 * scale), nd = Math.round(5 * scale);
    for (let i = 0; i < nf; i++) {
      const a = g.rng() * Math.PI * 2, s = g.rng() * 55 * scale;
      this.add({ type: 'fire', x: x + (g.rng() - .5) * 8, y: y + (g.rng() - .5) * 8, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + g.rng() * 0.3, maxLife: 0.6, size: (5 + g.rng() * 7) * scale, drag: 0.92 });
    }
    for (let i = 0; i < ns; i++) {
      const a = g.rng() * Math.PI * 2, s = 15 + g.rng() * 30;
      this.add({ type: 'smoke', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 14, life: 0.7 + g.rng() * 0.9, maxLife: 1.6, size: (7 + g.rng() * 8) * scale, drag: 0.96 });
    }
    for (let i = 0; i < nd; i++) {
      const a = g.rng() * Math.PI * 2, s = 70 + g.rng() * 160;
      this.add({ type: 'debris', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + g.rng() * 0.4, maxLife: 0.7, size: 2 + g.rng() * 2.5, drag: 0.87, rot: g.rng() * 7, rotV: (g.rng() - .5) * 20 });
    }
    g.shakeAdd(3.5 * scale);
  }

  // ---------- render ----------
  draw(ctx, cam) {
    const z = cam.zoom;
    // tracers
    ctx.save();
    ctx.lineCap = 'round';
    for (const t of this.tracers) {
      ctx.strokeStyle = 'rgba(255,236,160,0.9)';
      ctx.lineWidth = 1.6 * z;
      ctx.beginPath();
      ctx.moveTo((t.x0 - cam.x) * z, (t.y0 - cam.y) * z);
      ctx.lineTo((t.x1 - cam.x) * z, (t.y1 - cam.y) * z);
      ctx.stroke();
    }
    ctx.restore();

    // projectiles
    for (const p of this.projectiles) {
      const px = (p.x - cam.x) * z, py = (p.y - cam.y) * z;
      if (p.kind === 'shell') {
        const k = p.t / p.dur;
        const arc = Math.sin(k * Math.PI) * 10 * z;
        ctx.fillStyle = 'rgba(20,22,26,0.35)';
        ctx.beginPath(); ctx.ellipse(px, py, 2.6 * z, 1.6 * z, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#2b2f36';
        ctx.beginPath(); ctx.arc(px, py - arc, 2.2 * z, 0, 7); ctx.fill();
        ctx.fillStyle = '#ffd27a';
        ctx.beginPath(); ctx.arc(px, py - arc, 1.1 * z, 0, 7); ctx.fill();
      } else if (p.kind === 'rocket') {
        ctx.save();
        ctx.translate(px, py); ctx.rotate(p.ang);
        ctx.fillStyle = '#c9d2dc'; ctx.fillRect(-3 * z, -1.4 * z, 6 * z, 2.8 * z);
        ctx.fillStyle = '#ff9040'; ctx.fillRect(-5 * z, -1.1 * z, 2.4 * z, 2.2 * z);
        ctx.restore();
      }
    }

    // particles
    for (const q of this.particles) {
      const k = q.life / q.maxLife; // 1 -> 0
      const px = (q.x - cam.x) * z, py = (q.y - cam.y) * z;
      switch (q.type) {
        case 'flash': {
          ctx.globalCompositeOperation = 'lighter';
          const r = q.size * z * (1.3 - k * 0.3);
          ctx.globalAlpha = 0.9 * k + 0.1;
          ctx.drawImage(this.texFlash, px - r, py - r, r * 2, r * 2);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'fire': {
          ctx.globalCompositeOperation = 'lighter';
          const r = q.size * z * (0.5 + 0.5 * k);
          ctx.globalAlpha = 0.9 * k;
          ctx.drawImage(this.texFire, px - r, py - r, r * 2, r * 2);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'smoke': {
          const r = q.size * z * (1.6 - k * 0.9);
          ctx.fillStyle = `rgba(52,54,58,${0.34 * k})`;
          ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
          break;
        }
        case 'dust': {
          const r = q.size * z * (1.5 - k * 0.7);
          ctx.fillStyle = `rgba(150,132,96,${0.3 * k})`;
          ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
          break;
        }
        case 'spark': {
          ctx.strokeStyle = `rgba(255,220,120,${k})`;
          ctx.lineWidth = 1.2 * z;
          ctx.beginPath(); ctx.moveTo(px, py);
          ctx.lineTo(px - q.vx * 0.02 * z, py - q.vy * 0.02 * z); ctx.stroke();
          break;
        }
        case 'debris': {
          ctx.save();
          ctx.translate(px, py); ctx.rotate(q.rot || 0);
          ctx.fillStyle = `rgba(30,30,32,${k})`;
          ctx.fillRect(-q.size * z / 2, -q.size * z / 2, q.size * z, q.size * z);
          ctx.restore();
          break;
        }
        case 'ring': {
          const r = q.size * z * (1 - k) + 4;
          ctx.strokeStyle = `rgba(255,200,120,${0.7 * k})`;
          ctx.lineWidth = 2.2 * z * k + 0.4;
          ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.stroke();
          break;
        }
      }
    }
  }
}
