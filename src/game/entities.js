// RED HORIZON — Unit & Building entities: movement FSM, combat behavior, harvesting, buildup.

import { TILE, DT, dist, dist2, angDiff, turnToward, clamp, lerp } from '../engine/core.js';
import { sprTeam, spr, pivotOf } from '../engine/assets.js';
import { UNITS, BUILDINGS, WEAPONS, ECON, BUILD_TIME, PLAYER, TEAM_COLORS } from './data.js';

let NEXT_ID = 1;
export const resetIds = () => { NEXT_ID = 1; };

// RA2-style segmented health bar
function drawSegBar(ctx, bx, by, bw, bh, frac) {
  ctx.fillStyle = 'rgba(6,8,10,0.85)';
  ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
  const seg = 5, gap = 1;
  const n = Math.max(3, Math.floor(bw / (seg + gap)));
  const lit = Math.ceil(frac * n - 0.001);
  const col = frac > 0.5 ? '#35e85f' : frac > 0.25 ? '#e8c22e' : '#f24d3a';
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i < lit ? col : '#232a1a';
    ctx.fillRect(bx + i * (seg + gap), by, seg, bh);
  }
}

// ============================== UNIT ==============================

export class Unit {
  constructor(key, owner, x, y) {
    this.id = NEXT_ID++;
    this.key = key;
    this.d = UNITS[key];
    this.w = this.d.weapon ? WEAPONS[this.d.weapon] : null;
    this.owner = owner;
    this.x = x; this.y = y; this.prevX = x; this.prevY = y;
    this.hp = this.d.hp; this.maxHp = this.d.hp;
    this.heading = owner === PLAYER ? -Math.PI / 2 : Math.PI / 2;
    this.turret = this.d.turretSprite ? { ang: this.heading, recoil: 0 } : null;
    this.state = 'idle';
    this.path = null; this.pathIdx = 0; this.destX = x; this.destY = y;
    this.target = null;
    this.amPos = null;          // attack-move destination
    this.guardMode = false;
    this.cool = 0; this.burstLeft = 0; this.burstT = 0;
    this.flash = 0;
    this.stuckT = 0; this.lastProg = 0; this.repathT = 0;
    this.speedJit = 0.94 + ((this.id * 37) % 13) / 100;
    this.harv = this.d.harvester ? { phase: 'idle', load: 0, cell: null, refinery: null, t: 0 } : null;
    this.isBuilding = false;
    this.pendingPath = false;
    this.wanderT = 0;
    this.kills = 0;
    this.rank = 0;
    this.skillCd = 0;
    this.skillT = 0;       // active skill remaining (sprint)
    this.deployed = false; // rocketeer siege stance
  }

  useSkill(g) {
    const sk = this.d.skill;
    if (!sk) return false;
    if (sk.toggle) {
      this.deployed = !this.deployed;
      if (this.deployed) { this.path = null; this.state = this.target ? 'attack' : 'idle'; }
      g.combat.puff(this.x, this.y, 'dust', 4, 0.5);
      return true;
    }
    if (this.skillCd > 0) return false;
    this.skillCd = sk.cd;
    this.skillT = sk.dur;
    g.audio.sfx('rocket', { x: this.x, y: this.y, vol: 0.4 });
    return true;
  }

  armorClass() { return this.d.armor; }
  get selRadius() { return this.d.r + 6; }

  // -------- orders --------
  orderMove(g, x, y, silent) {
    this.state = 'move'; this.target = null; this.amPos = null; this.guardMode = false;
    this.resumeAM = null; this.attackAnchor = null;
    this.deployed = false;   // moving breaks siege stance
    this.requestPathTo(g, x, y);
    if (!silent && this.owner === PLAYER) g.audio.ack();
  }
  orderAttack(g, t) {
    this.state = 'attack'; this.target = t; this.amPos = null;
    this.resumeAM = null;
    this.attackAnchor = { x: this.x, y: this.y };
    this.path = null; this.repathT = 0;
    if (this.owner === PLAYER) g.audio.ack(true);
  }
  orderAttackMove(g, x, y) {
    this.state = 'attackMove'; this.amPos = { x, y }; this.target = null; this.guardMode = false;
    this.resumeAM = null; this.attackAnchor = null;
    this.requestPathTo(g, x, y);
    if (this.owner === PLAYER) g.audio.ack(true);
  }
  orderStop(g) {
    this.state = 'idle'; this.path = null; this.target = null; this.amPos = null;
    this.resumeAM = null; this.attackAnchor = null;
    if (this.harv) this.harv.phase = 'idle';
  }
  orderGuard() {
    this.guardMode = true; this.state = 'idle'; this.path = null; this.target = null;
    this.resumeAM = null; this.attackAnchor = { x: this.x, y: this.y };
  }
  orderHarvest(g, cx, cy) {
    if (!this.harv) return;
    this.state = 'harvest';
    this.harv.phase = 'toOre';
    this.harv.cell = { cx, cy };
    this.requestPathTo(g, cx * TILE + 16, cy * TILE + 16);
    if (this.owner === PLAYER) g.audio.ack();
  }
  orderBuild(g, site, silent) {
    if (!this.d.builder || !site || site.dead) return;
    this.state = 'build';
    this.buildSite = site;
    this.target = null; this.amPos = null; this.resumeAM = null; this.guardMode = false;
    const dp = site.dockPoint();
    this.requestPathTo(g, dp.x, dp.y);
    if (!silent && this.owner === PLAYER) g.audio.ack();
  }

  requestPathTo(g, x, y) {
    this.destX = x; this.destY = y;
    this.pendingPath = true;
    const scx = clamp((this.x / TILE) | 0, 0, g.map.w - 1), scy = clamp((this.y / TILE) | 0, 0, g.map.h - 1);
    const tcx = clamp((x / TILE) | 0, 0, g.map.w - 1), tcy = clamp((y / TILE) | 0, 0, g.map.h - 1);
    g.pathfinder.request(scx, scy, tcx, tcy, p => {
      this.pendingPath = false;
      this.path = p; this.pathIdx = 0;
      this.stuckT = 0;
    });
  }

