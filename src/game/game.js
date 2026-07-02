// RED HORIZON — Game orchestrator: state, orders, production, power, rendering.

import { TILE, DT, TPS, clamp, lerp, dist, dist2, mulberry32, SpatialHash, fmtTime } from '../engine/core.js';
import { sprTeam, spr, decal } from '../engine/assets.js';
import { GameMap, T_WATER } from './map.js';
import { Pathfinder } from './path.js';
import { Fog } from './fog.js';
import { Combat } from './combat.js';
import { Unit, Building, resetIds } from './entities.js';
import { AIController } from './ai.js';
import { UNITS, BUILDINGS, BUILD_TIME, ECON, EVA, DIFFICULTY, PLAYER, ENEMY, TEAM_COLORS } from './data.js';

export class Game {
  constructor(canvas, audio, opts = {}) {
    window.__game = this;
    resetIds();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audio = audio;
    this.diffKey = opts.difficulty || 'normal';
    this.diff = DIFFICULTY[this.diffKey];
    this.seed = opts.seed ?? 20260702;
    this.rng = mulberry32(this.seed ^ 0x9e3779b9);

    this.map = new GameMap(this.seed);
    this.map.buildTerrainCanvas();
    this.map.buildOreCanvas();
    this.pathfinder = new Pathfinder(this.map);
    this.fog = new Fog(this.map);
    this.combat = new Combat(this);

    this.units = [];
    this.buildings = [];
    this.byId = new Map();
    this.hash = new SpatialHash(this.map.w, this.map.h);
    this.husks = [];
    this.decals = [];
    this.delayed = [];

    this.credits = [ECON.startCredits, this.diff.aiCredits];
    this.dispCredits = ECON.startCredits;
    this.power = [{ out: 0, use: 0 }, { out: 0, use: 0 }];
    this.stats = [
      { built: 0, lost: 0, kills: 0, mined: 0 },
      { built: 0, lost: 0, kills: 0, mined: 0 },
    ];

    this.selection = new Set();
    this.groups = {};             // digit -> array of ids
    this.prod = { build: null, inf: null, veh: null };
    this.placing = null;          // building key awaiting placement
    this.mode = 'normal';         // normal | placing | repair | sell | attackTarget
    this.markers = [];            // move/attack ground markers
    this.pings = [];              // minimap pings {cx, cy, t}
    this.lastEvent = null;        // {x, y}

    this.cam = { x: 0, y: 0, zoom: 1 };
    this.shake = 0;
    this.tick = 0;
    this.time = 0;
    this.alpha = 0;
    this.over = false;
    this.won = false;
    this.paused = false;

    this.evaCooldown = new Map();
    this.onBanner = null;         // hud hook
    this.onSidebarDirty = null;   // hud hook
    this.onEnd = null;            // hud hook

    this.debug = opts.debug || false;
    this.fastBuild = false;

    this.setupStart();
    this.ai = new AIController(this, this.diff);
    // opening guidance
    this.delayed.push({ at: 45, fn: () => { this.onBanner && this.onBanner('指挥官，点击建筑面板开始施工 (B)——工程车会自动前往', 'good'); } });
    this.delayed.push({ at: 240, fn: () => { this.onBanner && this.onBanner('多台工程车同修一处可以加速施工', 'gold'); } });
    this.delayed.push({ at: 420, fn: () => { this.onBanner && this.onBanner('矿石精炼厂附赠采矿车，经济就是火力', 'gold'); } });
  }

  // ---------- setup ----------
  setupStart() {
    const [ps, es] = this.map.starts;
    this.placeBuilding('conyard', ps.cx - 1, ps.cy - 1, PLAYER, true);
    this.placeBuilding('conyard', es.cx - 1, es.cy - 1, ENEMY, true);
    for (let i = 0; i < 2; i++) {
      this.spawnUnit('rifle', PLAYER, (ps.cx + 3 + i) * TILE, (ps.cy + 3) * TILE);
      this.spawnUnit('rifle', ENEMY, (es.cx - 3 - i) * TILE, (es.cy - 3) * TILE);
      this.spawnUnit('builder', PLAYER, (ps.cx - 3 + i * 2) * TILE, (ps.cy + 3) * TILE);
      this.spawnUnit('builder', ENEMY, (es.cx + 3 - i * 2) * TILE, (es.cy - 3) * TILE);
    }
    this.cam.x = ps.cx * TILE - 300;
    this.cam.y = ps.cy * TILE - 260;
    this.recomputePower(PLAYER);
    this.recomputePower(ENEMY);
  }

