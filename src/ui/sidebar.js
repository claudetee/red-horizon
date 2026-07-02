// RED HORIZON — sidebar: build tabs, cameo grid, credits ticker, power bar, radar box.

import { BUILDINGS, UNITS, BUILD_TIME, PLAYER } from '../game/data.js';
import { cameo } from '../engine/assets.js';
import { fmtTime } from '../engine/core.js';

// buildings are erected via the engineer's build menu on the command bar;
// the sidebar is pure unit production (barracks / war factory / conyard)
const TABS = {
  inf: ['rifle', 'rocket'],
  veh: ['builder', 'buggy', 'harvester', 'tank', 'heavy'],
};
export const BUILD_MENU = ['power', 'refinery', 'barracks', 'factory', 'radar', 'turret', 'repair'];

export class Sidebar {
  constructor(game, audio) {
    this.g = game;
    this.audio = audio;
    this.activeTab = 'build';
    this.items = new Map();     // key -> {el, prog, count, ready}
    this.dispCredits = game.credits[PLAYER];
    this.grid = document.getElementById('buildgrid');
    this.elCredits = document.getElementById('credits');
    this.elClock = document.getElementById('clockbar');
    this.elPowerFill = document.getElementById('powerfill');
    this.elPowerMark = document.getElementById('powermark');
    this.elPowerText = document.getElementById('powertext');
    this.elPowerBar = document.getElementById('powerbar');
    this.elRadarOff = document.getElementById('radar-offline');
    this.tooltip = document.getElementById('tooltip');

    document.querySelectorAll('#tabs .tab').forEach(b => {
      b.addEventListener('click', () => { this.setTab(b.dataset.tab); this.audio.sfx('click'); });
    });
    this.setGame(game);
  }