  // -------- per-tick update --------
  update(g) {
    if (this.hp <= 0 || this.dead) return;
    this.prevX = this.x; this.prevY = this.y;
    if (this.flash > 0) this.flash -= DT;
    if (this.cool > 0) this.cool -= DT;
    if (this.turret && this.turret.recoil > 0) this.turret.recoil -= 14 * DT;

    // burst continuation (re-check range before releasing the leftover shot)
    if (this.burstLeft > 0) {
      this.burstT -= DT;
      if (this.burstT <= 0) {
        const t = this.target;
        if (t && t.hp > 0 && this.w && dist(this.x, this.y, t.x, t.y) <= this.w.range * TILE * 1.35) {
          this.fireAt(g, t);
        } else this.burstLeft = 0;
      }
    }

    // heavy damage smoke trail
    if (this.hp < this.maxHp * 0.42 && this.d.kind !== 'inf' && ((g.tick + this.id) % 18) === 0) {
      g.combat.puff(this.x, this.y, 'smoke', 4, 1.0);
    }

    // skills
    if (this.skillCd > 0) this.skillCd -= DT;
    if (this.skillT > 0) {
      this.skillT -= DT;
      if ((g.tick & 1) === 0) g.combat.puff(this.x - Math.cos(this.heading) * this.d.r, this.y - Math.sin(this.heading) * this.d.r, 'fire', 2.4, 0.28);
    }
    // mammoth passive self-repair
    if (this.d.selfRepair && this.hp > 0 && this.hp < this.maxHp * this.d.selfRepair.below) {
      this.hp = Math.min(this.maxHp * this.d.selfRepair.below, this.hp + this.d.selfRepair.rate * DT);
    }

    switch (this.state) {
      case 'move':
        if (this.moveAlong(g)) this.state = 'idle';
        break;
      case 'attackMove': {
        this.acquireMaybe(g, true);
        if (this.state === 'attackMove' && this.moveAlong(g)) this.state = 'idle';
        break;
      }
      case 'attack': this.updateAttack(g); break;
      case 'harvest': this.updateHarvest(g); break;
      case 'build': this.updateBuild(g); break;
      case 'idle':
      default:
        this.acquireMaybe(g, false);
        break;
    }
  }

  acquireMaybe(g, chasing) {
    if (!this.w) return;
    if ((g.tick + this.id) % 9 !== 0) return;
    const range = Math.max(this.d.sight * TILE, this.w.range * TILE * 1.15);
    const t = g.findNearestEnemy(this.owner, this.x, this.y, range);
    if (t) {
      if (this.state === 'attackMove') this.resumeAM = { x: this.destX, y: this.destY };
      this.state = 'attack'; this.target = t;
    }
  }

  updateAttack(g) {
    const t = this.target;
    if (!t || t.hp <= 0 || t.dead) {
      this.target = null;
      if (this.resumeAM) {
        const r = this.resumeAM; this.resumeAM = null;
        this.orderAttackMove(g, r.x, r.y);
      } else this.state = 'idle';
      return;
    }
    // drop targets that slipped into the fog (player units don't wallhack)
    if (this.owner === PLAYER && !t.isBuilding && !g.fog.isVisiblePx(t.x, t.y)) {
      this.target = null;
      if (this.resumeAM) { const r = this.resumeAM; this.resumeAM = null; this.orderAttackMove(g, r.x, r.y); }
      else this.state = 'idle';
      return;
    }
    const rr = t.isBuilding ? Math.max(t.fw, t.fh) * TILE * 0.42 : 0;
    const rangePx = (this.w.range + (this.deployed ? this.d.skill.rangeBonus : 0)) * TILE + rr;
    const d = dist(this.x, this.y, t.x, t.y);
    if (d > rangePx) {
      if (this.deployed) { this.target = null; return; }  // siege stance holds ground
      if (this.guardMode) {
        // guards don't chase — and drop unreachable locks so they stay responsive
        this.target = null;
        return;
      }
      // chase leash: don't cross the map after one buggy
      if (this.attackAnchor && dist(this.attackAnchor.x, this.attackAnchor.y, this.x, this.y) > 10 * TILE) {
        this.target = null; this.attackAnchor = null; this.state = 'idle';
        this.path = null;
        return;
      }
      this.repathT -= DT;
      if (this.repathT <= 0) {
        this.requestPathTo(g, t.x, t.y);
        this.repathT = 0.8;
      }
      this.moveAlong(g);
      return;
    }
    // in range: stop & aim
    this.path = null;
    const want = Math.atan2(t.y - this.y, t.x - this.x);
    let aligned;
    if (this.turret) {
      this.turret.ang = turnToward(this.turret.ang, want, (this.d.turretTurn || 4) * DT);
      aligned = Math.abs(angDiff(this.turret.ang, want)) < 0.13;
      // hull creeps around to face target too (slow, feels weighty)
      this.heading = turnToward(this.heading, want, this.d.turn * 0.4 * DT);
    } else {
      this.heading = turnToward(this.heading, want, this.d.turn * DT);
      aligned = Math.abs(angDiff(this.heading, want)) < 0.16;
    }
    if (aligned && this.cool <= 0 && this.burstLeft === 0) {
      this.burstLeft = this.w.burst;
      this.fireAt(g, t);
    }
  }

  fireAt(g, t) {
    const ang = this.turret ? this.turret.ang : this.heading;
    const barrel = this.turret ? this.d.r + 10 : this.d.r + 3;
    const sx = this.x + Math.cos(ang) * barrel;
    const sy = this.y + Math.sin(ang) * barrel;
    g.combat.fire(this, this.w, sx, sy, t);
    if (this.turret) this.turret.recoil = 2.6;
    this.burstLeft--;
    if (this.burstLeft > 0) this.burstT = this.w.burstGap || 0.15;
    else this.cool = this.w.rof;
  }