  // ---------- entity mgmt ----------
  spawnUnit(key, owner, x, y) {
    const u = new Unit(key, owner, x, y);
    this.units.push(u);
    this.byId.set(u.id, u);
    this.stats[owner].built++;
    return u;
  }

  spawnUnitFromFactory(b, key) {
    const door = b.dockPoint();
    // spawn on a free cell just outside the factory door — never inside the footprint
    const taken = new Set();
    const cell = this.map.findFreeNear((door.x / TILE) | 0, (door.y / TILE) | 0, taken, 6);
    const u = this.spawnUnit(key, b.owner, cell.cx * TILE + 16, cell.cy * TILE + 16);
    u.heading = Math.PI / 2;
    u.prevX = u.x; u.prevY = u.y;
    this.combat.puff(door.x, door.y, 'dust', 6, 0.6);
    const rp = b.rallyPoint();
    if (u.harv) {
      const c = this.map.findOreNear(cell.cx, cell.cy);
      if (c) u.orderHarvest(this, c.cx, c.cy);
    } else {
      u.orderMove(this, rp.x + (this.rng() - .5) * 40, rp.y + (this.rng() - .5) * 40, true);
    }
    if (b.owner === PLAYER) {
      this.eva('unitReady');
      this.audio.sfx('ready');
    }
    return u;
  }

  canPlace(key, cx, cy, owner = PLAYER) {
    const d = BUILDINGS[key];
    if (!d) return false;
    for (let y = cy; y < cy + d.fh; y++)
      for (let x = cx; x < cx + d.fw; x++)
        if (!this.map.isBuildable(x, y)) return false;
    // adjacency: within N tiles of own building
    const N = 7;
    for (const b of this.buildings) {
      if (b.owner !== owner || b.hp <= 0) continue;
      const dx = Math.max(b.cx - (cx + d.fw - 1), cx - (b.cx + b.fw - 1), 0);
      const dy = Math.max(b.cy - (cy + d.fh - 1), cy - (b.cy + b.fh - 1), 0);
      if (Math.max(dx, dy) <= N) return true;
    }
    return false;
  }

  placeBuilding(key, cx, cy, owner = PLAYER, instant = false) {
    const b = new Building(key, owner, cx, cy, instant);
    this.buildings.push(b);
    this.byId.set(b.id, b);
    for (let y = cy; y < cy + b.fh; y++)
      for (let x = cx; x < cx + b.fw; x++)
        this.map.bld[y * this.map.w + x] = b.id;
    this.stats[owner].built++;
    if (instant) b.activate(this, true);
    return b;
  }

  hasBuilder(owner = PLAYER) {
    return this.units.some(u => u.owner === owner && u.d.builder && u.hp > 0);
  }

  removeBuilding(b, sold = false) {
    b.hp = 0;
    b.dead = true;  // release anyone targeting a sold/removed building
    for (let y = b.cy; y < b.cy + b.fh; y++)
      for (let x = b.cx; x < b.cx + b.fw; x++)
        if (this.map.bld[y * this.map.w + x] === b.id) this.map.bld[y * this.map.w + x] = -1;
    this.buildings = this.buildings.filter(e => e !== b);
    this.byId.delete(b.id);
    this.selection.delete(b);
    this.recomputePower(b.owner);
  }

