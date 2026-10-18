// 用 WebAudio 即時合成音效，不需要任何音檔。
(function () {
  const DG = (window.DG = window.DG || {});
  let ctx = null;
  let master = null;
  let muted = false;
  const lastPlay = {};

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // 同一種音效的最短間隔，避免上百隻兵同時打架時爆音
  function throttle(name, ms) {
    const now = performance.now();
    if (lastPlay[name] && now - lastPlay[name] < ms) return false;
    lastPlay[name] = now;
    return true;
  }

  function tone(freq, dur, type = 'square', vol = 0.2, slide = 0, delay = 0) {
    const c = ensure();
    if (!c || muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, vol = 0.3, filterFreq = 1200, delay = 0) {
    const c = ensure();
    if (!c || muted) return;
    const t = c.currentTime + delay;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }

  DG.Audio = {
    unlock: ensure,
    get muted() {
      return muted;
    },
    setMuted(v) {
      muted = v;
    },
    spawn() {
      if (throttle('spawn', 70)) tone(520 + Math.random() * 200, 0.08, 'triangle', 0.08, 300);
    },
    hit() {
      if (throttle('hit', 60)) noise(0.05, 0.08, 2500);
    },
    shoot() {
      if (throttle('shoot', 90)) tone(900, 0.06, 'sawtooth', 0.04, -500);
    },
    die() {
      if (throttle('die', 80)) tone(300, 0.15, 'square', 0.05, -220);
    },
    boom() {
      if (!throttle('boom', 90)) return;
      noise(0.6, 0.45, 700);
      tone(110, 0.5, 'sine', 0.35, -70);
    },
    thunder() {
      if (!throttle('thunder', 80)) return;
      noise(0.5, 0.4, 3500);
      tone(80, 0.4, 'sawtooth', 0.15, -40);
    },
    castleHit() {
      if (throttle('castle', 160)) tone(140, 0.12, 'square', 0.08, -60);
    },
    shield() {
      if (throttle('shield', 400)) [660, 880, 1320].forEach((f, i) => tone(f, 0.25, 'sine', 0.12, 0, i * 0.06));
    },
    freeze() {
      if (throttle('freeze', 400)) [1800, 1500, 2100, 1200].forEach((f, i) => tone(f, 0.3, 'triangle', 0.08, -300, i * 0.05));
    },
    heal() {
      if (throttle('heal', 400)) [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'sine', 0.12, 0, i * 0.07));
    },
    gift(tier) {
      if (!throttle('gift' + tier, tier >= 3 ? 600 : 150)) return;
      const seqs = {
        1: [784, 1046],
        2: [523, 784, 1046],
        3: [392, 523, 659, 784, 1046],
        4: [262, 392, 523, 659, 784, 1046, 1318],
      };
      (seqs[tier] || seqs[1]).forEach((f, i) => tone(f, 0.22, 'square', 0.1, 0, i * 0.07));
      if (tier >= 4) noise(1.2, 0.25, 900, 0.3);
    },
    roar() {
      tone(90, 1.2, 'sawtooth', 0.3, -40);
      noise(1.0, 0.3, 500);
    },
    win() {
      [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, 'square', 0.12, 0, i * 0.14));
    },
  };
})();