  // returns true when path finished
  moveAlong(g) {
    if (this.pendingPath) return false;
    if (!this.path || this.pathIdx >= this.path.length) {
      // if the exact destination sits on blocked ground (click on a building/water),
      // the end of the path IS the arrival — never wall-hug toward it
      const dcx = clamp((this.destX / TILE) | 0, 0, g.map.w - 1);
      const dcy = clamp((this.destY / TILE) | 0, 0, g.map.h - 1);
      if (!g.map.isPassable(dcx, dcy)) { this.path = null; return true; }
      // final approach to exact dest point; give up if the way is physically blocked
      const d = dist(this.x, this.y, this.destX, this.destY);
      if (d > 6 && this.path) {
        const moved = this.stepToward(g, this.destX, this.destY);
        if (!moved) { this.path = null; return true; }
        return false;
      }
      this.path = null;
      return true;
    }
    const wp = this.path[this.pathIdx];
    const wx = wp[0] * TILE + 16, wy = wp[1] * TILE + 16;
    this.stepToward(g, wx, wy);
    const arrive = Math.max(9, this.d.speed * DT * 2.2);
    if (dist(this.x, this.y, wx, wy) < arrive) this.pathIdx++;
    // stuck detection
    this.stuckT += DT;
    if (this.stuckT > 0.9) {
      const prog = dist(this.x, this.y, this.lastSX ?? this.x, this.lastSY ?? this.y);
      if (prog < this.d.speed * 0.2) {
        this.requestPathTo(g, this.destX, this.destY);
      }
      this.stuckT = 0; this.lastSX = this.x; this.lastSY = this.y;
    }
    return false;
  }

  stepToward(g, wx, wy) {
    const want = Math.atan2(wy - this.y, wx - this.x);
    this.heading = turnToward(this.heading, want, this.d.turn * DT);
    if (this.turret && !this.target) {
      this.turret.ang = turnToward(this.turret.ang, this.heading, (this.d.turretTurn || 4) * 0.7 * DT);
    }
    const align = Math.cos(angDiff(this.heading, want));
    const f = this.d.kind === 'inf' ? 1 : Math.max(0.22, align);
    if (align > -0.2) {
      const boost = this.skillT > 0 && this.d.skill && this.d.skill.speedMul ? this.d.skill.speedMul : 1;
      const step = this.d.speed * this.speedJit * f * boost * DT;
      const nx = this.x + Math.cos(this.heading) * step;
      const ny = this.y + Math.sin(this.heading) * step;
      const moved = this.tryMove(g, nx, ny);
      if (moved && this.d.kind !== 'inf') {
        if ((g.tick & 7) === 0 && g.rng() < 0.3) g.combat.dust(this.x - Math.cos(this.heading) * this.d.r, this.y - Math.sin(this.heading) * this.d.r);
        // tread marks
        if (((g.tick + this.id) % 5) === 0) g.addTrack(this.x - Math.cos(this.heading) * this.d.r * 0.5, this.y - Math.sin(this.heading) * this.d.r * 0.5, this.heading, this.d.r);
      }
      return moved;
    }
    return true; // still rotating toward heading — counts as progress
  }

  tryMove(g, nx, ny) {
    const m = g.map;
    // escape rule: if we're standing inside a blocked cell (e.g. just left the factory
    // door), any movement is allowed so we can walk out instead of being trapped.
    const ccx = clamp((this.x / TILE) | 0, 0, m.w - 1), ccy = clamp((this.y / TILE) | 0, 0, m.h - 1);
    if (!m.isPassable(ccx, ccy)) { this.x = nx; this.y = ny; return true; }
    const cx = clamp((nx / TILE) | 0, 0, m.w - 1), cy = clamp((ny / TILE) | 0, 0, m.h - 1);
    if (m.isPassable(cx, cy)) { this.x = nx; this.y = ny; return true; }
    // slide along axes
    const cx2 = clamp((nx / TILE) | 0, 0, m.w - 1), cyKeep = clamp((this.y / TILE) | 0, 0, m.h - 1);
    if (m.isPassable(cx2, cyKeep)) { this.x = nx; return true; }
    const cxKeep = clamp((this.x / TILE) | 0, 0, m.w - 1), cy2 = clamp((ny / TILE) | 0, 0, m.h - 1);
    if (m.isPassable(cxKeep, cy2)) { this.y = ny; return true; }
    return false;
  }

