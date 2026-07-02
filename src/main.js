// RED HORIZON — boot, screens flow, fixed-step loop.

import { DT, fmtTime } from './engine/core.js';
import { loadAssets } from './engine/assets.js';
import { AudioSys } from './engine/audio.js';
import { CameraRig } from './engine/input.js';
import { Game } from './game/game.js';
import { Sidebar } from './ui/sidebar.js';
import { HUD } from './ui/hud.js';
import { TIPS, PLAYER, ENEMY } from './game/data.js';
import { NetSession } from './net/net.js';

const $ = id => document.getElementById(id);
const screens = ['loading', 'title', 'brief', 'howto', 'pause', 'settings', 'end', 'mp'];
function showScreen(name) {
  for (const s of screens) $(`screen-${s}`).classList.toggle('hidden', s !== name);
  if (!name) for (const s of screens) $(`screen-${s}`).classList.add('hidden');
}

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

const settings = Object.assign(
  { sfx: 80, music: 55, eva: true, crt: true, edge: true },
  JSON.parse(localStorage.getItem('rh_settings') || '{}')
);
function saveSettings() { localStorage.setItem('rh_settings', JSON.stringify(settings)); }

const audio = new AudioSys();
let game = null, sidebar = null, hud = null, rig = null;
let raf = 0, lastT = 0, acc = 0;
let settingsBack = 'title';
let net = null, mpRole = null;

function applySettings() {
  audio.setVolumes(settings.sfx / 100, settings.music / 100);
  audio.evaEnabled = settings.eva;
  $('crt').classList.toggle('off', !settings.crt);
  if (rig) rig.edgeScroll = settings.edge;
  $('set-sfx').value = settings.sfx;
  $('set-music').value = settings.music;
  $('set-eva').checked = settings.eva;
  $('set-crt').checked = settings.crt;
  $('set-edge').checked = settings.edge;
}

function resize() {
  const vp = $('viewport');
  const cv = $('game');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = vp.clientWidth * dpr;
  cv.height = vp.clientHeight * dpr;
  cv.__dpr = dpr;
}
window.addEventListener('resize', resize);

function newGame(difficulty, mapKey = 'wasteland', paceKey = 'standard') {
  const seed = params.has('seed') ? Number(params.get('seed')) : ((Math.random() * 1e9) | 0);
  launchGame({ difficulty, seed, mapKey, pace: paceKey, debug: DEBUG });
}

function startPvp(cfg, localPlayer) {
  launchGame({
    difficulty: 'normal', seed: cfg.seed, mapKey: cfg.mapKey, pace: cfg.pace,
    pvp: true, localPlayer, debug: false,
  }, net);
}

function launchGame(opts, netSession = null) {
  cancelAnimationFrame(raf);
  const cv = $('game');
  game = new Game(cv, audio, opts);
  game.net = netSession;
  audio.game = game;
  audio.combatHeat = 0;
  if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) {} }
  if (!rig) rig = new CameraRig(game, $('viewport'));
  else rig.setGame(game);
  rig.edgeScroll = settings.edge;
  if (!sidebar) sidebar = new Sidebar(game, audio);
  else sidebar.setGame(game);
  if (!hud) hud = new HUD(game, audio, sidebar, rig, $('viewport'));
  else hud.setGame(game);
  hud.onEsc = () => {
    if (!game || game.over) return;
    if (!game.net) game.paused = true;   // no pausing a live PVP match
    showScreen('pause');
  };
  game.onEnd = won => {
    setTimeout(() => {
      $('end-title').textContent = won ? '胜  利' : '战  败';
      $('end-title').className = won ? 'win' : 'lose';
      const s = game.stats[PLAYER];
      const es = game.stats[ENEMY];
      const ratio = s.kills / Math.max(1, s.lost);
      const rank = won
        ? (ratio > 3 ? '铁幕元帅' : ratio > 1.5 ? '装甲统帅' : '战地指挥官')
        : (s.kills > 10 ? '悲壮抵抗' : '新兵蛋子');
      $('end-stats').innerHTML = `
        <div class="sk">战斗时间</div><div class="sv">${fmtTime(game.time)}</div>
        <div class="sk">生产单位/建筑</div><div class="sv">${s.built}</div>
        <div class="sk">击杀敌方</div><div class="sv">${s.kills}</div>
        <div class="sk">损失</div><div class="sv">${s.lost}</div>
        <div class="sk">采矿收入</div><div class="sv">$${Math.floor(s.mined)}</div>
        <div class="sk">敌军击杀</div><div class="sv">${es.kills}</div>
        <div class="sk">战果评定</div><div class="sv">${rank}</div>`;
      showScreen('end');
    }, 1600);
  };
  $('app').classList.remove('hidden');
  showScreen(null);
  resize();
  audio.ensure();
  audio.startMusic();
  lastT = performance.now(); acc = 0;
  loop(lastT);
}

