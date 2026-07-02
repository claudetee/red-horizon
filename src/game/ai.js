// RED HORIZON — enemy commander: economy, base building, waves, defense.

import { TILE, DT, dist2, clamp } from '../engine/core.js';
import { UNITS, BUILDINGS, BUILD_TIME, ECON, ENEMY, PLAYER } from './data.js';

export class AIController {
  constructor(game, diff) {
    this.g = game;
    this.diff = diff;
    this.me = ENEMY;
    this.buildJob = null;          // {key, t, total}
    this.unitJobs = new Map();     // buildingId -> {key, t, total}
    this.waveT = diff.firstWave;
    this.waveNum = 0;
    this.defenseCooldown = 0;
    this.armyCap = 0;
    this.attackers = new Set();    // unit ids currently on attack duty
  }

  base() { return this.g.nearestBuilding(this.me, 'conyard', 0, 0) || this.g.buildings.find(b => b.owner === this.me); }

  update() {
    const g = this.g;
    g.credits[this.me] += this.diff.trickle * DT;
    if (this.defenseCooldown > 0) this.defenseCooldown -= DT;

    if ((g.tick % 15) === 0) this.manageEcon();
    this.manageBuild();
    this.manageUnits();
    this.manageWave();
  }

  countBld(key) { return this.g.buildings.filter(b => b.owner === this.me && b.key === key && b.hp > 0).length; }
  countUnit(key) { return this.g.units.filter(u => u.owner === this.me && u.key === key && u.hp > 0).length; }
  military() { return this.g.units.filter(u => u.owner === this.me && u.hp > 0 && !u.d.harvester); }

  manageEcon() {
    for (const u of this.g.units) {
      if (u.owner !== this.me || !u.harv || u.hp <= 0) continue;
      if (u.state === 'idle' || (u.state === 'harvest' && u.harv.phase === 'idle')) {
        const c = this.g.map.findOreNear((u.x / TILE) | 0, (u.y / TILE) | 0);
        if (c) u.orderHarvest(this.g, c.cx, c.cy);
      }
    }
  }

  desiredBuild() {
    const g = this.g;
    const pow = g.power[this.me];
    const have = k => this.countBld(k);
    if (!have('conyard')) return null; // can't build without conyard
    if (have('power') === 0) return 'power';
    if (pow.out - pow.use < 15 && g.credits[this.me] >= 300) return 'power';
    if (have('refinery') === 0) return 'refinery';
    if (have('barracks') === 0) return 'barracks';
    if (have('factory') === 0) return 'factory';
    if (have('refinery') < 2 && g.credits[this.me] > 2200) return 'refinery';
    if (have('turret') < 2 + Math.min(3, this.waveNum) && g.credits[this.me] > 1100) return 'turret';
    if (have('radar') === 0 && g.credits[this.me] > 2000) return 'radar';
    if (have('power') < 2 + ((have('refinery') + have('factory') + have('radar')) / 2 | 0) && pow.out - pow.use < 40) return 'power';
    return null;
  }

  manageBuild() {
    const g = this.g;
    if (this.buildJob) {
      const j = this.buildJob;
      const lowPow = g.power[this.me].out < g.power[this.me].use;
      j.t += DT * (lowPow ? ECON.lowPowerBuildFactor : 1) * this.diff.income;
      if (j.t >= j.total) {
        this.buildJob = null;
        this.placeBuilding(j.key);
      }
      return;
    }
    const want = this.desiredBuild();
    if (!want) return;
    const cost = BUILDINGS[want].cost;
    if (g.credits[this.me] >= cost) {
      g.credits[this.me] -= cost;
      this.buildJob = { key: want, t: 0, total: BUILD_TIME(cost) };
    }
  }

  placeBuilding(key) {
    const g = this.g;
    const base = this.base();
    if (!base) return;
    const d = BUILDINGS[key];
    // turrets bias toward the player approach; others spiral around base
    const px = g.map.starts[0].cx, py = g.map.starts[0].cy;
    const bx = (base.x / TILE) | 0, by = (base.y / TILE) | 0;
    let bestSpot = null, bestScore = Infinity;
    for (let r = 2; r <= 14 && !bestSpot; r += 1) {
      for (let a = 0; a < 26; a++) {
        const ang = (a / 26) * Math.PI * 2;
        const cx = Math.round(bx + Math.cos(ang) * r) - (d.fw >> 1);
        const cy = Math.round(by + Math.sin(ang) * r) - (d.fh >> 1);
        if (!g.canPlace(key, cx, cy, this.me)) continue;
        let score = Math.random() * 3;
        if (key === 'turret') {
          // closer to player side = better
          score = dist2(cx, cy, px, py) / 100 + Math.random() * 8;
        }
        if (score < bestScore) { bestScore = score; bestSpot = { cx, cy }; }
      }
      if (key === 'turret' && bestSpot) break;
    }
    if (bestSpot) {
      g.placeBuilding(key, bestSpot.cx, bestSpot.cy, this.me);
    } else {
      // refund if nowhere to put it
      g.credits[this.me] += BUILDINGS[key].cost * 0.9;
    }
  }