  // -------- harvesting --------
  updateHarvest(g) {
    const hv = this.harv;
    const m = g.map;
    switch (hv.phase) {
      case 'idle': {
        // auto-find ore
        const c = m.findOreNear((this.x / TILE) | 0, (this.y / TILE) | 0);
        if (c) { hv.phase = 'toOre'; hv.cell = c; this.requestPathTo(g, c.cx * TILE + 16, c.cy * TILE + 16); }
        else { this.state = 'idle'; if (this.owner === PLAYER) g.eva('needMoreOre'); }
        break;
      }
      case 'toOre': {
        if (this.moveAlong(g)) {
          const cx = (this.x / TILE) | 0, cy = (this.y / TILE) | 0;
          if (m.ore[cy * m.w + cx] > 0) { hv.phase = 'mining'; hv.mineCell = { cx, cy }; }
          else {
            const c = m.findOreNear(cx, cy, 8) || m.findOreNear(cx, cy, 40);
            if (c) { hv.cell = c; this.requestPathTo(g, c.cx * TILE + 16, c.cy * TILE + 16); }
            else { hv.phase = 'idle'; }
          }
        }
        break;
      }
      case 'mining': {
        const mc = hv.mineCell;
        const got = m.takeOre(mc.cx, mc.cy, ECON.harvestRate * DT);
        hv.load += got;
        if ((g.tick & 5) === 0) g.combat.dust(this.x + (g.rng() - .5) * 14, this.y + (g.rng() - .5) * 14);
        if ((g.tick % 22) === 0) g.audio.sfx('mine', { x: this.x, y: this.y, vol: 0.4 });
        if (hv.load >= ECON.harvestCapacity) { this.goUnload(g); break; }
        if (got <= 0) {
          const c = m.findOreNear(mc.cx, mc.cy, 6);
          if (c && m.ore[c.cy * m.w + c.cx] > 0) {
            hv.phase = 'toOre'; hv.cell = c;
            this.requestPathTo(g, c.cx * TILE + 16, c.cy * TILE + 16);
          } else if (hv.load > 60) this.goUnload(g);
          else {
            const c2 = m.findOreNear(mc.cx, mc.cy, 40);
            if (c2) { hv.phase = 'toOre'; hv.cell = c2; this.requestPathTo(g, c2.cx * TILE + 16, c2.cy * TILE + 16); }
            else { hv.phase = 'idle'; this.state = 'idle'; if (this.owner === PLAYER) g.eva('needMoreOre'); }
          }
        }
        break;
      }
      case 'toRefinery': {
        const ref = hv.refinery;
        if (!ref || ref.hp <= 0) { this.goUnload(g); break; }
        if (this.moveAlong(g)) {
          hv.phase = 'unloading'; hv.t = ECON.unloadTime;
          this.heading = turnToward(this.heading, -Math.PI / 2, 99);
        }
        break;
      }
      case 'unloading': {
        const ref = hv.refinery;
        if (!ref || ref.hp <= 0) { this.goUnload(g); break; }
        hv.t -= DT;
        if ((g.tick & 3) === 0) {
          g.combat.add({ type: 'spark', x: ref.x + (g.rng() - .5) * 20, y: ref.y + (g.rng() - .5) * 16, vx: 0, vy: -22, life: 0.3, maxLife: 0.3, size: 2, drag: 1 });
        }
        if (hv.t <= 0) {
          g.addCredits(this.owner, hv.load);
          if (this.owner === PLAYER) g.audio.sfx('cash');
          g.stats[this.owner].mined += hv.load;
          hv.load = 0;
          hv.phase = 'toOre';
          const c = hv.cell && m.ore[hv.cell.cy * m.w + hv.cell.cx] > 0 ? hv.cell : m.findOreNear((this.x / TILE) | 0, (this.y / TILE) | 0);
          if (c) { hv.cell = c; this.requestPathTo(g, c.cx * TILE + 16, c.cy * TILE + 16); }
          else hv.phase = 'idle';
        }
        break;
      }
    }
  }

  // -------- construction / repair (engineer trucks) --------
  updateBuild(g) {
    const s = this.buildSite;
    const invalid = !s || s.dead || (s.state !== 'site' && s.hp >= s.maxHp);
    if (invalid) {
      this.buildSite = null;
      // auto-continue on a nearby unfinished site
      let best = null, bd = Infinity;
      for (const b of g.buildings) {
        if (b.owner !== this.owner || b.state !== 'site' || b.dead) continue;
        const d2v = dist2(this.x, this.y, b.x, b.y);
        if (d2v < bd && d2v < (9 * TILE) ** 2) { bd = d2v; best = b; }
      }
      if (best) { this.orderBuild(g, best, true); return; }
      this.state = 'idle';
      return;
    }
    const reach = Math.max(s.fw, s.fh) * TILE * 0.5 + ECON.buildReach;
    const d = dist(this.x, this.y, s.x, s.y);
    if (d > reach) {
      this.repathT -= DT;
      if ((!this.path && !this.pendingPath) || this.repathT <= 0) {
        const dp = s.dockPoint();
        this.requestPathTo(g, dp.x, dp.y);
        this.repathT = 1.2;
      }
      this.moveAlong(g);
      return;
    }
    // on site: work
    this.path = null;
    const want = Math.atan2(s.y - this.y, s.x - this.x);
    this.heading = turnToward(this.heading, want, this.d.turn * DT);
    if (s.state === 'site') {
      s.buildersNow++;
      if ((g.tick + this.id) % 8 === 0) {
        g.combat.spark(s.x + (g.rng() - .5) * s.fw * TILE * 0.6, s.y + (g.rng() - .5) * s.fh * TILE * 0.5, 2);
      }
      if ((g.tick + this.id) % 34 === 0) g.audio.sfx('mine', { x: this.x, y: this.y, vol: 0.35 });
    } else if (s.hp < s.maxHp) {
      // field repair: same wrench economy as repair mode
      const cost = (s.d.cost * ECON.repairCostFactor / s.maxHp) * ECON.repairRate * DT;
      if (g.credits[this.owner] >= cost) {
        g.credits[this.owner] -= cost;
        s.hp = Math.min(s.maxHp, s.hp + ECON.repairRate * DT);
        if ((g.tick + this.id) % 10 === 0) g.combat.spark(s.x + (g.rng() - .5) * 30, s.y + (g.rng() - .5) * 24, 1);
      }
    }
  }

  goUnload(g) {
    const hv = this.harv;
    const ref = g.nearestBuilding(this.owner, 'refinery', this.x, this.y);
    if (!ref) { hv.phase = 'idle'; this.state = 'idle'; if (this.owner === PLAYER && (g.tick % 90 === 0)) g.eva('needMoreOre'); return; }
    hv.refinery = ref;
    hv.phase = 'toRefinery';
    const dock = ref.dockPoint();
    this.requestPathTo(g, dock.x, dock.y);
  }

