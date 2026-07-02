// RED HORIZON — lockstep P2P session over WebRTC DataChannel (PeerJS signaling).
//
// Model: orders-only synchronization. Both peers run the same deterministic
// simulation; each collects local orders into "turns" of TURN_TICKS ticks and
// ships them DELAY turns ahead. Tick N*TURN_TICKS may only run once both
// players' order bundles for turn N have arrived — otherwise the sim stalls
// (render keeps going) until the packet lands. Every HASH_EVERY turns a state
// hash is exchanged to catch desyncs early.

const PEER_PREFIX = 'rh2026-v1-';
export const TURN_TICKS = 4;   // 133ms per turn at 30tps
const DELAY = 2;               // orders execute 2 turns after issue (~266ms)
const HASH_EVERY = 8;

function fnv(h, v) {
  h ^= v & 0xff; h = Math.imul(h, 0x01000193);
  h ^= (v >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
  h ^= (v >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
  h ^= (v >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  return h >>> 0;
}

export function stateHash(g) {
  let h = 0x811c9dc5;
  h = fnv(h, g.tick);
  h = fnv(h, g.credits[0] | 0);
  h = fnv(h, g.credits[1] | 0);
  for (const u of g.units) {
    h = fnv(h, u.id);
    h = fnv(h, (u.x * 8) | 0);
    h = fnv(h, (u.y * 8) | 0);
    h = fnv(h, u.hp | 0);
  }
  for (const b of g.buildings) {
    h = fnv(h, b.id);
    h = fnv(h, b.hp | 0);
    h = fnv(h, (b.progress * 255) | 0);
    h = fnv(h, b.queue.length);
  }
  return h;
}

export class NetSession {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.code = '';
    this.localBuf = [];
    this.turns = new Map();      // turn -> { 0: orders[], 1: orders[] }
    this.hashes = new Map();     // turn -> { mine, theirs }
    this.myTurnSent = -1;
    this.nextApply = 0;          // next turn awaiting application (scan cursor)
    this.stalled = false;
    this.stallT = 0;
    this.closed = false;
    // hooks
    this.onPeer = null; this.onStart = null; this.onClose = null;
    this.onError = null; this.onDesync = null;
  }

  static makeCode() {
    const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 5; i++) c += A[(Math.random() * A.length) | 0];
    return c;
  }

  _mkPeer(id) {
    if (typeof Peer === 'undefined') throw new Error('PeerJS 未加载（检查网络）');
    return new Peer(id, { debug: 1 });
  }

  host(code) {
    this.isHost = true;
    this.code = code;
    return new Promise((resolve, reject) => {
      try { this.peer = this._mkPeer(PEER_PREFIX + code); } catch (e) { reject(e); return; }
      this.peer.on('open', () => resolve(code));
      this.peer.on('error', e => { this.onError && this.onError(e); reject(e); });
      this.peer.on('connection', c => {
        if (this.conn) { c.close(); return; }
        this.conn = c;
        this._wire(c);
        c.on('open', () => this.onPeer && this.onPeer());
      });
    });
  }

  join(code) {
    this.isHost = false;
    this.code = code;
    return new Promise((resolve, reject) => {
      try { this.peer = this._mkPeer(undefined); } catch (e) { reject(e); return; }
      this.peer.on('error', e => { this.onError && this.onError(e); reject(e); });
      this.peer.on('open', () => {
        const c = this.peer.connect(PEER_PREFIX + code, { reliable: true });
        this.conn = c;
        this._wire(c);
        c.on('open', () => { this.onPeer && this.onPeer(); resolve(); });
        c.on('error', e => { this.onError && this.onError(e); reject(e); });
      });
    });
  }

  _wire(c) {
    c.on('data', m => this._handle(m));
    c.on('close', () => { if (!this.closed) { this.closed = true; this.onClose && this.onClose(); } });
  }

  send(m) { if (this.conn && this.conn.open) this.conn.send(m); }

  // host announces the match config; both sides then build the same Game
  start(cfg) {
    this.send({ t: 'start', cfg });
  }

  _handle(m) {
    if (m.t === 'start') { this.onStart && this.onStart(m.cfg); return; }
    if (m.t === 'turn') {
      const rec = this.turns.get(m.n) || {};
      const remote = this.isHost ? 1 : 0;
      // never trust the sender about whose orders these are
      rec[remote] = (m.o || []).map(o => ({ ...o, p: remote }));
      this.turns.set(m.n, rec);
      return;
    }
    if (m.t === 'hash') {
      const hh = this.hashes.get(m.n) || {};
      hh.theirs = m.h;
      this.hashes.set(m.n, hh);
      this._checkHash(m.n);
      return;
    }
    if (m.t === 'bye') { if (!this.closed) { this.closed = true; this.onClose && this.onClose(); } }
  }

  _checkHash(n) {
    const hh = this.hashes.get(n);
    if (!hh || hh.mine === undefined || hh.theirs === undefined) return;
    if (hh.mine !== hh.theirs) this.onDesync && this.onDesync(n);
    this.hashes.delete(n);
  }

  queueLocal(o) { this.localBuf.push(o); }

  // ship local order bundles up to (currentTurn + DELAY); record own copy
  pump(g) {
    const curTurn = Math.floor(g.tick / TURN_TICKS);
    const me = g.localPlayer;
    while (this.myTurnSent < curTurn + DELAY) {
      const n = ++this.myTurnSent;
      const orders = this.localBuf.splice(0);
      const rec = this.turns.get(n) || {};
      rec[me] = orders;
      this.turns.set(n, rec);
      this.send({ t: 'turn', n, o: orders });
    }
  }

  // sim may advance up to (but not into) the first turn missing either bundle;
  // scan starts at the application cursor — applied turns are gone from the map
  maxTick() {
    let n = this.nextApply;
    for (;;) {
      const rec = this.turns.get(n);
      if (!rec || rec[0] === undefined || rec[1] === undefined) return n * TURN_TICKS;
      n++;
    }
  }

  // called right before g.update() on a turn boundary: apply both bundles
  beforeTick(g) {
    if (g.tick % TURN_TICKS !== 0) return;
    const n = g.tick / TURN_TICKS;
    if (n !== this.nextApply) return;
    const rec = this.turns.get(n);
    if (!rec) return;
    // desync check: sample state at this exact aligned tick, BEFORE applying turn n
    if (n > 0 && n % HASH_EVERY === 0) {
      const h = stateHash(g);
      const hh = this.hashes.get(n) || {};
      hh.mine = h;
      this.hashes.set(n, hh);
      this.send({ t: 'hash', n, h });
      this._checkHash(n);
    }
    // host's orders first, then joiner's — identical order on both peers
    for (const p of [0, 1]) {
      for (const o of rec[p] || []) {
        g._orderPlayer = p;
        g.applyNetOrder(o);
      }
    }
    g._orderPlayer = g.localPlayer;
    this.turns.delete(n);
    this.nextApply = n + 1;
  }

  close() {
    this.closed = true;
    try { this.send({ t: 'bye' }); } catch (e) {}
    try { this.conn && this.conn.close(); } catch (e) {}
    try { this.peer && this.peer.destroy(); } catch (e) {}
  }
}
