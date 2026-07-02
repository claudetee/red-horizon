// RED HORIZON — procedural audio: WebAudio synth SFX, adaptive chiptune score, EVA voice.

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null; this.sfxBus = null; this.musicBus = null;
    this.sfxVol = 0.8; this.musicVol = 0.55;
    this.evaEnabled = true;
    this.noiseBuf = null;
    this.throttle = new Map();
    this.game = null;
    this.musicOn = false;
    this.combatHeat = 0;
    this._seq = null;
    this._voice = null;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVol;
    this.musicBus.connect(this.master);
    // shared noise buffer
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // EVA voice pick (zh preferred)
    if ('speechSynthesis' in window) {
      const pickVoice = () => {
        const vs = speechSynthesis.getVoices();
        this._voice = vs.find(v => /zh[-_]CN/i.test(v.lang)) || vs.find(v => /^zh/i.test(v.lang)) || null;
      };
      pickVoice();
      speechSynthesis.onvoiceschanged = pickVoice;
    }
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
    });
  }

  setVolumes(sfx, music) {
    this.sfxVol = sfx; this.musicVol = music;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
    if (this.musicBus) this.musicBus.gain.value = music;
  }

  // spatialized gain/pan relative to camera center
  _spatial(opts) {
    let vol = opts.vol ?? 1, pan = 0;
    if (this.game && opts.x !== undefined) {
      const cam = this.game.cam;
      const dpr = this.game.canvas.__dpr || 1;
      const vw = this.game.canvas.width / dpr;
      const vh = this.game.canvas.height / dpr;
      const cx = cam.x + vw / cam.zoom / 2, cy = cam.y + vh / cam.zoom / 2;
      const dx = opts.x - cx, dy = opts.y - cy;
      const d = Math.hypot(dx, dy);
      const maxD = 1500;
      vol *= Math.max(0.06, 1 - d / maxD);
      pan = Math.max(-0.8, Math.min(0.8, dx / 900));
    }
    return { vol, pan };
  }

  _chain(opts, dur) {
    const g = this.ctx.createGain();
    const { vol, pan } = this._spatial(opts || {});
    g.gain.value = vol;
    let node = g;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p); p.connect(this.sfxBus);
    } else g.connect(this.sfxBus);
    return g;
  }

  _noise(dur, filterType, freq, q, out, when = 0, sweepTo = null) {
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(1, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(env); env.connect(out);
    src.start(t); src.stop(t + dur + 0.05);
  }

  _tone(type, f0, f1, dur, out, when = 0, gain = 1) {
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(env); env.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  sfx(name, opts = {}) {
    if (!this.ctx) return;
    const now = performance.now();
    const last = this.throttle.get(name) || 0;
    const minGap = { mg: 45, mg2: 40, hit: 50, mine: 90 }[name] ?? 60;
    if (now - last < minGap) return;
    this.throttle.set(name, now);

    switch (name) {
      case 'mg': {
        const out = this._chain(opts, 0.08); out.gain.value *= 0.5;
        this._noise(0.07, 'bandpass', 1900, 1.2, out);
        this._tone('square', 220, 90, 0.05, out, 0, 0.4);
        break;
      }
      case 'mg2': {
        const out = this._chain(opts, 0.08); out.gain.value *= 0.45;
        this._noise(0.06, 'bandpass', 2500, 1.5, out);
        this._tone('square', 300, 120, 0.045, out, 0, 0.35);
        break;
      }
      case 'cannon': case 'cannon2': {
        const big = name === 'cannon2';
        const out = this._chain(opts, 0.4); out.gain.value *= big ? 0.85 : 0.7;
        this._tone('sine', big ? 110 : 130, 38, big ? 0.3 : 0.22, out, 0, 1);
        this._noise(big ? 0.24 : 0.18, 'lowpass', 900, 0.8, out, 0, 220);
        break;
      }
      case 'rocket': {
        const out = this._chain(opts, 0.5); out.gain.value *= 0.5;
        this._noise(0.4, 'bandpass', 500, 1.4, out, 0, 2200);
        break;
      }
      case 'hit': {
        const out = this._chain(opts, 0.16); out.gain.value *= 0.5;
        this._noise(0.12, 'highpass', 1400, 1, out);
        this._tone('triangle', 500, 120, 0.1, out, 0, 0.5);
        break;
      }
      case 'boom': {
        const out = this._chain(opts, 0.7); out.gain.value *= 0.9;
        this._tone('sine', 150, 30, 0.5, out, 0, 1);
        this._noise(0.55, 'lowpass', 700, 0.6, out, 0, 90);
        break;
      }
      case 'bigboom': {
        const out = this._chain(opts, 1.4); out.gain.value *= 1.0;
        this._tone('sine', 120, 24, 0.9, out, 0, 1.1);
        this._noise(1.1, 'lowpass', 600, 0.5, out, 0, 60);
        this._noise(0.4, 'bandpass', 2400, 1, out, 0.05);
        break;
      }
      case 'die_inf': {
        const out = this._chain(opts, 0.2); out.gain.value *= 0.42;
        this._tone('sawtooth', 420, 70, 0.16, out, 0, 0.7);
        break;
      }
      case 'mine': {
        const out = this._chain(opts, 0.2); out.gain.value *= 0.33;
        this._noise(0.14, 'lowpass', 500, 0.8, out);
        break;
      }
      case 'cash': {
        const out = this._chain(opts, 0.3); out.gain.value *= 0.5;
        this._tone('square', 880, 880, 0.06, out, 0, 0.35);
        this._tone('square', 1318, 1318, 0.09, out, 0.07, 0.3);
        break;
      }
      case 'ready': {
        const out = this._chain(opts, 0.4); out.gain.value *= 0.5;
        this._tone('square', 659, 659, 0.08, out, 0, 0.32);
        this._tone('square', 987, 987, 0.14, out, 0.09, 0.3);
        break;
      }
      case 'click': {
        const out = this._chain(opts, 0.05); out.gain.value *= 0.5;
        this._tone('square', 1200, 900, 0.03, out, 0, 0.3);
        break;
      }
      case 'deny': {
        const out = this._chain(opts, 0.2); out.gain.value *= 0.5;
        this._tone('square', 160, 120, 0.16, out, 0, 0.4);
        break;
      }
      case 'place': {
        const out = this._chain(opts, 0.3); out.gain.value *= 0.8;
        this._tone('sine', 160, 50, 0.2, out, 0, 0.9);
        this._noise(0.14, 'lowpass', 1200, 1, out);
        break;
      }
      case 'sell': {
        const out = this._chain(opts, 0.35); out.gain.value *= 0.5;
        this._tone('square', 1318, 1318, 0.07, out, 0, 0.3);
        this._tone('square', 880, 880, 0.07, out, 0.08, 0.3);
        this._tone('square', 587, 587, 0.1, out, 0.16, 0.3);
        break;
      }
      case 'ack': {
        const out = this._chain(opts, 0.12); out.gain.value *= 0.4;
        this._noise(0.03, 'highpass', 3000, 1, out);
        this._tone('square', 620, 660, 0.07, out, 0.02, 0.25);
        break;
      }
      case 'tesla': {
        const out = this._chain(opts, 0.3); out.gain.value *= 0.65;
        this._tone('sawtooth', 2800, 180, 0.16, out, 0, 0.5);
        this._noise(0.2, 'highpass', 3200, 1.2, out);
        this._tone('square', 90, 55, 0.22, out, 0, 0.35);
        break;
      }
      case 'ack2': {
        const out = this._chain(opts, 0.15); out.gain.value *= 0.4;
        this._noise(0.03, 'highpass', 3000, 1, out);
        this._tone('square', 520, 520, 0.05, out, 0.02, 0.25);
        this._tone('square', 780, 780, 0.06, out, 0.08, 0.25);
        break;
      }
    }
  }

  ack(attack = false) {
    // rate-limited unit acknowledgment
    const now = performance.now();
    if (now - (this._ackT || 0) < 220) return;
    this._ackT = now;
    this.sfx(attack ? 'ack2' : 'ack');
  }

  eva(text) {
    if (!this.evaEnabled || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (this._voice) u.voice = this._voice;
      u.lang = 'zh-CN';
      u.rate = 1.02; u.pitch = 0.62; u.volume = Math.min(1, this.sfxVol + 0.1);
      speechSynthesis.speak(u);
    } catch (e) { /* no voice available */ }
  }

  // ---------------- adaptive chiptune ----------------
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    const ctx = this.ctx;
    const bpm = 118;
    const stepDur = 60 / bpm / 4;      // 16th notes
    let step = 0;
    let nextT = ctx.currentTime + 0.06;

    // A harmonic minor flavored progression: Am | F | C | E
    const roots = [110.0, 87.31, 65.41, 82.41];        // A2 F2 C2 E2
    const scale = [0, 2, 3, 5, 7, 8, 11];              // A minor-ish semitones
    const bassPat = [0, 0, 7, 0, 0, 0, 5, 7];
    const leadRiff = [0, 3, 7, 10, 7, 3, 0, -2, 0, 3, 7, 12, 10, 7, 3, 0];

    const noteHz = (rootHz, semi) => rootHz * Math.pow(2, semi / 12);

    const playStep = (s, t) => {
      const bar = (s / 16 | 0) % 4;
      const pos = s % 16;
      const root = roots[bar];
      const heat = this.combatHeat;

      // drums
      if (pos % 4 === 0) { // kick
        this._mTone('sine', 120, 34, 0.14, t, 0.5);
      }
      if (pos % 8 === 4) { // snare
        this._mNoise(0.09, 'bandpass', 1800, 1, t, 0.22);
      }
      if (pos % 2 === 1) { // hats
        this._mNoise(0.03, 'highpass', 6000, 1, t, heat > 0.3 ? 0.1 : 0.06);
      }
      if (heat > 0.5 && pos % 4 === 2) { // combat extra kick
        this._mTone('sine', 100, 30, 0.1, t, 0.4);
      }

      // bass
      const bSemi = bassPat[pos % 8];
      if (pos % 2 === 0) this._mTone('triangle', noteHz(root, bSemi), noteHz(root, bSemi), stepDur * 1.7, t, 0.30);

      // lead arp (drop at low intensity every other 2 bars)
      const leadOn = (s / 32 | 0) % 2 === 0 || heat > 0.25;
      if (leadOn) {
        const semi = leadRiff[pos] + 12 + (heat > 0.6 ? 12 : 0);
        this._mTone('square', noteHz(root * 2, semi), noteHz(root * 2, semi), stepDur * 0.9, t, heat > 0.25 ? 0.09 : 0.06);
      }
      // pad swell at bar start
      if (pos === 0) {
        this._mTone('sawtooth', noteHz(root, 0) * 2, noteHz(root, 0) * 2, stepDur * 14, t, 0.028);
        this._mTone('sawtooth', noteHz(root, 7) * 2, noteHz(root, 7) * 2, stepDur * 14, t, 0.022);
      }
    };

    this._seq = setInterval(() => {
      if (!this.musicOn) return;
      while (nextT < ctx.currentTime + 0.14) {
        playStep(step, nextT);
        nextT += stepDur;
        step++;
      }
      // decay combat heat
      this.combatHeat = Math.max(0, this.combatHeat - 0.012);
    }, 42);
  }

  stopMusic() {
    this.musicOn = false;
    if (this._seq) { clearInterval(this._seq); this._seq = null; }
  }

  _mTone(type, f0, f1, dur, when, gain) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, when);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(gain, when + 0.008);
    env.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(env); env.connect(this.musicBus);
    o.start(when); o.stop(when + dur + 0.03);
  }
  _mNoise(dur, type, freq, q, when, gain) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    src.playbackRate.value = 1;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, when);
    env.gain.exponentialRampToValueAtTime(0.001, when + dur);
    src.connect(f); f.connect(env); env.connect(this.musicBus);
    src.start(when); src.stop(when + dur + 0.03);
  }

  noteCombat() { this.combatHeat = Math.min(1, this.combatHeat + 0.08); }

  endJingle(win) {
    if (!this.ctx) return;
    this.stopMusic();
    const t0 = this.ctx.currentTime + 0.1;
    const seq = win ? [[523, 0], [659, 0.14], [784, 0.28], [1046, 0.42, 0.5]] : [[392, 0], [330, 0.2], [262, 0.4], [196, 0.6, 0.7]];
    for (const [f, dt, dur] of seq) {
      this._mTone('square', f, f, dur || 0.16, t0 + dt, 0.22);
      this._mTone('triangle', f / 2, f / 2, dur || 0.16, t0 + dt, 0.2);
    }
  }
}