  // -------- damage / death --------
  takeDamage(amount, attacker) {
    this.hp -= amount;
    this.flash = 0.09;
    const g = window.__game;
    if (this.hp <= 0) { this.die(g, attacker); return; }
    g.onDamaged(this, attacker);
    // retaliate
    if (this.w && !this.target && attacker && attacker.hp > 0 && this.state === 'idle' && attacker.owner !== this.owner) {
      this.state = 'attack'; this.target = attacker;
    }
  }

  die(g, attacker) {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    const scale = this.d.kind === 'inf' ? 0.35 : clamp(this.d.r / 12, 0.6, 1.3);
    g.combat.explosion(this.x, this.y, scale);
    g.audio.sfx(this.d.kind === 'inf' ? 'die_inf' : 'boom', { x: this.x, y: this.y });
    if (this.d.kind !== 'inf') g.addHusk(this);
    g.onEntityDied(this, attacker);
  }

  // -------- draw --------
  draw(ctx, cam, g) {
    const z = cam.zoom;
    const rx = lerp(this.prevX, this.x, g.alpha), ry = lerp(this.prevY, this.y, g.alpha);
    const px = (rx - cam.x) * z, py = (ry - cam.y) * z;
    const img = sprTeam(this.d.sprite, this.owner);
    if (!img) return;

    // soft shadow
    ctx.fillStyle = 'rgba(10,12,14,0.30)';
    ctx.beginPath();
    ctx.ellipse(px + 2 * z, py + 3 * z, this.d.r * 1.05 * z, this.d.r * 0.7 * z, 0, 0, 7);
    ctx.fill();

    // infantry bob while marching
    let bobY = 0, bobR = 0;
    if (this.d.kind === 'inf' && this.path && this.pathIdx < (this.path.length || 0)) {
      bobY = Math.sin(g.time * 13 + this.id * 1.7) * 0.9 * z;
      bobR = Math.sin(g.time * 6.5 + this.id) * 0.06;
    }
    ctx.save();
    ctx.translate(px, py + bobY);
    ctx.rotate(this.heading + Math.PI / 2 + bobR);
    ctx.imageSmoothingEnabled = z % 1 !== 0;
    if (this.flash > 0) ctx.filter = 'brightness(2.2) saturate(0.6)';
    ctx.drawImage(img, -img.width * z / 2, -img.height * z / 2, img.width * z, img.height * z);
    ctx.restore();

    // turret
    if (this.turret) {
      const timg = sprTeam(this.d.turretSprite, this.owner);
      const pv = pivotOf(this.d.turretSprite);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(this.turret.ang + Math.PI / 2);
      const rec = Math.max(0, this.turret.recoil) * z;
      if (this.flash > 0) ctx.filter = 'brightness(2.2) saturate(0.6)';
      ctx.drawImage(timg, -timg.width * pv[0] * z, -timg.height * pv[1] * z + rec, timg.width * z, timg.height * z);
      ctx.restore();
    }

    // harvester load glint
    if (this.harv && this.harv.load > 100) {
      const f = this.harv.load / ECON.harvestCapacity;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(this.heading + Math.PI / 2);
      ctx.fillStyle = `rgba(255,196,80,${0.35 + 0.4 * f})`;
      ctx.fillRect(-5 * z, 1 * z, 10 * z, 7 * z);
      ctx.restore();
    }
  }

  drawOverlay(ctx, cam, g, hovered) {
    const z = cam.zoom;
    const rx = lerp(this.prevX, this.x, g.alpha), ry = lerp(this.prevY, this.y, g.alpha);
    const px = (rx - cam.x) * z, py = (ry - cam.y) * z;
    const col = TEAM_COLORS[this.owner];
    const sel = g.selection.has(this);
    if (sel) {
      ctx.strokeStyle = col.sel;
      ctx.lineWidth = 1.4;
      const r = this.selRadius * z;
      // corner brackets (RA-flavor)
      const c = r * 0.55;
      ctx.beginPath();
      for (const [ox, oy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const bx = px + ox * r, by = py + oy * r;
        ctx.moveTo(bx, by + (oy > 0 ? -c : c));
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + (ox > 0 ? -c : c), by);
      }
      ctx.stroke();
    }
    if (sel || hovered || this.hp < this.maxHp) {
      const bw = Math.max(22, this.d.r * 2.6) * z;
      const bx = px - bw / 2, by = py - (this.selRadius + 8) * z;
      drawSegBar(ctx, bx, by, bw, 3, this.hp / this.maxHp);
    }
    if (this.guardMode) {
      ctx.fillStyle = col.main;
      ctx.fillRect(px - 1.5, py + (this.selRadius + 3) * z, 3, 3);
    }
    // deployed stance marker
    if (this.deployed) {
      ctx.strokeStyle = 'rgba(255,215,94,0.75)';
      ctx.lineWidth = 1.2;
      const r = (this.selRadius + 2) * z;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
    }
    // veterancy chevrons
    if (this.rank > 0) {
      ctx.strokeStyle = '#ffd75e';
      ctx.lineWidth = 1.6;
      const bx = px + (this.selRadius - 1) * z, by = py - (this.selRadius + 1) * z;
      for (let i = 0; i < this.rank; i++) {
        const yy = by + i * 5;
        ctx.beginPath();
        ctx.moveTo(bx - 3, yy);
        ctx.lineTo(bx, yy + 3);
        ctx.lineTo(bx + 3, yy);
        ctx.stroke();
      }
    }
  }
}

// ============================== BUILDING ==============================

