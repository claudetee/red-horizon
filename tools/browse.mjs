#!/usr/bin/env node
// RED HORIZON — zero-dep browser driver over CDP (uses Node>=21 global WebSocket
// + playwright's bundled chromium headless shell). For automated smoke tests & playtests.
//
// Usage: node browse.mjs steps.json
// steps.json: [
//   {"goto": "http://..."}, {"wait": 1200}, {"shot": "/tmp/x.png"},
//   {"click": [640, 400]}, {"rclick": [640,400]}, {"dblclick": [x,y]},
//   {"drag": [x0,y0,x1,y1]}, {"move": [x,y]},
//   {"key": "KeyA"}, {"keys": "Ctrl+Digit1"},
//   {"eval": "js expr"}, {"evalLog": "js expr"},
//   {"waitFor": "js expr that becomes truthy", "timeout": 8000},
//   {"size": [1600, 900]}
// ]
// Prints console messages & JS exceptions. Exit 0 on success, 3 on step failure.

import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const stepsFile = process.argv[2];
if (!stepsFile) { console.error('usage: node browse.mjs steps.json'); process.exit(1); }
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));

function findChrome() {
  const base = join(homedir(), '.cache/ms-playwright');
  const candidates = execSync(`ls -d ${base}/chromium_headless_shell-*/chrome-linux/headless_shell ${base}/chromium-*/chrome-linux/chrome 2>/dev/null || true`)
    .toString().trim().split('\n').filter(Boolean);
  if (!candidates.length) throw new Error('no chromium found under ~/.cache/ms-playwright');
  return candidates.sort().reverse()[0];
}

const W = Number(process.env.BROWSE_W || 1600), H = Number(process.env.BROWSE_H || 900);
const port = 9222 + (Math.random() * 500 | 0);
const profile = mkdtempSync(join(tmpdir(), 'rh-prof-'));
const chrome = findChrome();
const proc = spawn(chrome, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-sandbox', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  '--force-device-scale-factor=1',
  `--window-size=${W},${H}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderrBuf = '';
proc.stderr.on('data', d => { stderrBuf += d; });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('CDP not reachable. chrome stderr: ' + stderrBuf.slice(-800));
}

let msgId = 0;
const pending = new Map();
let ws;
const consoleLines = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function connect() {
  const url = await getWsUrl();
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
      else p.resolve(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      const args = (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
      consoleLines.push(`[console.${m.params.type}] ${args}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const ex = m.params.exceptionDetails;
      const desc = ex.exception?.description || ex.text || '';
      consoleLines.push(`[EXCEPTION] ${desc}`);
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
}

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}

async function mouse(type, x, y, button = 'left', clickCount = 1) {
  await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: button === 'left' ? 1 : button === 'right' ? 2 : 4 });
}
async function click(x, y, button = 'left', clickCount = 1) {
  await mouse('mouseMoved', x, y, 'none', 0);
  await mouse('mousePressed', x, y, button, clickCount);
  await sleep(30);
  await mouse('mouseReleased', x, y, button, clickCount);
}
async function key(code, modifiers = 0) {
  const keyMap = { Space: ' ', Escape: 'Escape', Tab: 'Tab', Enter: 'Enter' };
  const k = keyMap[code] || (code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, modifiers, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : undefined });
  await sleep(25);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, modifiers });
}

async function run() {
  await connect();
  let failed = null;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const label = JSON.stringify(s).slice(0, 90);
    try {
      if (s.goto) {
        await send('Page.navigate', { url: s.goto });
        // wait for load
        for (let k = 0; k < 100; k++) {
          const st = await evalJs('document.readyState').catch(() => 'x');
          if (st === 'complete') break;
          await sleep(100);
        }
      } else if (s.wait) await sleep(s.wait);
      else if (s.shot) {
        const r = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(s.shot, Buffer.from(r.data, 'base64'));
        console.log('  shot ->', s.shot);
      } else if (s.click) await click(s.click[0], s.click[1], 'left', 1);
      else if (s.rclick) await click(s.rclick[0], s.rclick[1], 'right', 1);
      else if (s.clickWorld || s.rclickWorld || s.dragWorld) {
        // convert world coords -> screen via live camera
        const conv = async (wx, wy) => await evalJs(`(() => { const g = window.__game; return [ (${wx} - g.cam.x) * g.cam.zoom, (${wy} - g.cam.y) * g.cam.zoom ]; })()`);
        if (s.clickWorld) { const [x, y] = await conv(s.clickWorld[0], s.clickWorld[1]); await click(x, y, 'left', 1); }
        else if (s.rclickWorld) { const [x, y] = await conv(s.rclickWorld[0], s.rclickWorld[1]); await click(x, y, 'right', 1); }
        else {
          const [x0, y0] = await conv(s.dragWorld[0], s.dragWorld[1]);
          const [x1, y1] = await conv(s.dragWorld[2], s.dragWorld[3]);
          await mouse('mouseMoved', x0, y0, 'none', 0);
          await mouse('mousePressed', x0, y0, 'left', 1);
          for (let k = 1; k <= 8; k++) { await mouse('mouseMoved', x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8, 'left', 0); await sleep(16); }
          await mouse('mouseReleased', x1, y1, 'left', 1);
        }
      }
      else if (s.dblclick) { await click(s.dblclick[0], s.dblclick[1], 'left', 1); await sleep(60); await click(s.dblclick[0], s.dblclick[1], 'left', 2); }
      else if (s.move) await mouse('mouseMoved', s.move[0], s.move[1], 'none', 0);
      else if (s.drag) {
        const [x0, y0, x1, y1] = s.drag;
        await mouse('mouseMoved', x0, y0, 'none', 0);
        await mouse('mousePressed', x0, y0, 'left', 1);
        const n = 8;
        for (let k = 1; k <= n; k++) {
          await mouse('mouseMoved', x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, 'left', 0);
          await sleep(16);
        }
        await mouse('mouseReleased', x1, y1, 'left', 1);
      }
      else if (s.key) await key(s.key);
      else if (s.keys) {
        const parts = s.keys.split('+');
        const mods = { Ctrl: 2, Shift: 8, Alt: 1 };
        let m = 0; let main = parts[parts.length - 1];
        for (const p of parts.slice(0, -1)) m |= mods[p] || 0;
        await key(main, m);
      }
      else if (s.evalLog) { const v = await evalJs(s.evalLog); console.log('  eval:', JSON.stringify(v)); }
      else if (s.eval) await evalJs(s.eval);
      else if (s.waitFor) {
        const t0 = Date.now();
        const timeout = s.timeout || 8000;
        for (;;) {
          const v = await evalJs(s.waitFor).catch(() => false);
          if (v) break;
          if (Date.now() - t0 > timeout) throw new Error('waitFor timeout: ' + s.waitFor);
          await sleep(150);
        }
      }
    } catch (e) {
      failed = `step ${i} ${label}: ${e.message}`;
      break;
    }
  }
  if (consoleLines.length) {
    console.log('--- console ---');
    for (const l of consoleLines.slice(-60)) console.log(l);
  }
  proc.kill('SIGKILL');
  if (failed) { console.error('FAILED:', failed); process.exit(3); }
  console.log('OK');
  process.exit(0);
}

run().catch(e => { console.error('driver error:', e.message); proc.kill('SIGKILL'); process.exit(2); });