  desiredUnit(prodKind) {
    const g = this.g;
    const mil = this.military();
    const cap = Math.round((14 + this.waveNum * 3) * this.diff.waveScale);
    if (prodKind === 'veh' && this.countUnit('harvester') < this.countBld('refinery')) return 'harvester';
    if (mil.length >= cap) return null;
    const count = k => mil.filter(u => u.key === k).length;
    if (prodKind === 'inf') {
      return (count('rifle') <= count('rocket') * 1.6) ? 'rifle' : 'rocket';
    }
    // vehicles
    const hasRadar = this.countBld('radar') > 0;
    if (hasRadar && count('heavy') < 1 + this.waveNum / 3 && g.credits[this.me] > 2400) return 'heavy';
    if (count('tank') < 3 + this.waveNum) return 'tank';
    if (count('buggy') < 2) return 'buggy';
    return 'tank';
  }

  manageUnits() {
    const g = this.g;
    for (const b of g.buildings) {
      if (b.owner !== this.me || b.hp <= 0 || b.state !== 'active' || !b.d.produces) continue;
      let job = this.unitJobs.get(b.id);
      if (job) {
        const lowPow = g.power[this.me].out < g.power[this.me].use;
        job.t += DT * (lowPow ? ECON.lowPowerBuildFactor : 1) * this.diff.income;
        if (job.t >= job.total) {
          this.unitJobs.delete(b.id);
          g.spawnUnitFromFactory(b, job.key);
        }
        continue;
      }
      const want = this.desiredUnit(b.d.produces);
      if (!want) continue;
      const cost = UNITS[want].cost;
      if (g.credits[this.me] >= cost) {
        g.credits[this.me] -= cost;
        this.unitJobs.set(b.id, { key: want, t: 0, total: BUILD_TIME(cost) });
      }
    }
  }

  manageWave() {
    const g = this.g;
    this.waveT -= DT;
    const mil = this.military();
    // rally fresh units near base front
    if ((g.tick % 45) === 0) {
      const base = this.base();
      if (base) {
        for (const u of mil) {
          if (this.attackers.has(u.id) || u.state !== 'idle') continue;
          const rp = { x: base.x + (g.rng() - .3) * 150, y: base.y + 130 + g.rng() * 60 };
          if (dist2(u.x, u.y, rp.x, rp.y) > 220 * 220) u.orderMove(g, rp.x, rp.y, true);
        }
      }
    }
    if (this.waveT > 0) return;
    const need = Math.max(4, Math.round((5 + this.waveNum * 2.5) * this.diff.waveScale));
    const free = mil.filter(u => !this.attackers.has(u.id));
    if (free.length < need) { this.waveT = 20; return; } // check again soon
    this.waveNum++;
    this.waveT = this.diff.waveEvery;
    // send the wave: strike harvesters first sometimes, else base
    const targetBase = g.buildings.filter(b => b.owner === PLAYER && b.hp > 0);
    const harvs = g.units.filter(u => u.owner === PLAYER && u.harv && u.hp > 0);
    let tx, ty;
    if (harvs.length && g.rng() < 0.35) { tx = harvs[0].x; ty = harvs[0].y; }
    else if (targetBase.length) {
      const t = targetBase[(g.rng() * targetBase.length) | 0];
      tx = t.x; ty = t.y;
    } else return;
    const squad = free.slice(0, Math.max(need, Math.min(free.length, need * 2)));
    for (const u of squad) {
      this.attackers.add(u.id);
      u.orderAttackMove(g, tx + (g.rng() - .5) * 90, ty + (g.rng() - .5) * 90);
    }
    if (g.fog.isExploredPx(this.base()?.x ?? 0, this.base()?.y ?? 0)) g.eva('enemySighted');
  }

  notifyDamage(victim, attacker) {
    if (!attacker || attacker.owner === this.me) return;
    if (this.defenseCooldown > 0) return;
    this.defenseCooldown = 4;
    const g = this.g;
    // defenders: idle military near base rush the attacker
    let n = 0;
    for (const u of this.military()) {
      if (this.attackers.has(u.id)) continue;
      if (u.state === 'idle' || u.state === 'move') {
        u.orderAttack(g, attacker);
        if (++n >= 8) break;
      }
    }
  }

  notifyUnitDied(u) {
    this.attackers.delete(u.id);
  }
}