export class Building {
  constructor(key, owner, cx, cy, instant = false) {
    this.id = NEXT_ID++;
    this.key = key;
    this.d = BUILDINGS[key];
    this.w = this.d.weapon ? WEAPONS[this.d.weapon] : null;
    this.owner = owner;
    this.cx = cx; this.cy = cy;
    this.fw = this.d.fw; this.fh = this.d.fh;
    this.x = (cx + this.fw / 2) * TILE;
    this.y = (cy + this.fh / 2) * TILE;
    this.prevX = this.x; this.prevY = this.y;
    this.maxHp = this.d.hp;
    // instant = pre-placed (game start); otherwise a construction site awaiting engineers
    this.state = instant ? 'active' : 'site';
    this.hp = instant ? this.maxHp : this.maxHp * ECON.siteInitHpFrac;
    this.rise = instant ? 1 : 0;
    this.progress = instant ? 1 : 0;
    this.spent = 0;
    this.buildersNow = 0;      // builders working this tick (units register before buildings update)
    this.buildersShown = 0;    // last tick's count, for rendering
    this.turret = this.w ? { ang: -Math.PI / 2, recoil: 0 } : null;
    this.rally = null;
    this.repairing = false;
    this.flash = 0;
    this.smokeT = 0;
    this.isBuilding = true;
    this.known = [false, false]; // seen by player? (fog memory)
    this.sellT = -1;
    // per-building production queue (this IS the factory model)
    this.queue = [];
    this.prodT = 0;
    this.prodSpent = 0;
  }

  canTrain(key) { return UNITS[key] && UNITS[key].factory === this.key; }
  trainList() { return Object.keys(UNITS).filter(k => UNITS[k].factory === this.key); }

  enqueue(g, key) {
    if (this.state !== 'active' || !this.canTrain(key) || this.queue.length >= 5) return false;
    this.queue.push(key);
    if (this.owner === PLAYER) g.onSidebarDirty && g.onSidebarDirty();
    return true;
  }

  // cancel the LAST queued copy of `key` (or the active head, refunding progress)
  cancelQueued(g, key) {
    for (let i = this.queue.length - 1; i >= 1; i--) {
      if (this.queue[i] === key) { this.queue.splice(i, 1); if (this.owner === PLAYER) g.onSidebarDirty && g.onSidebarDirty(); return true; }
    }
    if (this.queue[0] === key) {
      g.addCredits(this.owner, this.prodSpent);
      this.queue.shift();
      this.prodT = 0; this.prodSpent = 0;
      if (this.owner === PLAYER) { g.eva('cancelled'); g.onSidebarDirty && g.onSidebarDirty(); }
      return true;
    }
    return false;
  }

  updateProduction(g) {
    if (!this.queue.length) return;
    const key = this.queue[0];
    const ud = UNITS[key];
    const total = BUILD_TIME(ud.cost);
    const lowPow = g.power[this.owner].out < g.power[this.owner].use;
    let speedF = (lowPow ? ECON.lowPowerBuildFactor : 1);
    if (this.owner === PLAYER && g.fastBuild) speedF *= 8;
    if (this.owner !== PLAYER && g.ai) speedF *= g.ai.diff.income;
    const dtEff = DT * speedF;
    const need = Math.min((ud.cost / total) * dtEff, Math.max(0, ud.cost - this.prodSpent));
    if (g.credits[this.owner] >= need) {
      g.credits[this.owner] -= need;
      this.prodSpent += need;
      this.prodT += dtEff;
    } else if (this.owner === PLAYER && (g.tick % 60) === 0) g.eva('insufficientFunds');
    if (this.prodT >= total) {
      g.spawnUnitFromFactory(this, key);
      this.queue.shift();
      this.prodT = 0; this.prodSpent = 0;
      if (this.owner === PLAYER) {
        g.eva('unitReady');
        g.audio.sfx('ready');
        g.onSidebarDirty && g.onSidebarDirty();
      }
    }
  }

  armorClass() { return 'building'; }
  get selRadius() { return Math.max(this.fw, this.fh) * TILE * 0.52; }

  dockPoint() {
    return { x: this.x, y: (this.cy + this.fh) * TILE + 14 };
  }
  rallyPoint() {
    return this.rally || { x: this.x, y: (this.cy + this.fh) * TILE + 26 };
  }

