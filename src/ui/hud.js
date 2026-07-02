// RED HORIZON — HUD: mouse orders, selection, minimap, cursors, banners, screens.

import { TILE, clamp, dist2, fmtTime } from '../engine/core.js';
import { PLAYER, ENEMY, TEAM_COLORS, BUILDINGS, UNITS, WEAPONS, BUILD_TIME } from '../game/data.js';
import { T_GRASS, T_DIRT, T_WATER, T_ROCK, T_TREE } from '../game/map.js';
import { cameo } from '../engine/assets.js';
import { BUILD_MENU } from './sidebar.js';

function makeCursor(draw, hotX = 4, hotY = 4, size = 26) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.lineWidth = 2; ctx.lineCap = 'round';
  draw(ctx, size);
  return `url(${c.toDataURL()}) ${hotX} ${hotY}, auto`;
}

export class HUD {
  constructor(game, audio, sidebar, rig, viewport) {
    this.g = game;
    this.audio = audio;
    this.sidebar = sidebar;
    this.rig = rig;
    this.viewport = viewport;
    this.canvas = game.canvas;

    this.mouse = { x: 0, y: 0, wx: 0, wy: 0, down: false, downX: 0, downY: 0, dragging: false };
    this.attackArmed = false;
    this.lastClickT = 0; this.lastClickTarget = null;
    this.groupTapT = 0; this.groupTapN = -1;

    this.minimap = document.getElementById('minimap');
    this.mmCtx = this.minimap.getContext('2d');
    this.mmTerrain = null;
    this.banners = document.getElementById('banners');
    this.cb = {
      face: document.getElementById('cb-face'),
      name: document.getElementById('cb-name'),
      count: document.getElementById('cb-count'),
      idle: document.getElementById('cb-idle'),
      stats: document.getElementById('cb-stats'),
      multi: document.getElementById('cb-multi'),
      cmds: document.getElementById('cb-cmds'),
    };
    this.cbSig = '__init__';
    this.cbFrame = 0;
    this.buildMenuOpen = false;

    this.enabled = true;
    this.cursors = this.buildCursors();
    this.bindCanvas();
    this.bindKeys();
    this.bindMinimap();
    this.bindCmdButtons();
    document.getElementById('objective-pin').textContent = '任务目标：歼灭猩红军团所有建筑';
    this.setGame(game);
  }

  setGame(game) {
    this.g = game;
    game.onBanner = (t, cls) => this.banner(t, cls);
    this.attackArmed = false;
    this.buildMenuOpen = false;
    this.cbSig = '__init__';
    this.mouse.down = false;
    this.mouse.dragging = false;
    this.lastClickTarget = null;
    this.panRef = null;
    this.banners.innerHTML = '';
    this.setMode('normal');
    this.buildMinimapTerrain();
    this.enabled = true;
  }

