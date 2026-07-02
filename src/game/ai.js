// RED HORIZON — enemy commander: economy, base building, waves, defense.

import { TILE, DT, dist2, clamp } from '../engine/core.js';
import { UNITS, BUILDINGS, BUILD_TIME, ECON, ENEMY, PLAYER, pace } from './data.js';

export class AIController {
  constructor(game, diff) {
    this.g = game;
    // epic pace stretches the assault timetable
    this.diff = { ...diff, firstWave: diff.firstWave * pace().wave, waveEvery: diff.waveEvery * pace().wave };
    this.me = ENEMY;
    this.buildJob = null;          // {key, t, total}
    this.unitJobs = new Map();     // buildingId -> {key, t, total}
    this.waveT = diff.firstWave;
    this.waveNum = 0;
    this.defenseCooldown = 0;
    this.armyCap = 0;
    this.attackers = new Set();    // unit ids currently on attack duty
    this.harassT = diff.firstWave * 0.45;
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
    this.manageHarass();
    this.manageSuper();
  }

  // early-game buggy raids on the player's mining line
  manageHarass() {
    const g = this.g;
    this.harassT -= DT;
    if (this.harassT > 0) return;
    this.harassT = 175;
    const raiders = this.military().filter(u => u.key === 'buggy' && !this.attackers.has(u.id)).slice(0, 2);
    if (!raiders.length) return;
    const harv = g.units.find(u => u.owner === PLAYER && u.harv && u.hp > 0);
    const base = g.buildings.find(b => b.owner === PLAYER && b.hp > 0);
    const t = harv || base;
    if (!t) return;
    for (const u of raiders) {
      this.attackers.add(u.id);
      u.orderAttackMove(g, t.x + (g.rng() - .5) * 80, t.y + (g.rng() - .5) * 80);
    }
  }

  // fire the strategic missile as soon as it's charged
  manageSuper() {
    const g = this.g;
    if ((g.tick % 45) !== 0) return;
    for (const b of g.buildings) {
      if (b.owner !== this.me || b.key !== 'silo' || b.hp <= 0 || b.state !== 'active') continue;
      if ((b.chargeT || 0) < b.d.superweapon.charge) continue;
      // aim at the densest player building cluster (approx: conyard, else any)
      const targets = g.buildings.filter(x => x.owner === PLAYER && x.hp > 0);
      if (!targets.length) return;
      let best = targets[0], bs = -1;
      for (const t of targets) {
        let score = 0;
        for (const o of targets) if (dist2(t.x, t.y, o.x, o.y) < 150 * 150) score++;
        if (score > bs) { bs = score; best = t; }
      }
      g.launchNuke(b, best.x, best.y);
    }
  }

  countBld(key) { return this.g.buildings.filter(b => b.owner === this.me && b.key === key && b.hp > 0).length; }
  countUnit(key) { return this.g.units.filter(u => u.owner === this.me && u.key === key && u.hp > 0).length; }
  military() { return this.g.units.filter(u => u.owner === this.me && u.hp > 0 && !u.d.harvester && !u.d.builder); }
  builders() { return this.g.units.filter(u => u.owner === this.me && u.hp > 0 && u.d.builder); }
  sites() { return this.g.buildings.filter(b => b.owner === this.me && b.state === 'site' && !b.dead); }

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
    if (have('radar') && have('tesla') < 1 + (this.waveNum > 3 ? 1 : 0) && g.credits[this.me] > 2600) return 'tesla';
    if (have('radar') && have('repair') === 0 && g.credits[this.me] > 1600) return 'repair';
    if (have('radar') && have('silo') === 0 && this.waveNum >= 2 && g.credits[this.me] > 4200) return 'silo';
    return null;
  }

  manageBuild() {
    const g = this.g;
    if ((g.tick % 20) !== 0) return;
    const crews = this.builders();
    const sites = this.sites();
    // keep every site staffed; spread free crews across sites
    for (const s of sites) {
      const working = crews.filter(u => u.buildSite === s && u.state === 'build');
      if (working.length) continue;
      const free = crews.find(u => u.state === 'idle' || (u.state === 'build' && (!u.buildSite || u.buildSite.dead || u.buildSite.state !== 'site')));
      if (free) free.orderBuild(g, s, true);
    }
    // extra idle crews pile onto the most complete site for the speed bonus
    if (sites.length) {
      for (const u of crews) {
        if (u.state !== 'idle') continue;
        const target = sites.reduce((a, b) => (a.progress > b.progress ? a : b));
        u.orderBuild(g, target, true);
      }
    }
    if (sites.length >= 2) return;      // at most two concurrent projects
    if (!crews.length) return;          // manageUnits will train a new truck
    const want = this.desiredBuild();
    if (!want) return;
    const cost = BUILDINGS[want].cost;
    if (g.credits[this.me] >= cost * 0.35 * this.diff.income) {
      this.placeBuilding(want);
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
      const site = g.placeBuilding(key, bestSpot.cx, bestSpot.cy, this.me);
      const free = this.builders().find(u => u.state === 'idle')
        || this.builders().find(u => u.state !== 'build');
      if (free) free.orderBuild(g, site, true);
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
    if (hasRadar && count('artillery') < Math.max(1, (this.waveNum / 2) | 0) && g.credits[this.me] > 2800) return 'artillery';
    if (hasRadar && count('heavy') < 1 + this.waveNum / 3 && g.credits[this.me] > 2400) return 'heavy';
    if (count('tank') < 3 + this.waveNum) return 'tank';
    if (count('buggy') < 2) return 'buggy';
    return 'tank';
  }

  manageUnits() {
    // per-building queues: keep each factory fed with one item at a time
    const g = this.g;
    if ((g.tick % 10) !== 0) return;
    for (const b of g.buildings) {
      if (b.owner !== this.me || b.hp <= 0 || b.state !== 'active' || b.queue.length) continue;
      if (b.key === 'conyard') {
        if (this.builders().length < 2 && g.credits[this.me] >= UNITS.builder.cost * 0.5) b.enqueue(g, 'builder');
        continue;
      }
      if (!b.d.produces) continue;
      const want = this.desiredUnit(b.d.produces);
      if (want && g.credits[this.me] >= UNITS[want].cost * 0.4) b.enqueue(g, want);
    }
  }

  manageWave() {
    const g = this.g;
    this.waveT -= DT;
    const mil = this.military();
    // release surviving attackers that finished their push so they rejoin the pool
    if ((g.tick % 60) === 0) {
      for (const u of mil) {
        if (this.attackers.has(u.id) && u.state === 'idle') this.attackers.delete(u.id);
      }
    }
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