  update(g) {
    if (this.dead) return;
    if (this.flash > 0) this.flash -= DT;
    if (this.state === 'site') {
      const n = Math.min(ECON.builderMax, this.buildersNow);
      this.buildersShown = n;
      this.buildersNow = 0;
      if (n > 0) {
        const total = BUILD_TIME(this.d.cost);
        const lowPow = g.power[this.owner].out < g.power[this.owner].use;
        const mult = (1 + ECON.builderBoost * (n - 1)) * (lowPow ? ECON.lowPowerBuildFactor : 1) * (g.fastBuild && this.owner === 0 ? 8 : 1);
        const delta = Math.min(1 - this.progress, (DT / total) * mult);
        const need = Math.min(this.d.cost - this.spent, this.d.cost * delta);
        if (g.credits[this.owner] >= need) {
          g.credits[this.owner] -= need;
          this.spent += need;
          this.progress += delta;
          this.hp = Math.min(this.maxHp * (ECON.siteInitHpFrac + (1 - ECON.siteInitHpFrac) * this.progress), this.hp + this.maxHp * delta * 1.2);
          if (this.progress >= 1) {
            this.state = 'rising';
            this.rise = 0;
          }
        } else if (this.owner === 0) g.eva('insufficientFunds');
      }
      return;
    }
    if (this.state === 'rising') {
      this.rise += DT / 1.15;
      if (this.rise >= 1) {
        this.rise = 1;
        g.combat.puff(this.x, this.y, 'dust', 10, 0.7);
        g.audio.sfx('place', { x: this.x, y: this.y });
        this.activate(g);
      }
      return;
    }
    if (this.state === 'selling') {
      this.sellT -= DT;
      if (this.sellT <= 0) g.removeBuilding(this, true);
      return;
    }
    // repair
    if (this.repairing && this.hp < this.maxHp) {
      const cost = (this.d.cost * ECON.repairCostFactor / this.maxHp) * ECON.repairRate * DT;
      if (g.credits[this.owner] >= cost) {
        g.credits[this.owner] -= cost;
        this.hp = Math.min(this.maxHp, this.hp + ECON.repairRate * DT);
        if ((g.tick & 9) === 0) g.combat.spark(this.x + (g.rng() - .5) * this.fw * TILE * .6, this.y + (g.rng() - .5) * this.fh * TILE * .5, 1);
      }
      if (this.hp >= this.maxHp) this.repairing = false;
    }
    // per-building unit production
    if (this.state === 'active') this.updateProduction(g);

    // repair platform aura: patch up nearby friendly vehicles for credits
    if (this.d.repairAura && this.state === 'active' && (g.tick % 5) === 0) {
      const aura = this.d.repairAura;
      const lowPow = g.power[this.owner].out < g.power[this.owner].use;
      if (!lowPow) {
        let fixed = 0;
        g.eachEntityNear(this.x, this.y, aura.range, e => {
          if (fixed >= 3 || e.isBuilding || e.owner !== this.owner || e.hp <= 0 || e.hp >= e.maxHp) return;
          if (e.d.kind !== 'veh') return;
          if (dist(this.x, this.y, e.x, e.y) > aura.range) return;
          const amt = aura.rate * DT * 5;
          const cost = (e.d.cost * ECON.repairCostFactor / e.maxHp) * amt;
          if (g.credits[this.owner] < cost) return;
          g.credits[this.owner] -= cost;
          e.hp = Math.min(e.maxHp, e.hp + amt);
          fixed++;
          if (g.rng() < 0.4) g.combat.spark(e.x + (g.rng() - .5) * 14, e.y + (g.rng() - .5) * 12, 1);
        });
      }
    }

    // damage smoke / fire
    const frac = this.hp / this.maxHp;
    if (frac < 0.55) {
      this.smokeT -= DT;
      if (this.smokeT <= 0) {
        this.smokeT = 0.25 + g.rng() * 0.4;
        const ox = (g.rng() - .5) * this.fw * TILE * 0.5, oy = (g.rng() - .5) * this.fh * TILE * 0.4;
        g.combat.puff(this.x + ox, this.y + oy, 'smoke', 6, 1.4);
        if (frac < 0.28) g.combat.puff(this.x + ox, this.y + oy, 'fire', 4, 0.5);
      }
    }
    // turret behavior
    if (this.turret && this.state === 'active') {
      if (this.coolB === undefined) this.coolB = 0;
      if (this.coolB > 0) this.coolB -= DT;
      if ((g.tick + this.id) % 7 === 0) {
        const t = g.findNearestEnemy(this.owner, this.x, this.y, this.w.range * TILE);
        this.tgt = t;
      }
      const t = this.tgt;
      if (t && t.hp > 0 && dist2(this.x, this.y, t.x, t.y) <= (this.w.range * TILE) ** 2) {
        const want = Math.atan2(t.y - this.y, t.x - this.x);
        this.turret.ang = turnToward(this.turret.ang, want, 3.6 * DT);
        if (this.turret.recoil > 0) this.turret.recoil -= 12 * DT;
        const lowPow = g.power[this.owner].out < g.power[this.owner].use;
        if (Math.abs(angDiff(this.turret.ang, want)) < 0.12 && this.coolB <= 0) {
          const sx = this.x + Math.cos(this.turret.ang) * 14, sy = this.y + Math.sin(this.turret.ang) * 14;
          g.combat.fire(this, this.w, sx, sy, t);
          this.turret.recoil = 2.4;
          this.coolB = this.w.rof / (lowPow ? ECON.lowPowerRofFactor : 1);
        }
      } else this.tgt = null;
    }
  }

  // finished construction / instant placement — grants free units, radar callouts
  activate(g, silent = false) {
    this.state = 'active';
    this.hp = this.maxHp;
    this.progress = 1;
    g.recomputePower(this.owner);
    if (this.d.freeUnit) {
      const dp = this.dockPoint();
      const taken = new Set();
      const cell = g.map.findFreeNear((dp.x / TILE) | 0, (dp.y / TILE) | 0, taken, 6);
      const u = g.spawnUnit(this.d.freeUnit, this.owner, cell.cx * TILE + 16, cell.cy * TILE + 16);
      if (u.harv) {
        const c = g.map.findOreNear(cell.cx, cell.cy);
        if (c) u.orderHarvest(g, c.cx, c.cy);
      }
    }
    if (this.owner === 0 && !silent) {
      g.eva('constructionComplete');
      g.audio.sfx('ready');
      if (this.key === 'radar') g.eva('radarOnline');
      g.onSidebarDirty && g.onSidebarDirty();
    }
  }

  startSell(g) {
    if (this.state === 'site') {
      // cancelling a site refunds everything poured into it
      g.addCredits(this.owner, this.spent);
      g.audio.sfx('sell');
      g.removeBuilding(this);
      return;
    }
    if (this.state !== 'active') return;
    const refund = Math.floor(this.d.cost * ECON.sellRefund * (this.hp / this.maxHp));
    g.addCredits(this.owner, refund);
    this.state = 'selling'; this.sellT = 0.5;
    g.audio.sfx('sell');
  }

  takeDamage(amount, attacker) {
    if (this.state === 'selling') return;
    this.hp -= amount;
    this.flash = 0.08;
    const g = window.__game;
    if (this.hp <= 0) { this.die(g, attacker); return; }
    g.onDamaged(this, attacker);
  }

  die(g, attacker) {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    const s = Math.max(this.fw, this.fh);
    g.combat.explosion(this.x - 8, this.y - 6, s * 0.55);
    g.combat.explosion(this.x + 10, this.y + 8, s * 0.45);
    setTimeoutTickSafe(g, 4, () => g.combat.explosion(this.x, this.y, s * 0.7));
    g.audio.sfx('bigboom', { x: this.x, y: this.y });
    g.addDecal(this.x, this.y, s);
    g.onEntityDied(this, attacker);
  }