  onEntityDied(e, attacker) {
    if (attacker && attacker.owner !== e.owner) {
      this.stats[attacker.owner].kills++;
      attacker.kills = (attacker.kills || 0) + 1;
    }
    this.stats[e.owner].lost++;
    this.selection.delete(e);
    if (e.isBuilding) {
      this.removeBuilding(e);
      if (e.owner === PLAYER) { this.eva('buildingLost'); this.pingAt(e.x, e.y); }
    } else {
      this.units = this.units.filter(u => u !== e);
      this.byId.delete(e.id);
      this.ai.notifyUnitDied(e);
      if (e.owner === PLAYER && e.harv) { this.eva('harvesterUnderAttack'); this.pingAt(e.x, e.y); }
    }
    this.checkEnd();
  }

  onDamaged(e, attacker) {
    if (e.owner === PLAYER) {
      this.lastEvent = { x: e.x, y: e.y };
      if (e.isBuilding) { this.eva('baseUnderAttack'); this.pingAt(e.x, e.y); }
      else if (e.harv) { this.eva('harvesterUnderAttack'); this.pingAt(e.x, e.y); }
      else {
        this.eva('unitsUnderAttack');
        if (this.time - (this._lastUnitPing || -9) > 2.5) { this._lastUnitPing = this.time; this.pingAt(e.x, e.y); }
      }
    } else {
      this.ai.notifyDamage(e, attacker);
    }
  }

  addHusk(u) {
    const src = sprTeam(u.d.sprite, u.owner);
    // bake the charred variant once — ctx.filter per frame is expensive
    const img = document.createElement('canvas');
    img.width = src.width; img.height = src.height;
    const hctx = img.getContext('2d');
    hctx.filter = 'brightness(0.35) saturate(0.4)';
    hctx.drawImage(src, 0, 0);
    this.husks.push({ img, x: u.x, y: u.y, ang: u.heading + Math.PI / 2, ttl: 9, max: 9 });
    if (this.husks.length > 40) this.husks.shift();
  }
  addDecal(x, y, s = 1) {
    this.decals.push({ img: decal('scorch' + ((this.rng() * 3) | 0)), x, y, rot: this.rng() * 6.28, ttl: 30, max: 30, s });
    if (this.decals.length > 60) this.decals.shift();
  }
  pingAt(x, y) {
    this.pings.push({ x, y, t: 2.2 });
    if (this.pings.length > 8) this.pings.shift();
  }

  // ---------- economy / power ----------
  addCredits(owner, amt) { this.credits[owner] += amt; }

  recomputePower(owner) {
    let out = 0, use = 0;
    for (const b of this.buildings) {
      if (b.owner !== owner || b.hp <= 0 || b.state !== 'active') continue;
      if (b.d.power > 0) out += b.d.power; else use -= b.d.power;
    }
    const was = this.power[owner];
    const lowBefore = was.out < was.use;
    this.power[owner] = { out, use };
    if (owner === PLAYER) {
      const lowNow = out < use;
      const hasRadarBld = this.buildings.some(b => b.owner === PLAYER && b.key === 'radar' && b.hp > 0);
      if (lowNow && !lowBefore) {
        this.eva('lowPower');
        if (hasRadarBld) this.eva('radarOffline');
      }
      if (!lowNow && lowBefore && hasRadarBld) this.eva('radarOnline');
      this.onSidebarDirty && this.onSidebarDirty();
    }
  }

  hasRadar(owner = PLAYER) {
    const p = this.power[owner];
    return p.out >= p.use && this.buildings.some(b => b.owner === owner && b.key === 'radar' && b.hp > 0 && b.state === 'active');
  }

  // ---------- production (player sidebar) ----------
  catOf(key) { return BUILDINGS[key] ? 'build' : UNITS[key].factory === 'barracks' ? 'inf' : 'veh'; }

  prereqsMet(key) {
    const isB = !!BUILDINGS[key];
    const d = isB ? BUILDINGS[key] : UNITS[key];
    if (isB && !this.buildings.some(b => b.owner === PLAYER && b.key === 'conyard' && b.hp > 0)) return false;
    if (!isB) {
      const fac = UNITS[key].factory;
      if (!this.buildings.some(b => b.owner === PLAYER && b.key === fac && b.hp > 0 && b.state === 'active')) return false;
      for (const p of (d.prereqBld || []))
        if (!this.buildings.some(b => b.owner === PLAYER && b.key === p && b.hp > 0)) return false;
      return true;
    }
    for (const p of (d.prereq || []))
      if (!this.buildings.some(b => b.owner === PLAYER && b.key === p && b.hp > 0)) return false;
    return true;
  }