  // ---------------- cursors ----------------
  buildCursors() {
    const move = makeCursor((ctx, s) => {
      ctx.strokeStyle = '#3aff8c';
      ctx.beginPath(); ctx.arc(s / 2, s / 2, 7, 0, 7); ctx.stroke();
      ctx.beginPath();
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        ctx.moveTo(s / 2 + dx * 9, s / 2 + dy * 9);
        ctx.lineTo(s / 2 + dx * 12, s / 2 + dy * 12);
      }
      ctx.stroke();
    }, 13, 13);
    const attack = makeCursor((ctx, s) => {
      ctx.strokeStyle = '#ff4b3a';
      ctx.beginPath(); ctx.arc(s / 2, s / 2, 8, 0, 7); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s / 2 - 12, s / 2); ctx.lineTo(s / 2 - 4, s / 2);
      ctx.moveTo(s / 2 + 4, s / 2); ctx.lineTo(s / 2 + 12, s / 2);
      ctx.moveTo(s / 2, s / 2 - 12); ctx.lineTo(s / 2, s / 2 - 4);
      ctx.moveTo(s / 2, s / 2 + 4); ctx.lineTo(s / 2, s / 2 + 12);
      ctx.stroke();
      ctx.fillStyle = '#ff4b3a'; ctx.fillRect(s / 2 - 1, s / 2 - 1, 2, 2);
    }, 13, 13);
    const no = makeCursor((ctx, s) => {
      ctx.strokeStyle = '#9aa4ad';
      ctx.beginPath(); ctx.arc(s / 2, s / 2, 8, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s / 2 - 6, s / 2 + 6); ctx.lineTo(s / 2 + 6, s / 2 - 6); ctx.stroke();
    }, 13, 13);
    const sell = makeCursor((ctx, s) => {
      ctx.strokeStyle = '#e8b33a'; ctx.fillStyle = '#e8b33a';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('$', 8, 19);
    }, 13, 13);
    const repair = makeCursor((ctx, s) => {
      ctx.strokeStyle = '#e8b33a';
      ctx.beginPath(); ctx.arc(s / 2 - 3, s / 2 - 3, 5, 0.6, 4.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + 7, s / 2 + 7); ctx.stroke();
    }, 13, 13);
    return { move, attack, no, sell, repair, default: 'default', place: 'crosshair' };
  }

  updateCursor() {
    const g = this.g;
    let cur = 'default';
    if (g.mode === 'placing') cur = this.cursors.place;
    else if (g.mode === 'sell') cur = this.cursors.sell;
    else if (g.mode === 'repair') cur = this.cursors.repair;
    else if (this.attackArmed) cur = this.cursors.attack;
    else {
      const h = g.hoverEntity;
      const anyCombat = [...g.selection].some(e => !e.isBuilding);
      if (h && h.owner !== PLAYER && anyCombat) cur = this.cursors.attack;
      else if (anyCombat) {
        const cx = (this.mouse.wx / TILE) | 0, cy = (this.mouse.wy / TILE) | 0;
        cur = g.map.isPassable(cx, cy) || g.map.inB(cx, cy) && g.map.ore[cy * g.map.w + cx] > 0 ? this.cursors.move : this.cursors.no;
      }
    }
    this.viewport.style.cursor = cur;
  }

  // ---------------- canvas mouse ----------------
  bindCanvas() {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', e => e.preventDefault());

    cv.addEventListener('mousedown', e => {
      if (!this.enabled) return;
      this.audio.ensure();
      const g = this.g;
      this.syncMouse(e);
      if (e.button === 1) {
        this.rig.panning = true;
        this.panRef = { x: e.clientX, y: e.clientY, camX: g.cam.x, camY: g.cam.y };
        e.preventDefault();
        return;
      }
      if (e.button === 0) {
        if (g.mode === 'placing') {
          const cx = (this.mouse.wx / TILE) | 0, cy = (this.mouse.wy / TILE) | 0;
          const d = BUILDINGS[g.placing];
          g.confirmPlacement(cx - (d.fw >> 1), cy - (d.fh >> 1));
          return;
        }
        if (g.mode === 'sell' || g.mode === 'repair') {
          const t = g.pickAt(this.mouse.wx, this.mouse.wy);
          if (t && t.isBuilding && t.owner === PLAYER) {
            if (g.mode === 'sell') {
              if (t.state === 'active') t.startSell(g);
              else this.audio.sfx('deny');
            } else { t.repairing = !t.repairing; this.audio.sfx('click'); }
          }
          return;
        }
        if (this.attackArmed) {
          this.issueAttackMove();
          this.attackArmed = false;
          return;
        }
        this.mouse.down = true;
        this.mouse.downX = this.mouse.x; this.mouse.downY = this.mouse.y;
        this.mouse.downWx = this.mouse.wx; this.mouse.downWy = this.mouse.wy;  // world-anchored box origin
        this.mouse.dragging = false;
      }
      if (e.button === 2) {
        this.onRightClick();
      }
    });

    window.addEventListener('mousemove', e => {
      if (!this.enabled) return;
      this.syncMouse(e);
      if (this.rig.panning && this.panRef) {
        const g = this.g;
        g.cam.x = this.panRef.camX - (e.clientX - this.panRef.x) / g.cam.zoom;
        g.cam.y = this.panRef.camY - (e.clientY - this.panRef.y) / g.cam.zoom;
        this.rig.clampCam();
        return;
      }
      if (this.mouse.down && !this.mouse.dragging) {
        if (Math.abs(this.mouse.x - this.mouse.downX) + Math.abs(this.mouse.y - this.mouse.downY) > 5) {
          this.mouse.dragging = true;
        }
      }
      // placement hover
      const g = this.g;
      if (g.mode === 'placing' && g.placing) {
        const d = BUILDINGS[g.placing];
        g.placeHover = {
          cx: ((this.mouse.wx / TILE) | 0) - (d.fw >> 1),
          cy: ((this.mouse.wy / TILE) | 0) - (d.fh >> 1),
        };
      }
      g.hoverEntity = g.pickAt(this.mouse.wx, this.mouse.wy);
    });

    window.addEventListener('mouseup', e => {
      if (!this.enabled) return;
      if (e.button === 1) { this.rig.panning = false; this.panRef = null; return; }
      if (e.button !== 0 || !this.mouse.down) return;
      this.mouse.down = false;
      const g = this.g;
      if (this.mouse.dragging) {
        // box select (origin anchored in world space so camera scroll doesn't drag it)
        const b = this.rig.screenToWorld(this.mouse.x, this.mouse.y);
        const units = g.unitsInRect(this.mouse.downWx, this.mouse.downWy, b.x, b.y);
        if (!e.shiftKey) g.selection.clear();
        for (const u of units) g.selection.add(u);
        if (units.length) this.audio.sfx('click');
        this.mouse.dragging = false;
        return;
      }
      // click select
      const t = g.pickAt(this.mouse.wx, this.mouse.wy);
      const now = performance.now();
      if (t && t.owner === PLAYER) {
        // double click: select same type on screen
        if (now - this.lastClickT < 320 && this.lastClickTarget === t && !t.isBuilding) {
          const vw = this.viewport.clientWidth / g.cam.zoom, vh = this.viewport.clientHeight / g.cam.zoom;
          g.selection.clear();
          for (const u of g.units) {
            if (u.owner === PLAYER && u.key === t.key &&
              u.x > g.cam.x && u.x < g.cam.x + vw && u.y > g.cam.y && u.y < g.cam.y + vh) g.selection.add(u);
          }
          this.audio.sfx('click');
        } else {
          if (!e.shiftKey) g.selection.clear();
          if (e.shiftKey && g.selection.has(t)) g.selection.delete(t);
          else g.selection.add(t);
          this.audio.sfx('click');
        }
      } else if (!e.shiftKey) {
        g.selection.clear();
      }
      this.lastClickT = now; this.lastClickTarget = t;
    });

    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.rig.zoomAt(e.offsetX, e.offsetY, e.deltaY > 0 ? -1 : 1);
    }, { passive: false });

    this.viewport.addEventListener('mouseleave', () => { this.rig.mouse.inside = false; this.g.hoverEntity = null; });
    this.viewport.addEventListener('mousemove', e => {
      const r = this.viewport.getBoundingClientRect();
      this.rig.mouse.x = e.clientX - r.left;
      this.rig.mouse.y = e.clientY - r.top;
      this.rig.mouse.inside = true;
      this.rig.mouse.moved = true;
    });
  }

  syncMouse(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
    const w = this.rig.screenToWorld(this.mouse.x, this.mouse.y);
    this.mouse.wx = w.x; this.mouse.wy = w.y;
  }

  selectedUnits() { return [...this.g.selection].filter(e => !e.isBuilding); }

  onRightClick() {
    const g = this.g;
    if (g.mode === 'placing') { g.mode = 'normal'; g.placing = null; return; }  // back to READY state
    if (g.mode === 'sell' || g.mode === 'repair') { this.setMode('normal'); return; }
    const units = this.selectedUnits();
    const hover = g.pickAt(this.mouse.wx, this.mouse.wy);

    // factory rally point
    if (!units.length) {
      const facs = [...g.selection].filter(e => e.isBuilding && e.d.produces && e.owner === PLAYER);
      if (facs.length) {
        for (const f of facs) f.rally = { x: this.mouse.wx, y: this.mouse.wy };
        g.markers.push({ x: this.mouse.wx, y: this.mouse.wy, t: 0.6, type: 'move' });
        this.audio.sfx('click');
      }
      return;
    }
    if (hover && hover.owner !== PLAYER) {
      g.cmdAttack(units, hover);
      this.audio.noteCombatUi?.();
      return;
    }
    // engineers: right-click own site (or damaged building) = build / repair
    if (hover && hover.owner === PLAYER && hover.isBuilding) {
      const crews = units.filter(u => u.d.builder);
      if (crews.length && (hover.state === 'site' || hover.hp < hover.maxHp)) {
        for (const u of crews) u.orderBuild(g, hover, u !== crews[0]);
        g.markers.push({ x: hover.x, y: hover.y, t: 0.6, type: 'move' });
        const rest = units.filter(u => !u.d.builder);
        if (rest.length) g.cmdMove(rest, this.mouse.wx, this.mouse.wy);
        return;
      }
    }
    // ore? send harvesters
    const cx = (this.mouse.wx / TILE) | 0, cy = (this.mouse.wy / TILE) | 0;
    if (g.map.inB(cx, cy) && g.map.ore[cy * g.map.w + cx] > 0 && units.some(u => u.harv)) {
      g.cmdHarvest(units.filter(u => u.harv), cx, cy);
      const rest = units.filter(u => !u.harv);
      if (rest.length) g.cmdMove(rest, this.mouse.wx, this.mouse.wy);
      return;
    }
    g.cmdMove(units, this.mouse.wx, this.mouse.wy);
  }

  issueAttackMove() {
    const g = this.g;
    const units = this.selectedUnits();
    if (!units.length) return;
    const hover = g.pickAt(this.mouse.wx, this.mouse.wy);
    if (hover && hover.owner !== PLAYER) g.cmdAttack(units, hover);
    else g.cmdAttackMove(units, this.mouse.wx, this.mouse.wy);
  }

  // ---------------- keys ----------------
  bindKeys() {
    window.addEventListener('keydown', e => {
      if (!this.enabled) return;
      const g = this.g;
      // overlay screens own all keys (main.js handles Escape there) — never double-handle
      if (document.querySelector('.screen:not(.hidden):not(#screen-loading)')) return;
      switch (e.code) {
        case 'KeyA':
          if (!e.ctrlKey && !e.metaKey && this.selectedUnits().length) { this.attackArmed = true; }
          break;
        case 'KeyS':
          if (!e.ctrlKey) { g.cmdStop(this.selectedUnits()); }
          break;
        case 'KeyG': g.cmdGuard(this.selectedUnits()); break;
        case 'KeyH': {
          const cy = g.nearestBuilding(PLAYER, 'conyard', 0, 0) || g.buildings.find(b => b.owner === PLAYER);
          if (cy) this.rig.centerOn(cy.x, cy.y);
          break;
        }
        case 'Space': {
          e.preventDefault();
          if (g.lastEvent) this.rig.centerOn(g.lastEvent.x, g.lastEvent.y);
          break;
        }
        case 'KeyX': this.setMode(g.mode === 'sell' ? 'normal' : 'sell'); break;
        case 'KeyC': this.setMode(g.mode === 'repair' ? 'normal' : 'repair'); break;
        case 'KeyB': {
          // open the engineer build menu; auto-pick the nearest idle engineer if none selected
          let crews = this.selectedUnits().filter(u => u.d.builder);
          if (!crews.length) {
            let best = null, bd = Infinity;
            const c = { x: g.cam.x + this.viewport.clientWidth / g.cam.zoom / 2, y: g.cam.y + this.viewport.clientHeight / g.cam.zoom / 2 };
            for (const u of g.units) {
              if (u.owner !== PLAYER || !u.d.builder || u.hp <= 0) continue;
              const d = dist2(u.x, u.y, c.x, c.y) * (u.state === 'idle' ? 1 : 3);
              if (d < bd) { bd = d; best = u; }
            }
            if (best) { g.selection.clear(); g.selection.add(best); crews = [best]; }
          }
          if (crews.length) { this.buildMenuOpen = true; this.cbSig = ''; }
          else g.eva('needBuilder');
          break;
        }
        case 'KeyV': this.autoHarvest(this.selectedUnits()); break;
        case 'KeyF': {
          let used = false;
          for (const u of this.selectedUnits()) if (u.d.skill && u.useSkill(g)) used = true;
          if (used) { this.cbSig = ''; this.audio.sfx('click'); }
          break;
        }
        case 'Tab': e.preventDefault(); this.sidebar.cycleTab(); break;
        case 'Escape':
          if (this.buildMenuOpen) { this.buildMenuOpen = false; this.cbSig = ''; }
          else if (g.mode !== 'normal') { this.setMode('normal'); g.placing = null; }
          else if (this.attackArmed) this.attackArmed = false;
          else if (g.selection.size) g.selection.clear();
          else this.onEsc && this.onEsc();
          break;
        default: {
          // control groups
          if (e.code.startsWith('Digit')) {
            const n = Number(e.code.slice(5));
            if (n >= 1 && n <= 9) {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const sel = this.selectedUnits();
                if (sel.length) {
                  g.groups[n] = sel.map(u => u.id);
                  this.banner(`编队 ${n} 已设定`, 'good');
                }
              } else {
                const ids = g.groups[n] || [];
                const units = ids.map(id => g.byId.get(id)).filter(u => u && u.hp > 0);
                g.groups[n] = units.map(u => u.id);
                if (units.length) {
                  g.selection.clear();
                  units.forEach(u => g.selection.add(u));
                  const now = performance.now();
                  if (this.groupTapN === n && now - this.groupTapT < 350) {
                    const cxm = units.reduce((s, u) => s + u.x, 0) / units.length;
                    const cym = units.reduce((s, u) => s + u.y, 0) / units.length;
                    this.rig.centerOn(cxm, cym);
                  }
                  this.groupTapT = now; this.groupTapN = n;
                }
              }
            }
            break;
          }
          // production hotkeys: build menu first, else active sidebar tab
          const map = { KeyQ: 0, KeyW: 1, KeyE: 2, KeyR: 3, KeyT: 4, KeyY: 5 };
          if (e.code in map && !e.ctrlKey) {
            if (this.buildMenuOpen) {
              const key = BUILD_MENU[map[e.code]];
              if (key && g.prereqsMet(key) && g.startProduction(key)) { this.buildMenuOpen = false; this.cbSig = ''; }
              else if (key) this.audio.sfx('deny');
              break;
            }
            const tabs = { inf: ['rifle', 'rocket'], veh: ['builder', 'buggy', 'harvester', 'tank', 'heavy'] };
            const key = (tabs[this.sidebar.activeTab] || [])[map[e.code]];
            if (key) this.sidebar.clickItem(key);
          }
          // debug keys
          if (g.debug) {
            if (e.code === 'F2') { g.credits[PLAYER] += 5000; e.preventDefault(); }
            if (e.code === 'F3') { g.fog.enabled = !g.fog.enabled; g.fog.revealAll(); e.preventDefault(); }
            if (e.code === 'F4') { g.fastBuild = !g.fastBuild; this.banner('快速建造 ' + (g.fastBuild ? 'ON' : 'OFF'), 'gold'); e.preventDefault(); }
            if (e.code === 'F5') { g.ai.waveT = 0.1; e.preventDefault(); }
            if (e.code === 'F6') { for (const b of [...g.buildings]) if (b.owner === ENEMY) b.die(g, null); e.preventDefault(); }
            if (e.code === 'F7') { for (const b of [...g.buildings]) if (b.owner === PLAYER) b.die(g, null); e.preventDefault(); }
          }
        }
      }
    });
  }

  setMode(m) {
    this.g.mode = m;
    document.getElementById('btn-sell').classList.toggle('on', m === 'sell');
    document.getElementById('btn-repair').classList.toggle('on', m === 'repair');
  }

  bindCmdButtons() {
    document.getElementById('btn-sell').addEventListener('click', () => {
      if (!this.enabled) return;
      this.audio.ensure(); this.setMode(this.g.mode === 'sell' ? 'normal' : 'sell'); this.audio.sfx('click');
    });
    document.getElementById('btn-repair').addEventListener('click', () => {
      if (!this.enabled) return;
      this.audio.ensure(); this.setMode(this.g.mode === 'repair' ? 'normal' : 'repair'); this.audio.sfx('click');
    });
    document.getElementById('btn-menu').addEventListener('click', () => {
      this.audio.ensure(); this.onEsc && this.onEsc(); this.audio.sfx('click');
    });
  }

  // ---------------- minimap ----------------
  buildMinimapTerrain() {
    const g = this.g;
    const m = g.map;
    const c = document.createElement('canvas');
    c.width = m.w; c.height = m.h;
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(m.w, m.h);
    const colors = {
      [T_GRASS]: [107, 111, 60], [T_DIRT]: [110, 86, 54], [T_WATER]: [40, 58, 76],
      [T_ROCK]: [120, 122, 124], [T_TREE]: [63, 80, 48],
    };
    for (let i = 0; i < m.w * m.h; i++) {
      const col = colors[m.tiles[i]] || colors[T_GRASS];
      id.data[i * 4] = col[0]; id.data[i * 4 + 1] = col[1]; id.data[i * 4 + 2] = col[2]; id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    this.mmTerrain = c;
  }

  bindMinimap() {
    const mm = this.minimap;
    const toWorld = e => {
      const r = mm.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      return { x: fx * this.g.map.w * TILE, y: fy * this.g.map.h * TILE };
    };
    let down = false;
    mm.addEventListener('mousedown', e => {
      if (!this.enabled) return;
      if (!this.g.hasRadar() && !this.g.debug) return;
      down = true;
      const w = toWorld(e);
      this.rig.centerOn(w.x, w.y);
    });
    window.addEventListener('mousemove', e => {
      if (down) { const w = toWorld(e); this.rig.centerOn(w.x, w.y); }
    });
    window.addEventListener('mouseup', () => { down = false; });
  }

  drawMinimap() {
    const g = this.g;
    const ctx = this.mmCtx;
    const S = this.minimap.width;
    const m = g.map;
    ctx.imageSmoothingEnabled = false;
    const hasRadar = g.hasRadar() || g.debug && !g.fog.enabled;
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, S, S);
    if (!hasRadar) return; // offline overlay shows
    ctx.drawImage(this.mmTerrain, 0, 0, S, S);
    const k = S / m.w;
    // ore
    ctx.fillStyle = '#c9992e';
    for (let cy = 0; cy < m.h; cy += 2) {
      for (let cx = 0; cx < m.w; cx += 2) {
        if (m.ore[cy * m.w + cx] > 60) ctx.fillRect(cx * k, cy * k, k * 2, k * 2);
      }
    }
    // fog mask
    if (g.fog.enabled) {
      ctx.fillStyle = 'rgba(3,5,8,0.85)';
      for (let cy = 0; cy < m.h; cy += 1) {
        let run = -1;
        for (let cx = 0; cx <= m.w; cx++) {
          const dark = cx < m.w && !g.fog.explored[cy * m.w + cx];
          if (dark && run < 0) run = cx;
          else if (!dark && run >= 0) { ctx.fillRect(run * k, cy * k, (cx - run) * k, k); run = -1; }
        }
      }
    }
    // entities
    for (const b of g.buildings) {
      if (b.hp <= 0) continue;
      if (b.owner !== PLAYER && !(b.known[PLAYER])) continue;
      ctx.fillStyle = TEAM_COLORS[b.owner].mini;
      ctx.fillRect(b.cx * k, b.cy * k, Math.max(2, b.fw * k), Math.max(2, b.fh * k));
    }
    for (const u of g.units) {
      if (u.hp <= 0) continue;
      if (u.owner !== PLAYER && !g.fog.isVisiblePx(u.x, u.y)) continue;
      ctx.fillStyle = TEAM_COLORS[u.owner].mini;
      const px = u.x / TILE * k, py = u.y / TILE * k;
      ctx.fillRect(px - 1, py - 1, 2.4, 2.4);
    }
    // pings
    for (const p of g.pings) {
      const kk = 1 - p.t / 2.2;
      ctx.strokeStyle = `rgba(255,70,60,${1 - kk})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x / TILE * k, p.y / TILE * k, 3 + kk * 14, 0, 7);
      ctx.stroke();
    }
    // viewport rect
    const vw = this.viewport.clientWidth / g.cam.zoom / TILE * k;
    const vh = this.viewport.clientHeight / g.cam.zoom / TILE * k;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(g.cam.x / TILE * k, g.cam.y / TILE * k, vw, vh);

    // radar sweep
    const ang = (performance.now() / 2400) * Math.PI * 2;
    ctx.save();
    ctx.translate(S / 2, S / 2);
    for (let i = 0; i < 8; i++) {
      const a = ang - i * 0.045;
      ctx.strokeStyle = `rgba(46,230,214,${0.20 * (1 - i / 8)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * S, Math.sin(a) * S);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------- banners ----------------
  banner(text, cls = '') {
    const el = document.createElement('div');
    el.className = 'banner ' + (cls || '');
    el.textContent = text;
    this.banners.appendChild(el);
    while (this.banners.children.length > 3) this.banners.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 550); }, 2600);
  }

  // ---------------- command bar (War3-style bottom panel) ----------------
  updateCmdbar() {
    const g = this.g;
    for (const e of g.selection) if (e.hp <= 0 || e.dead) g.selection.delete(e);
    const sel = [...g.selection];
    if (this.buildMenuOpen && !sel.some(e => !e.isBuilding && e.d.builder)) this.buildMenuOpen = false;
    const sig = sel.map(e => e.id).sort((a, b) => a - b).join(',') + '|' + g.mode + '|' + (this.buildMenuOpen ? 'BM' : '') + '|' + (this.attackArmed ? 'AA' : '');
    this.cbFrame++;
    if (sig === this.cbSig && this.cbFrame % 18 !== 0) return;
    this.cbSig = sig;
    const cb = this.cb;
    const fctx = cb.face.getContext('2d');
    fctx.imageSmoothingEnabled = false;
    fctx.fillStyle = '#0b0f16';
    fctx.fillRect(0, 0, cb.face.width, cb.face.height);

    if (!sel.length) {
      cb.idle.style.display = '';
      cb.stats.style.display = 'none';
      cb.multi.style.display = 'none';
      cb.count.classList.add('hidden');
      cb.name.textContent = '—';
      cb.cmds.innerHTML = '';
      return;
    }
    cb.idle.style.display = 'none';
    const first = sel[0];
    fctx.drawImage(cameo(first.d.sprite), 0, 0, cb.face.width, cb.face.height);
    cb.name.textContent = first.d.cn.replace(/ /g, '');

    if (sel.length === 1) {
      cb.count.classList.add('hidden');
      cb.multi.style.display = 'none';
      cb.stats.style.display = 'grid';
      const e = first;
      const rows = [];
      const hpCls = e.hp / e.maxHp > 0.5 ? '' : e.hp / e.maxHp > 0.25 ? 'gold' : 'red';
      rows.push(['生命', `${Math.ceil(e.hp)}/${e.maxHp}`, hpCls]);
      if (!e.isBuilding) {
        const w = e.w;
        rows.push(['攻击', w ? `${w.dmg}${w.burst > 1 ? '×' + w.burst : ''}` : '—']);
        if (w) rows.push(['射程', String(w.range)]);
        rows.push(['速度', String(e.d.speed)]);
        if ((e.kills || 0) > 0) rows.push(['击杀', String(e.kills), 'gold']);
        if ((e.rank || 0) > 0) rows.push(['军衔', e.rank === 2 ? '精英 +40%' : '老兵 +20%', 'gold']);
        if (e.harv) rows.push(['载矿', `${Math.round(e.harv.load)}/700`, 'gold']);
      } else if (e.state === 'site') {
        rows.push(['施工', `${Math.round(e.progress * 100)}%`, 'gold']);
        rows.push(['工程车', String(e.buildersShown)]);
      } else {
        if (e.d.power) rows.push(['电力', (e.d.power > 0 ? '+' : '') + e.d.power, e.d.power > 0 ? '' : 'gold']);
        const low = g.power[PLAYER].out < g.power[PLAYER].use;
        rows.push(['状态', e.state === 'active' ? (low && e.d.power < 0 ? '低电' : '正常') : '施工', low && e.d.power < 0 ? 'red' : '']);
        if (e.trainList && e.trainList().length && e.state === 'active') {
          const head = e.queue[0];
          rows.push(['生产', head ? `${UNITS[head].cn.replace(/ /g, '')} ${Math.round(e.prodT / BUILD_TIME(UNITS[head].cost) * 100)}%` : '空闲']);
          rows.push(['队列', `${e.queue.length}/5`]);
          rows.push(['集结', '右键设定']);
        }
      }
      cb.stats.innerHTML = rows.map(([k, v, cls]) =>
        `<div class="st"><span class="sk">${k}</span><span class="sv ${cls || ''}">${v}</span></div>`).join('');
      // production queue cards for a selected factory
      if (first.isBuilding && first.owner === PLAYER && first.state === 'active' && first.queue.length) {
        cb.multi.style.display = 'flex';
        cb.multi.innerHTML = '';
        first.queue.forEach((k, qi) => {
          const card = document.createElement('div');
          card.className = 'cb-card';
          card.title = qi === 0 ? '生产中 — 点击取消' : '排队中 — 点击取消';
          const cv = document.createElement('canvas');
          cv.width = 40; cv.height = 30;
          const cc = cv.getContext('2d');
          cc.imageSmoothingEnabled = false;
          cc.drawImage(cameo(UNITS[k].sprite), 0, 0, 40, 30);
          card.appendChild(cv);
          const hp = document.createElement('div');
          hp.className = 'chp';
          const i = document.createElement('i');
          i.style.width = qi === 0 ? Math.round(first.prodT / BUILD_TIME(UNITS[k].cost) * 100) + '%' : '0%';
          i.style.background = '#2ee6d6';
          hp.appendChild(i);
          card.appendChild(hp);
          card.addEventListener('click', () => { first.cancelQueued(g, k); this.cbSig = ''; this.audio.sfx('click'); });
          cb.multi.appendChild(card);
        });
      }
    } else {
      cb.count.textContent = 'x' + sel.length;
      cb.count.classList.remove('hidden');
      cb.stats.style.display = 'none';
      cb.multi.style.display = 'flex';
      cb.multi.innerHTML = '';
      const MAX = 16;
      sel.slice(0, MAX).forEach(e => {
        const card = document.createElement('div');
        card.className = 'cb-card';
        const cv = document.createElement('canvas');
        cv.width = 40; cv.height = 30;
        const cc = cv.getContext('2d');
        cc.imageSmoothingEnabled = false;
        cc.drawImage(cameo(e.d.sprite), 0, 0, 40, 30);
        card.appendChild(cv);
        const hp = document.createElement('div');
        hp.className = 'chp';
        const i = document.createElement('i');
        const frac = e.hp / e.maxHp;
        i.style.width = (frac * 100) + '%';
        i.style.background = frac > 0.5 ? '#35e85f' : frac > 0.25 ? '#e8c22e' : '#f24d3a';
        hp.appendChild(i);
        card.appendChild(hp);
        card.addEventListener('click', ev => {
          if (ev.shiftKey) g.selection.delete(e);
          else { g.selection.clear(); g.selection.add(e); }
          this.audio.sfx('click');
        });
        cb.multi.appendChild(card);
      });
      if (sel.length > MAX) {
        const more = document.createElement('div');
        more.className = 'cb-card';
        more.style.display = 'flex'; more.style.alignItems = 'center'; more.style.justifyContent = 'center';
        more.style.color = '#79879a'; more.style.fontSize = '11px';
        more.textContent = '+' + (sel.length - MAX);
        cb.multi.appendChild(more);
      }
    }

    // command card
    const units = sel.filter(e => !e.isBuilding);
    const hasCombat = units.some(u => u.w);
    const hasBuilder = units.some(u => u.d.builder);
    const hasHarv = units.some(u => u.harv);
    const single = sel.length === 1 ? sel[0] : null;

    // engineer build menu takes over the command card (War3-style)
    if (this.buildMenuOpen && hasBuilder) {
      const cmds = this.cb.cmds;
      cmds.innerHTML = '';
      const hkeys = ['Q', 'W', 'E', 'R', 'T', 'Y'];
      BUILD_MENU.forEach((key, i) => {
        const d = BUILDINGS[key];
        const met = g.prereqsMet(key);
        const el = document.createElement('button');
        el.className = 'cbtn bld' + (met ? '' : ' off');
        el.title = `${d.cn.replace(/ /g, '')} $${d.cost} — ${d.desc}`;
        const cv = document.createElement('canvas');
        cv.width = 52; cv.height = 32;
        const cc = cv.getContext('2d');
        cc.imageSmoothingEnabled = false;
        const cm = cameo(d.sprite);
        // proportional center-crop into the button
        const sc = Math.max(52 / cm.width, 32 / cm.height);
        const dw = cm.width * sc, dh = cm.height * sc;
        cc.drawImage(cm, (52 - dw) / 2, (32 - dh) / 2, dw, dh);
        el.appendChild(cv);
        const price = document.createElement('span');
        price.className = 'bprice';
        price.textContent = '$' + d.cost;
        el.appendChild(price);
        const hk = document.createElement('span');
        hk.className = 'hk';
        hk.textContent = hkeys[i];
        el.appendChild(hk);
        el.addEventListener('click', () => {
          this.audio.ensure();
          if (!met) { this.audio.sfx('deny'); return; }
          if (g.startProduction(key)) { this.buildMenuOpen = false; this.cbSig = ''; }
        });
        cmds.appendChild(el);
      });
      const back = document.createElement('button');
      back.className = 'cbtn';
      back.innerHTML = `↩<span class="hk">Esc</span>`;
      back.addEventListener('click', () => { this.buildMenuOpen = false; this.cbSig = ''; this.audio.sfx('click'); });
      cmds.appendChild(back);
      return;
    }

    const btns = [];
    if (hasCombat) {
      btns.push({ t: '攻', hk: 'A', cls: this.attackArmed ? 'on' : '', fn: () => { this.attackArmed = true; this.cbSig = ''; } });
      btns.push({ t: '停', hk: 'S', fn: () => g.cmdStop(units) });
      btns.push({ t: '戒', hk: 'G', fn: () => { g.cmdGuard(units); this.banner('警戒模式：坚守阵地', 'good'); } });
    } else if (units.length && !hasBuilder && !hasHarv) {
      btns.push({ t: '停', hk: 'S', fn: () => g.cmdStop(units) });
    }
    if (hasBuilder) {
      btns.push({ t: '建', hk: 'B', fn: () => { this.buildMenuOpen = true; this.cbSig = ''; } });
      if (!hasCombat) btns.push({ t: '停', hk: 'S', fn: () => g.cmdStop(units) });
    }
    if (hasHarv) {
      btns.push({ t: '矿', hk: 'V', fn: () => this.autoHarvest(units) });
    }
    // unit skills (sprint / deploy)
    const skillKeys = new Set();
    for (const u of units) {
      if (!u.d.skill || skillKeys.has(u.d.skill.key)) continue;
      skillKeys.add(u.d.skill.key);
      const sk = u.d.skill;
      const holders = units.filter(x => x.d.skill && x.d.skill.key === sk.key);
      const maxCd = Math.max(...holders.map(x => x.skillCd || 0));
      const anyDeployed = holders.some(x => x.deployed);
      btns.push({
        t: sk.cn.replace(/ /g, '')[0], hk: sk.hk,
        cls: (sk.toggle && anyDeployed ? 'on ' : '') + (maxCd > 0.2 && !sk.toggle ? 'cd' : ''),
        cd: !sk.toggle && maxCd > 0.2 ? Math.ceil(maxCd) : 0,
        title: `${sk.cn.replace(/ /g, '')} — ${sk.desc}`,
        fn: () => { for (const x of holders) x.useSkill(g); this.cbSig = ''; },
      });
    }

    if (single && single.isBuilding && single.owner === PLAYER) {
      // factory: production buttons live on the command card (per-building queue)
      if (single.state === 'active' && single.trainList().length) {
        for (const k of single.trainList()) {
          const ud = UNITS[k];
          const met = g.prereqsMet(k);
          btns.push({
            cameo: ud.sprite, price: ud.cost, hk: ud.hotkey || '',
            cls: 'bld' + (met ? '' : ' off'),
            title: `${ud.cn.replace(/ /g, '')} $${ud.cost} — ${ud.desc}`,
            fn: () => {
              if (!met) { this.audio.sfx('deny'); return; }
              if (!single.enqueue(g, k)) this.audio.sfx('deny');
              this.cbSig = '';
            },
          });
        }
      }
      if (single.state === 'site') {
        btns.push({ t: '撤', hk: 'X', cls: 'danger', fn: () => { single.startSell(g); this.cbSig = ''; } });
      } else if (single.state === 'active') {
        btns.push({ t: '修', hk: 'C', cls: g.mode === 'repair' ? 'on' : '', fn: () => this.setMode(g.mode === 'repair' ? 'normal' : 'repair') });
        btns.push({ t: '售', hk: 'X', cls: (g.mode === 'sell' ? 'on ' : '') + 'danger', fn: () => this.setMode(g.mode === 'sell' ? 'normal' : 'sell') });
      }
    }
    cb.cmds.innerHTML = '';
    for (const b of btns.slice(0, 8)) {
      const el = document.createElement('button');
      el.className = 'cbtn ' + (b.cls || '');
      if (b.title) el.title = b.title;
      if (b.cameo) {
        const cv = document.createElement('canvas');
        cv.width = 52; cv.height = 32;
        const cc = cv.getContext('2d');
        cc.imageSmoothingEnabled = false;
        const cm = cameo(b.cameo);
        const sc = Math.max(52 / cm.width, 32 / cm.height);
        cc.drawImage(cm, (52 - cm.width * sc) / 2, (32 - cm.height * sc) / 2, cm.width * sc, cm.height * sc);
        el.appendChild(cv);
        const price = document.createElement('span');
        price.className = 'bprice';
        price.textContent = '$' + b.price;
        el.appendChild(price);
        const hk = document.createElement('span');
        hk.className = 'hk';
        hk.textContent = b.hk;
        el.appendChild(hk);
      } else {
        el.innerHTML = `${b.t}${b.cd ? `<span class="cdnum">${b.cd}</span>` : ''}<span class="hk">${b.hk}</span>`;
      }
      el.addEventListener('click', () => { this.audio.ensure(); b.fn(); this.audio.sfx('click'); });
      cb.cmds.appendChild(el);
    }
  }

  autoHarvest(units) {
    const g = this.g;
    for (const u of units) {
      if (!u.harv) continue;
      const c = g.map.findOreNear((u.x / TILE) | 0, (u.y / TILE) | 0);
      if (c) u.orderHarvest(g, c.cx, c.cy);
    }
  }

  // ---------------- per-frame ----------------
  frame() {
    this.updateCursor();
    this.drawMinimap();
    this.sidebar.refresh();
    this.updateCmdbar();
  }

  // drag box + extra world-space UI, called inside game.render
  drawWorldUI(ctx) {
    if (this.mouse.dragging) {
      const cam = this.g.cam;
      const sx = (this.mouse.downWx - cam.x) * cam.zoom, sy = (this.mouse.downWy - cam.y) * cam.zoom;
      const x = Math.min(sx, this.mouse.x), y = Math.min(sy, this.mouse.y);
      const w = Math.abs(this.mouse.x - sx), h = Math.abs(this.mouse.y - sy);
      ctx.strokeStyle = 'rgba(53,232,216,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + .5, y + .5, w, h);
      ctx.fillStyle = 'rgba(53,232,216,0.08)';
      ctx.fillRect(x, y, w, h);
    }
  }
}