  draw(ctx, cam, g) {
    const z = cam.zoom;
    const img = sprTeam(this.d.sprite, this.owner);
    if (!img) return;
    const px = (this.x - cam.x) * z, py = (this.y - cam.y) * z;
    const w = img.width * z, h = img.height * z;
    ctx.save();
    if (this.state === 'site') {
      // scaffold frame scaled to footprint
      const frame = spr('site_frame');
      const fwPx = this.fw * TILE * 1.16 * z;
      const fhPx = frame.height * (fwPx / frame.width);
      ctx.globalAlpha = 0.95;
      ctx.drawImage(frame, px - fwPx / 2, py - fhPx / 2, fwPx, fhPx);
      // target building ghost rising with progress
      if (this.progress > 0.04) {
        const revealH = h * this.progress;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.rect(px - w / 2 - 4, py + h / 2 - revealH, w + 8, revealH);
        ctx.clip();
        ctx.drawImage(img, px - w / 2, py - h / 2, w, h);
      }
      ctx.restore();
      // progress bar (always visible on sites)
      const bw = this.fw * TILE * 0.8 * z;
      const bx = px - bw / 2, by = (this.cy * TILE - cam.y) * z - 6;
      ctx.fillStyle = 'rgba(8,10,12,0.8)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
      ctx.fillStyle = this.buildersShown > 0 ? '#2ee6d6' : '#7d8a9a';
      ctx.fillRect(bx, by, bw * this.progress, 4);
      if (this.buildersShown > 1) {
        ctx.fillStyle = '#ffe9a0';
        ctx.font = `bold ${9 * z}px monospace`;
        ctx.textAlign = 'left';
        ctx.fillText('x' + this.buildersShown, bx + bw + 4, by + 5);
      }
      return;
    }
    if (this.state === 'rising') {
      const k = this.rise;
      // rise from ground with clipping + construction flicker
      const revealH = h * k;
      ctx.beginPath();
      ctx.rect(px - w / 2 - 4, py + h / 2 - revealH, w + 8, revealH);
      ctx.clip();
      ctx.drawImage(img, px - w / 2, py - h / 2, w, h);
      if ((g.tick & 3) < 2) {
        ctx.fillStyle = 'rgba(46,230,214,0.10)';
        ctx.fillRect(px - w / 2, py + h / 2 - revealH, w, 3 * z);
      }
      ctx.restore();
      // scaffold frame
      ctx.strokeStyle = 'rgba(200,210,220,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px - w / 2 - 2, py - h / 2 - 2, w + 4, h + 4);
      return;
    }
    if (this.state === 'selling') {
      const k = Math.max(0.05, this.sellT / 0.5);
      ctx.globalAlpha = k;
      ctx.drawImage(img, px - w * k / 2, py - h * k / 2, w * k, h * k);
      ctx.restore();
      return;
    }
    if (this.flash > 0) ctx.filter = 'brightness(2.1) saturate(0.65)';
    ctx.drawImage(img, px - w / 2, py - h / 2, w, h);
    ctx.restore();

    // turret gun
    if (this.turret) {
      const timg = sprTeam(this.d.turretSprite, this.owner);
      const pv = pivotOf(this.d.turretSprite);
      ctx.save();
      ctx.translate(px, py - 2 * z);
      ctx.rotate(this.turret.ang + Math.PI / 2);
      const rec = Math.max(0, this.turret.recoil) * z;
      if (this.flash > 0) ctx.filter = 'brightness(2.1)';
      ctx.drawImage(timg, -timg.width * pv[0] * z, -timg.height * pv[1] * z + rec, timg.width * z, timg.height * z);
      ctx.restore();
    }

    // radar dish blink
    if (this.key === 'radar' && this.state === 'active') {
      const on = g.power[this.owner].out >= g.power[this.owner].use;
      if (on && (g.tick % 30) < 15) {
        ctx.fillStyle = 'rgba(46,230,214,0.9)';
        ctx.beginPath(); ctx.arc(px + 8 * z, py - 10 * z, 1.6 * z, 0, 7); ctx.fill();
      }
    }
  }

  drawOverlay(ctx, cam, g, hovered) {
    const z = cam.zoom;
    const px = (this.x - cam.x) * z, py = (this.y - cam.y) * z;
    const col = TEAM_COLORS[this.owner];
    const sel = g.selection.has(this);
    if (sel) {
      ctx.strokeStyle = col.sel;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect((this.cx * TILE - cam.x) * z, (this.cy * TILE - cam.y) * z, this.fw * TILE * z, this.fh * TILE * z);
      ctx.setLineDash([]);
    }
    if ((sel || hovered || this.hp < this.maxHp) && this.state !== 'site') {
      const bw = this.fw * TILE * 0.8 * z;
      const bx = px - bw / 2, by = (this.cy * TILE - cam.y) * z - 9;
      drawSegBar(ctx, bx, by, bw, 4, this.hp / this.maxHp);
    }
    if (this.repairing && (g.tick % 20) < 12) {
      ctx.fillStyle = '#e8b33a';
      ctx.font = `${12 * z}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('🔧', px, py - 6 * z);
    }
    // rally flag
    if (sel && this.d.produces && this.rally) {
      const rp = this.rally;
      const rpx = (rp.x - cam.x) * z, rpy = (rp.y - cam.y) * z;
      ctx.strokeStyle = 'rgba(46,230,214,0.55)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(rpx, rpy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col.main;
      ctx.fillRect(rpx - 1, rpy - 10 * z, 2, 10 * z);
      ctx.beginPath();
      ctx.moveTo(rpx + 1, rpy - 10 * z); ctx.lineTo(rpx + 8 * z, rpy - 7.5 * z); ctx.lineTo(rpx + 1, rpy - 5 * z);
      ctx.fill();
    }
  }
}

// helper: schedule a delayed one-shot on game tick timeline
function setTimeoutTickSafe(g, ticks, fn) {
  g.delayed.push({ at: g.tick + ticks, fn });
}