  startProduction(key) {
    const cat = this.catOf(key);
    const cost = (BUILDINGS[key] || UNITS[key]).cost;
    if (!this.prereqsMet(key)) return false;
    if (cat === 'build') {
      // buildings are erected by engineer trucks on-site
      if (!this.hasBuilder(PLAYER)) { this.eva('needBuilder'); return false; }
      this.enterPlacement(key);
      this.audio.sfx('click');
      return true;
    }
    const slot = this.prod[cat];
    if (slot) {
      if (slot.queue.length < 8) { slot.queue.push(key); this.audio.sfx('click'); this.onSidebarDirty && this.onSidebarDirty(); return true; }
      return false;
    }
    this.prod[cat] = { key, t: 0, total: BUILD_TIME(cost), spent: 0, cost, queue: [], paused: false };
    this.audio.sfx('click');
    this.onSidebarDirty && this.onSidebarDirty();
    return true;
  }

  // cancel the actively-building item (refund progress), promoting the next queued one
  cancelActive(cat) {
    const slot = this.prod[cat];
    if (!slot) return;
    this.addCredits(PLAYER, slot.spent);
    const next = slot.queue && slot.queue.shift();
    this.prod[cat] = next
      ? { key: next, t: 0, total: BUILD_TIME(UNITS[next].cost), spent: 0, cost: UNITS[next].cost, queue: slot.queue, paused: false }
      : null;
    if (this.placing && cat === 'build') { this.placing = null; this.mode = 'normal'; }
    this.eva('cancelled');
    this.onSidebarDirty && this.onSidebarDirty();
  }

  cancelProduction(cat) {
    const slot = this.prod[cat];
    if (!slot) return;
    if (slot.queue && slot.queue.length) { slot.queue.pop(); this.onSidebarDirty && this.onSidebarDirty(); return; }
    this.addCredits(PLAYER, slot.spent);
    this.prod[cat] = null;
    if (this.placing && cat === 'build') { this.placing = null; this.mode = 'normal'; }
    this.eva('cancelled');
    this.onSidebarDirty && this.onSidebarDirty();
  }

  updateProduction() {
    const lowPow = this.power[PLAYER].out < this.power[PLAYER].use;
    const speedF = (lowPow ? ECON.lowPowerBuildFactor : 1) * (this.fastBuild ? 8 : 1);
    for (const cat of ['inf', 'veh']) {
      const slot = this.prod[cat];
      if (!slot) continue;
      const facKey = UNITS[slot.key].factory;
      if (!this.buildings.some(b => b.owner === PLAYER && b.key === facKey && b.hp > 0 && b.state === 'active')) {
        this.eva('onHold');
        continue;
      }
      const dtEff = DT * speedF;
      // never charge past the sticker price (final tick would overshoot)
      const need = Math.min((slot.cost / slot.total) * dtEff, slot.cost - slot.spent);
      if (this.credits[PLAYER] >= need) {
        this.credits[PLAYER] -= need;
        slot.spent += need;
        slot.t += dtEff;
      } else if ((this.tick % 60) === 0) this.eva('insufficientFunds');
      if (slot.t >= slot.total) {
        const fac = this.buildings.find(b => b.owner === PLAYER && b.key === facKey && b.hp > 0 && b.state === 'active');
        if (fac) this.spawnUnitFromFactory(fac, slot.key);
        const next = slot.queue.shift();
        this.prod[cat] = next ? { key: next, t: 0, total: BUILD_TIME(UNITS[next].cost), spent: 0, cost: UNITS[next].cost, queue: slot.queue, paused: false } : null;
        this.onSidebarDirty && this.onSidebarDirty();
      }
    }
  }

  enterPlacement(key) {
    this.placing = key;
    this.mode = 'placing';
  }