function loop(t) {
  raf = requestAnimationFrame(loop);
  const dtReal = Math.min(0.25, (t - lastT) / 1000);
  lastT = t;
  if (!game) return;
  if (!game.paused && !game.over) {
    acc += dtReal;
    let n = 0;
    if (game.net) {
      // lockstep: only advance into ticks whose turn bundles have arrived
      const lim = game.net.maxTick();
      while (acc >= DT && game.tick < lim && n < 6) {
        game.net.beforeTick(game);
        game.update();
        acc -= DT; n++;
      }
      if (game.tick >= game.net.maxTick()) acc = Math.min(acc, DT * 2);
      game.net.pump(game);
      const stalled = !game.over && game.tick >= game.net.maxTick();
      game.net.stallT = stalled ? (game.net.stallT || 0) + dtReal : 0;
      $('net-wait').classList.toggle('hidden', !(game.net.stallT > 0.45));
      // hard-kill detection: WebRTC close events are unreliable when the peer's
      // process dies — a lockstep stall this long means the opponent is gone
      if (game.net.stallT > 9 && !game.net.closed) {
        game.net.closed = true;
        hud && hud.banner('对方已断开连接', 'gold');
        game.surrender(1 - game.localPlayer);
        $('net-wait').classList.add('hidden');
      }
    } else {
      while (acc >= DT && n < 6) { game.update(); acc -= DT; n++; }
      if (n >= 6) acc = 0; // panic drop after tab-away
    }
  } else if (game.over) {
    // keep simulation particles alive lightly
    acc += dtReal;
    while (acc >= DT) { game.combat.update(); acc -= DT; }
  }
  if (rig && !game.paused && !game.over) rig.update(dtReal);
  const cv = $('game');
  const dpr = cv.__dpr || 1;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const vw = cv.width / dpr, vh = cv.height / dpr;
  game.render(game.paused ? 1 : acc / DT, vw, vh, c => hud.drawWorldUI(c));
  hud.frame();
}

// ---------------- boot ----------------
window.addEventListener('error', e => {
  const ls = $('screen-loading');
  if (ls && !ls.classList.contains('hidden')) {
    $('loadtext').textContent = '加载出错：' + (e.message || '未知错误') + ' — 请刷新重试';
  }
});

async function boot() {
  showScreen('loading');
  const tipEl = $('loadtext');
  let tipI = 0;
  const tipTimer = setInterval(() => {
    tipEl.textContent = TIPS[tipI++ % TIPS.length];
  }, 1600);
  try {
    await loadAssets(f => { $('loadfill').style.width = Math.round(f * 100) + '%'; });
  } catch (e) {
    tipEl.textContent = '资源加载失败：' + e.message;
    clearInterval(tipTimer);
    return;
  }
  clearInterval(tipTimer);
  applySettings();
  showScreen('title');
}

// menu wiring
$('bt-skirmish').addEventListener('click', () => { audio.ensure(); audio.sfx('click'); showScreen('brief'); });
$('bt-howto').addEventListener('click', () => { audio.ensure(); audio.sfx('click'); showScreen('howto'); });
$('bt-howto-back').addEventListener('click', () => { audio.sfx('click'); showScreen('title'); });
$('bt-settings').addEventListener('click', () => { audio.ensure(); audio.sfx('click'); settingsBack = 'title'; showScreen('settings'); });
$('bt-brief-back').addEventListener('click', () => { audio.sfx('click'); showScreen('title'); });
$('bt-launch').addEventListener('click', () => {
  audio.ensure(); audio.sfx('ready');
  const diff = document.querySelector('input[name=diff]:checked').value;
  const mapKey = document.querySelector('input[name=map]:checked').value;
  const paceKey = document.querySelector('input[name=pace]:checked').value;
  if (mpRole === 'host' && net && net.conn) {
    const cfg = { seed: (Math.random() * 1e9) | 0, mapKey, pace: paceKey };
    net.start(cfg);
    startPvp(cfg, 0);
    return;
  }
  newGame(diff, mapKey, paceKey);
});
$('bt-resume').addEventListener('click', () => { audio.sfx('click'); game.paused = false; showScreen(null); });
$('bt-restart').addEventListener('click', () => {
  audio.sfx('click');
  if (game && game.net) { quitToTitle(); return; }   // no restarting a live PVP match
  showScreen('brief');
});
$('bt-pause-settings').addEventListener('click', () => { audio.sfx('click'); settingsBack = 'pause'; showScreen('settings'); });
$('bt-quit').addEventListener('click', () => quitToTitle());
$('bt-again').addEventListener('click', () => {
  audio.sfx('click');
  if (game && game.net) { quitToTitle(); return; }
  showScreen('brief');
});
$('bt-end-quit').addEventListener('click', () => quitToTitle());
$('bt-set-back').addEventListener('click', () => {
  audio.sfx('click');
  showScreen(settingsBack === 'pause' ? 'pause' : 'title');
});