  setGame(game) {
    this.g = game;
    game.onSidebarDirty = () => this.rebuild();
    this.dispCredits = game.credits[0];
    this.elCredits.textContent = Math.floor(this.dispCredits);
    this.activeTab = 'inf';
    document.querySelectorAll('#tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'inf'));
    this.rebuild();
  }

  setTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('#tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    this.rebuild();
  }

  cycleTab() {
    const order = ['inf', 'veh'];
    this.setTab(order[(order.indexOf(this.activeTab) + 1) % order.length]);
  }

  dataOf(key) { return BUILDINGS[key] || UNITS[key]; }

  rebuild() {
    this.grid.innerHTML = '';
    this.items.clear();
    for (const key of TABS[this.activeTab]) {
      const d = this.dataOf(key);
      const el = document.createElement('div');
      el.className = 'bitem';
      const cv = document.createElement('canvas');
      cv.width = 100; cv.height = 86;
      const cctx = cv.getContext('2d');
      cctx.drawImage(cameo(d.sprite), 0, 0);
      el.appendChild(cv);
      const nm = document.createElement('div');
      nm.className = 'bname'; nm.textContent = d.cn.replace(/ /g, '');
      el.appendChild(nm);
      const cost = document.createElement('div');
      cost.className = 'bcost'; cost.textContent = '$' + d.cost;
      el.appendChild(cost);
      const hk = document.createElement('div');
      hk.className = 'bhotkey'; hk.textContent = d.hotkey || '';
      el.appendChild(hk);
      const prog = document.createElement('div');
      prog.className = 'bprog'; prog.style.display = 'none';
      el.appendChild(prog);
      const rdy = document.createElement('div');
      rdy.className = 'bready'; rdy.style.display = 'none'; rdy.textContent = 'READY 放置';
      el.appendChild(rdy);
      const cnt = document.createElement('div');
      cnt.className = 'bcount'; cnt.style.display = 'none';
      el.appendChild(cnt);

      el.addEventListener('click', () => this.clickItem(key));
      el.addEventListener('contextmenu', e => { e.preventDefault(); this.rightClickItem(key); });
      el.addEventListener('mouseenter', e => this.showTip(key, el));
      el.addEventListener('mousemove', e => this.moveTip(e));
      el.addEventListener('mouseleave', () => this.hideTip());
      this.grid.appendChild(el);
      this.items.set(key, { el, prog, cnt, rdy });
    }
    this.refresh();
  }

  clickItem(key) {
    const g = this.g;
    if (!g.prereqsMet(key)) { this.audio.sfx('deny'); return; }
    // routes to the least-busy matching factory (per-building queues)
    if (!g.startProduction(key)) this.audio.sfx('deny');
  }

  rightClickItem(key) {
    const g = this.g;
    const facs = g.factoriesFor ? g.factoriesFor(key) : [];
    // prefer cancelling a queued (non-active) copy, then an active head
    for (const b of facs) {
      if (b.queue.lastIndexOf(key) > 0) { b.cancelQueued(g, key); this.audio.sfx('click'); return; }
    }
    for (const b of facs) {
      if (b.queue[0] === key) { b.cancelQueued(g, key); this.audio.sfx('click'); return; }
    }
  }

  showTip(key, el) {
    const d = this.dataOf(key);
    const isB = !!BUILDINGS[key];
    const pre = (isB ? d.prereq : d.prereqBld) || [];
    const preTxt = pre.length ? `需要：${pre.map(p => BUILDINGS[p].cn.replace(/ /g, '')).join('、')}` : '';
    const met = this.g.prereqsMet(key);
    const noBuilder = isB && !this.g.hasBuilder();
    this.tooltip.innerHTML = `
      <div class="tt-name">${d.cn.replace(/ /g, '')} <span style="color:#79879a;font-size:10px">${d.en}</span></div>
      <div class="tt-cost">$${d.cost}${isB && d.power ? ` · 电力 ${d.power > 0 ? '+' : ''}${d.power}` : ''}</div>
      <div class="tt-desc">${d.desc}</div>
      ${preTxt && !met ? `<div class="tt-req">${preTxt}</div>` : ''}
      ${noBuilder ? `<div class="tt-req">需要：工程车（战车页签 Q 生产）</div>` : ''}`;
    this.tooltip.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    this.tooltip.style.left = (r.left - this.tooltip.offsetWidth - 10) + 'px';
    this.tooltip.style.top = r.top + 'px';
  }
  moveTip() {}
  hideTip() { this.tooltip.classList.add('hidden'); }

  // called every frame
  refresh() {
    const g = this.g;
    // credits ticker
    const target = Math.floor(g.credits[PLAYER]);
    if (this.dispCredits !== target) {
      const diff = target - this.dispCredits;
      this.dispCredits += Math.abs(diff) < 4 ? diff : Math.ceil(Math.abs(diff) * 0.14) * Math.sign(diff);
      this.elCredits.textContent = Math.floor(this.dispCredits);
    }
    this.elClock.textContent = fmtTime(g.time);

    // power
    const p = g.power[PLAYER];
    const scale = Math.max(100, p.out * 1.25, p.use * 1.25);
    this.elPowerFill.style.width = Math.min(100, p.out / scale * 100) + '%';
    this.elPowerMark.style.left = Math.min(98, p.use / scale * 100) + '%';
    this.elPowerText.textContent = `${p.use}/${p.out}`;
    this.elPowerBar.classList.toggle('low', p.out < p.use);

    // radar
    this.elRadarOff.classList.toggle('hidden', g.hasRadar());

    // items — aggregate across all factories of this unit type
    for (const [key, it] of this.items) {
      const met = g.prereqsMet(key);
      it.el.classList.toggle('disabled', !met);
      const facs = g.factoriesFor(key);
      let queuedN = 0, bestFrac = -1;
      for (const b of facs) {
        for (const k of b.queue) if (k === key) queuedN++;
        if (b.queue[0] === key) {
          const frac = Math.min(1, b.prodT / BUILD_TIME(UNITS[key].cost));
          if (frac > bestFrac) bestFrac = frac;
        }
      }
      if (bestFrac >= 0) {
        it.prog.style.display = '';
        it.prog.style.background = `conic-gradient(transparent ${bestFrac}turn, rgba(8,12,18,0.78) ${bestFrac}turn)`;
        it.el.classList.add('active-build');
      } else {
        it.prog.style.display = 'none';
        it.el.classList.remove('active-build');
      }
      it.rdy.style.display = 'none';
      it.el.classList.remove('ready');
      if (queuedN > 0) {
        it.cnt.style.display = '';
        it.cnt.textContent = 'x' + queuedN;
      } else it.cnt.style.display = 'none';
    }
  }
}