  confirmPlacement(cx, cy) {
    if (!this.placing) return false;
    if (!this.canPlace(this.placing, cx, cy)) { this.eva('cannotBuildThere'); this.audio.sfx('deny'); return false; }
    const site = this.placeBuilding(this.placing, cx, cy, PLAYER);
    this.audio.sfx('place');
    // dispatch engineers: selected ones first, else the nearest idle one
    let crew = [...this.selection].filter(e => !e.isBuilding && e.d.builder && e.hp > 0);
    if (!crew.length) {
      let best = null, bd = Infinity;
      for (const u of this.units) {
        if (u.owner !== PLAYER || !u.d.builder || u.hp <= 0) continue;
        const busy = u.state === 'build' && u.buildSite && u.buildSite.state === 'site';
        const d = dist2(u.x, u.y, site.x, site.y) * (busy ? 4 : 1); // prefer idle crews
        if (d < bd) { bd = d; best = u; }
      }
      if (best) crew = [best];
    }
    for (const u of crew) u.orderBuild(this, site, true);
    if (crew.length) this.eva('building');
    this.placing = null;
    this.mode = 'normal';
    this.onSidebarDirty && this.onSidebarDirty();
    return true;
  }

  // ---------- queries ----------
  eachEntityNear(x, y, r, fn) {
    this.hash.queryCircle(x, y, r + 84, fn);
  }

  findNearestEnemy(owner, x, y, range) {
    let best = null, bd = Infinity;
    this.eachEntityNear(x, y, range, e => {
      if (e.owner === owner || e.hp <= 0 || e.dead) return;
      if (e.isBuilding && e.state === 'selling') return;
      // player units don't see through fog
      if (owner === PLAYER && !this.fog.isVisiblePx(e.x, e.y)) return;
      const rr = e.isBuilding ? e.selRadius * 0.8 : e.d.r;
      const d = dist(x, y, e.x, e.y) - rr;
      if (d <= range && d < bd) { bd = d; best = e; }
    });
    return best;
  }