function quitToTitle() {
  audio.sfx('click');
  audio.stopMusic();
  cancelAnimationFrame(raf);
  if (net) { try { net.close(); } catch (e) {} net = null; mpRole = null; }
  $('net-wait').classList.add('hidden');
  game = null;
  if (hud) hud.enabled = false;
  $('app').classList.add('hidden');
  showScreen('title');
}

// ---------------- multiplayer lobby ----------------
function wireNet(n) {
  n.onClose = () => {
    if (game && game.net === n && !game.over) {
      hud && hud.banner('对方已断开连接', 'gold');
      game.surrender(1 - game.localPlayer);
    } else if (!game) {
      $('mp-status').textContent = '连接已断开';
    }
  };
  n.onDesync = turn => {
    window.__desynced = true;
    if (game && !game.over) {
      hud && hud.banner('同步校验失败 — 对战中止');
      game.over = true;
      game.onEnd && game.onEnd(false);
    }
  };
  n.onError = e => {
    $('mp-status').textContent = '连接失败：' + (e && (e.type || e.message) || '未知错误');
  };
}

// test/diagnostic peek at lobby state
window.__mp = () => ({ role: mpRole, hasNet: !!net, conn: !!(net && net.conn), open: !!(net && net.conn && net.conn.open) });

function mpShowChoose() {
  $('mp-choose').classList.remove('hidden');
  $('mp-wait').classList.add('hidden');
}

$('bt-mp').addEventListener('click', () => {
  audio.ensure(); audio.sfx('click');
  mpShowChoose();
  showScreen('mp');
});
$('bt-mp-back').addEventListener('click', () => {
  audio.sfx('click');
  if (net) { net.close(); net = null; }
  showScreen('title');
});
$('bt-mp-cancel').addEventListener('click', () => {
  audio.sfx('click');
  if (net) { net.close(); net = null; }
  mpShowChoose();
});
$('bt-mp-host').addEventListener('click', async () => {
  audio.ensure(); audio.sfx('click');
  const code = params.get('mpcode') || NetSession.makeCode();   // fixed code for automated tests
  net = new NetSession();
  wireNet(net);
  mpRole = 'host';
  $('mp-choose').classList.add('hidden');
  $('mp-wait').classList.remove('hidden');
  $('mp-code-show').textContent = code;
  $('mp-status').textContent = '正在连接信令服务器…';
  net.onPeer = () => {
    $('mp-status').textContent = '对手已连接！正在进入战场设置…';
    audio.sfx('ready');
    setTimeout(() => showScreen('brief'), 700);
  };
  try {
    await net.host(code);
    $('mp-status').textContent = '房间已创建 — 把房间码告诉对手';
  } catch (e) { /* onError shows it */ }
});
$('bt-mp-join').addEventListener('click', async () => {
  audio.ensure(); audio.sfx('click');
  const code = ($('mp-code-in').value || '').trim().toUpperCase();
  if (code.length < 4) { $('mp-code-in').focus(); return; }
  net = new NetSession();
  wireNet(net);
  mpRole = 'join';
  $('mp-choose').classList.add('hidden');
  $('mp-wait').classList.remove('hidden');
  $('mp-code-show').textContent = code;
  $('mp-status').textContent = '正在连接房主…';
  net.onPeer = () => {
    $('mp-status').textContent = '已连接 — 等待房主选择战场…';
    audio.sfx('ready');
  };
  net.onStart = cfg => {
    startPvp(cfg, 1);
  };
  try {
    await net.join(code);
  } catch (e) { /* onError shows it */ }
});

// settings live-binding
$('set-sfx').addEventListener('input', e => { settings.sfx = +e.target.value; applySettings(); saveSettings(); });
$('set-music').addEventListener('input', e => { settings.music = +e.target.value; applySettings(); saveSettings(); });
$('set-eva').addEventListener('change', e => { settings.eva = e.target.checked; applySettings(); saveSettings(); });
$('set-crt').addEventListener('change', e => { settings.crt = e.target.checked; applySettings(); saveSettings(); });
$('set-edge').addEventListener('change', e => { settings.edge = e.target.checked; applySettings(); saveSettings(); });

$('app').addEventListener('contextmenu', e => e.preventDefault());

// pause on Esc handled by hud; global Esc on pause screen resumes.
// stopImmediatePropagation: HUD's later-registered keydown must not see this same
// event, or it would re-pause the game it just resumed.
window.addEventListener('keydown', e => {
  if (e.code === 'Escape' && game && game.paused && !$('screen-pause').classList.contains('hidden')) {
    game.paused = false; showScreen(null);
    e.stopImmediatePropagation();
  }
});

boot();