  nearestBuilding(owner, key, x, y) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (b.owner !== owner || b.hp <= 0 || (key && b.key !== key)) continue;
      const d = dist2(x, y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  pickAt(wx, wy) {
    // units first (radius), then buildings (rect)
    let best = null, bd = Infinity;
    for (const u of this.units) {
      if (u.hp <= 0) continue;
      if (u.owner !== PLAYER && !this.fog.isVisiblePx(u.x, u.y)) continue;
      const d = dist2(wx, wy, u.x, u.y);
      const rr = (u.selRadius + 3) ** 2;
      if (d < rr && d < bd) { bd = d; best = u; }
    }
    if (best) return best;
    for (const b of this.buildings) {
      if (b.hp <= 0) continue;
      if (b.owner !== PLAYER && !(b.known[PLAYER] && this.fog.isExploredPx(b.x, b.y))) continue;
      if (wx >= b.cx * TILE && wx < (b.cx + b.fw) * TILE && wy >= b.cy * TILE && wy < (b.cy + b.fh) * TILE) return b;
    }
    return null;
  }

  unitsInRect(x0, y0, x1, y1) {
    const out = [];
    const ax = Math.min(x0, x1), ay = Math.min(y0, y1), bx = Math.max(x0, x1), by = Math.max(y0, y1);
    for (const u of this.units) {
      if (u.owner !== PLAYER || u.hp <= 0) continue;
      if (u.x >= ax - u.d.r && u.x <= bx + u.d.r && u.y >= ay - u.d.r && u.y <= by + u.d.r) out.push(u);
    }
    return out;
  }

  // ---------- orders from UI ----------
  cmdMove(units, tx, ty) {
    const list = units.filter(u => !u.isBuilding);
    if (!list.length) return;
    this.markers.push({ x: tx, y: ty, t: 0.6, type: 'move' });
    const tcx = clamp((tx / TILE) | 0, 0, this.map.w - 1), tcy = clamp((ty / TILE) | 0, 0, this.map.h - 1);
    const taken = new Set();
    const sorted = [...list].sort((a, b) => dist2(a.x, a.y, tx, ty) - dist2(b.x, b.y, tx, ty));
    let first = true;
    for (const u of sorted) {
      const cell = list.length === 1 ? { cx: tcx, cy: tcy } : this.map.findFreeNear(tcx, tcy, taken, 8);
      u.orderMove(this, cell.cx * TILE + 16, cell.cy * TILE + 16, !first);
      first = false;
    }
  }

  cmdAttack(units, target) {
    this.markers.push({ x: target.x, y: target.y, t: 0.6, type: 'attack' });
    let first = true;
    for (const u of units) {
      if (u.isBuilding) continue;
      if (u.w) { first ? u.orderAttack(this, target) : (u.orderAttack(this, target), 0); }
      else u.orderMove(this, target.x, target.y, true);
      first = false;
    }
  }

  cmdAttackMove(units, tx, ty) {
    this.markers.push({ x: tx, y: ty, t: 0.6, type: 'attack' });
    const taken = new Set();
    const tcx = clamp((tx / TILE) | 0, 0, this.map.w - 1), tcy = clamp((ty / TILE) | 0, 0, this.map.h - 1);
    let first = true;
    for (const u of units) {
      if (u.isBuilding) continue;
      const cell = units.length === 1 ? { cx: tcx, cy: tcy } : this.map.findFreeNear(tcx, tcy, taken, 8);
      if (u.w) u.orderAttackMove(this, cell.cx * TILE + 16, cell.cy * TILE + 16);
      else u.orderMove(this, cell.cx * TILE + 16, cell.cy * TILE + 16, true);
      if (first && u.owner === PLAYER) {} // ack handled in order fns
      first = false;
    }
  }

  cmdHarvest(units, cx, cy) {
    this.markers.push({ x: cx * TILE + 16, y: cy * TILE + 16, t: 0.6, type: 'move' });
    for (const u of units) if (u.harv) u.orderHarvest(this, cx, cy);
  }

  cmdStop(units) { for (const u of units) if (!u.isBuilding) u.orderStop(this); }
  cmdGuard(units) { for (const u of units) if (!u.isBuilding && u.w) u.orderGuard(); }

  // ---------- EVA ----------
  eva(key) {
    const now = this.time;
    const last = this.evaCooldown.get(key) ?? -99;
    const cd = (key === 'insufficientFunds' || key === 'cannotBuildThere') ? 2.5 : 7;
    if (now - last < cd) return;
    this.evaCooldown.set(key, now);
    const e = EVA[key];
    if (!e) return;
    this.onBanner && this.onBanner(e.t, e.cls);
    this.audio.eva(e.t);
  }

  shakeAdd(v) { this.shake = Math.min(14, this.shake + v); }

  // ---------- main update ----------
  update() {
    if (this.over || this.paused) return;
    this.tick++;
    this.time += DT;

    // delayed callbacks
    for (let i = this.delayed.length - 1; i >= 0; i--) {
      if (this.delayed[i].at <= this.tick) {
        const d = this.delayed.splice(i, 1)[0];
        d.fn();
      }
    }

    // rebuild spatial hash
    this.hash.clear();
    for (const u of this.units) this.hash.insert(u);
    for (const b of this.buildings) this.hash.insert(b);

    this.pathfinder.processQueue(6);

    for (const u of this.units) u.update(this);
    this.separation();
    for (const b of this.buildings) b.update(this);

    this.combat.update();
    this.updateProduction();
    this.ai.update();

    if ((this.tick % 6) === 0) this.fog.update(this);
    if ((this.tick % 30) === 0) this.map.regenOre(1.0);
    if ((this.tick % 15) === 0) this.checkEnd();

    // ore glints in view
    if ((this.tick % 12) === 0) {
      const dpr = this.canvas.__dpr || 1;
      const vw = this.canvas.width / dpr, vh = this.canvas.height / dpr;
      for (let i = 0; i < 6; i++) {
        const cx = ((this.cam.x + this.rng() * vw / this.cam.zoom) / TILE) | 0;
        const cy = ((this.cam.y + this.rng() * vh / this.cam.zoom) / TILE) | 0;
        if (this.map.inB(cx, cy) && this.map.ore[cy * this.map.w + cx] > 100 && this.fog.isVisibleCell(cx, cy)) {
          this.combat.add({
            type: 'spark', x: cx * TILE + 8 + this.rng() * 16, y: cy * TILE + 8 + this.rng() * 16,
            vx: 0, vy: -6, life: 0.5, maxLife: 0.5, size: 1.6, drag: 1,
          });
          break;
        }
      }
    }

    // markers/pings decay
    for (let i = this.markers.length - 1; i >= 0; i--) {
      this.markers[i].t -= DT;
      if (this.markers[i].t <= 0) this.markers.splice(i, 1);
    }
    for (let i = this.pings.length - 1; i >= 0; i--) {
      this.pings[i].t -= DT;
      if (this.pings[i].t <= 0) this.pings.splice(i, 1);
    }
    for (let i = this.husks.length - 1; i >= 0; i--) {
      this.husks[i].ttl -= DT;
      if (this.husks[i].ttl <= 0) this.husks.splice(i, 1);
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      this.decals[i].ttl -= DT;
      if (this.decals[i].ttl <= 0) this.decals.splice(i, 1);
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 26 * DT);
  }

  separation() {
    // soft push apart overlapping units
    for (const u of this.units) {
      if (u.hp <= 0) continue;
      this.hash.queryCircle(u.x, u.y, u.d.r + 14, o => {
        if (o === u || o.isBuilding || o.hp <= 0) return;
        const minD = u.d.r + o.d.r + 1;
        const d2 = dist2(u.x, u.y, o.x, o.y);
        if (d2 >= minD * minD || d2 < 0.001) return;
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.32;
        const nx = (u.x - o.x) / d, ny = (u.y - o.y) / d;
        const moveA = u.state !== 'idle' ? 0.7 : 0.3;
        const ux = u.x + nx * push * moveA, uy = u.y + ny * push * moveA;
        if (this.map.isPassable(clamp((ux / TILE) | 0, 0, this.map.w - 1), clamp((uy / TILE) | 0, 0, this.map.h - 1))) { u.x = ux; u.y = uy; }
      });
    }
  }

  checkEnd() {
    if (this.over) return;
    const alive = o => this.buildings.some(b => b.owner === o && b.hp > 0 && b.state !== 'selling');
    const pAlive = alive(PLAYER), eAlive = alive(ENEMY);
    if (pAlive && eAlive) return;
    this.over = true;
    this.won = pAlive;
    this.eva(this.won ? 'victory' : 'defeat');
    this.audio.endJingle(this.won);
    this.onEnd && this.onEnd(this.won);
  }

  // ---------- render ----------
  render(alpha, vw, vh, hudDraw) {
    this.alpha = alpha;
    const ctx = this.ctx;
    const cam = { ...this.cam };
    if (this.shake > 0.2) {
      cam.x += (Math.random() - 0.5) * this.shake;
      cam.y += (Math.random() - 0.5) * this.shake;
    }
    const z = cam.zoom;
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, vw, vh);
    ctx.imageSmoothingEnabled = false;

    // terrain + ore slices
    const sw = vw / z, sh = vh / z;
    ctx.drawImage(this.map.terrainCanvas, cam.x, cam.y, sw, sh, 0, 0, vw, vh);
    ctx.drawImage(this.map.oreCanvas, cam.x, cam.y, sw, sh, 0, 0, vw, vh);

    // decals & husks
    for (const dcl of this.decals) {
      const k = Math.min(1, dcl.ttl / 6);
      ctx.save();
      ctx.globalAlpha = 0.85 * k;
      ctx.translate((dcl.x - cam.x) * z, (dcl.y - cam.y) * z);
      ctx.rotate(dcl.rot);
      const s = dcl.img.width * (dcl.s || 1) * z;
      ctx.drawImage(dcl.img, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
    for (const hk of this.husks) {
      const k = Math.min(1, hk.ttl / 3);
      ctx.save();
      ctx.globalAlpha = 0.9 * k;
      ctx.translate((hk.x - cam.x) * z, (hk.y - cam.y) * z);
      ctx.rotate(hk.ang);
      ctx.drawImage(hk.img, -hk.img.width * z / 2, -hk.img.height * z / 2, hk.img.width * z, hk.img.height * z);
      ctx.restore();
    }

    // entities sorted by y, fog-filtered
    const drawList = [];
    const margin = 120;
    for (const b of this.buildings) {
      if (b.x < cam.x - margin || b.x > cam.x + sw + margin || b.y < cam.y - margin || b.y > cam.y + sh + margin) continue;
      if (b.owner !== PLAYER && !b.known[PLAYER] && this.fog.enabled) continue;
      drawList.push(b);
    }
    for (const u of this.units) {
      if (u.hp <= 0) continue;
      if (u.x < cam.x - margin || u.x > cam.x + sw + margin || u.y < cam.y - margin || u.y > cam.y + sh + margin) continue;
      if (u.owner !== PLAYER && !this.fog.isVisiblePx(u.x, u.y)) continue;
      drawList.push(u);
    }
    drawList.sort((a, b) => a.y - b.y);
    for (const e of drawList) {
      const dim = e.isBuilding && e.owner !== PLAYER && !this.fog.isVisiblePx(e.x, e.y);
      if (dim) { ctx.save(); ctx.filter = 'brightness(0.55)'; }
      e.draw(ctx, cam, this);
      if (dim) ctx.restore();
    }

    // projectiles & particles
    this.combat.draw(ctx, cam);

    // ground markers
    for (const mk of this.markers) {
      const k = mk.t / 0.6;
      const r = (1 - k) * 14 + 5;
      ctx.strokeStyle = mk.type === 'attack' ? `rgba(255,80,60,${k})` : `rgba(80,255,150,${k})`;
      ctx.lineWidth = 2;
      const px = (mk.x - cam.x) * z, py = (mk.y - cam.y) * z;
      ctx.beginPath(); ctx.arc(px, py, r * z, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 3, py); ctx.lineTo(px + 3, py); ctx.moveTo(px, py - 3); ctx.lineTo(px, py + 3); ctx.stroke();
    }

    // placement ghost
    if (this.mode === 'placing' && this.placing && this.placeHover) {
      const d = BUILDINGS[this.placing];
      const { cx, cy } = this.placeHover;
      const ok = this.canPlace(this.placing, cx, cy);
      for (let y = 0; y < d.fh; y++) {
        for (let x = 0; x < d.fw; x++) {
          const gx = (cx + x) * TILE, gy = (cy + y) * TILE;
          const cellOk = this.map.isBuildable(cx + x, cy + y);
          ctx.fillStyle = ok && cellOk ? 'rgba(60,255,140,0.25)' : 'rgba(255,60,50,0.3)';
          ctx.fillRect((gx - cam.x) * z + 1, (gy - cam.y) * z + 1, TILE * z - 2, TILE * z - 2);
          ctx.strokeStyle = ok && cellOk ? 'rgba(60,255,140,0.5)' : 'rgba(255,60,50,0.55)';
          ctx.strokeRect((gx - cam.x) * z + 1, (gy - cam.y) * z + 1, TILE * z - 2, TILE * z - 2);
        }
      }
      const img = sprTeam(d.sprite, PLAYER);
      ctx.globalAlpha = 0.55;
      ctx.drawImage(img,
        ((cx + d.fw / 2) * TILE - cam.x) * z - img.width * z / 2,
        ((cy + d.fh / 2) * TILE - cam.y) * z - img.height * z / 2,
        img.width * z, img.height * z);
      ctx.globalAlpha = 1;
    }

    // fog
    this.fog.draw(ctx, cam, vw, vh);

    // overlays above fog
    let hovered = this.hoverEntity;
    for (const e of drawList) e.drawOverlay(ctx, cam, this, e === hovered);

    hudDraw && hudDraw(ctx, cam);
  }
}
