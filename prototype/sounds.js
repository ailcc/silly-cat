// 音效包：喵叫、呼噜、砸键盘、敲碗、哈气声，全部用 WebAudio 现场合成，没有音频文件。
// window.SillySounds.play('meow') 单响；startPurr() / stopPurr() 踩奶时的持续呼噜。
// 画面的各个模块在触发动画的地方顺手调一下；设置窗口里可以整体关掉。
(function () {
  'use strict';

  const KEY = 'sillycat-sounds-v1';
  let enabled = true;
  try { enabled = JSON.parse(localStorage.getItem(KEY)) !== false; } catch (e) { /* 读不到就默认开 */ }

  let ac = null;         // AudioContext：第一次出声时才建（浏览器要求先有用户交互）
  let purrNodes = null;  // 持续呼噜的节点
  let lastSoundAt = -1e9; // 最近一次出声的时刻，给闲置挂起计时用
  let idleTimer = 0;

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(enabled)); } catch (e) { /* 存不了就算了 */ }
  }

  function ready() {
    if (!enabled) return null;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
    }
    if (ac.state === 'suspended') ac.resume();
    lastSoundAt = performance.now();
    return ac;
  }

  // AudioContext 挂着不放会让 WKWebView 的音频输出 IO 一直占着（GPU 进程
  // 「正在输出」标记常亮）。闲置 10 秒自动挂起，下次出声再 resume——反正
  // 10 秒没动静，挂起的恢复开销感知不到。
  setInterval(() => {
    if (ac && ac.state === 'running' && !purrNodes &&
        performance.now() - lastSoundAt >= 10000) ac.suspend();
  }, 3000);

  // 噪声缓冲：哈气 / 砸键盘共用
  function noiseBuffer(ctx2, sec) {
    const buf = ctx2.createBuffer(1, Math.floor(ctx2.sampleRate * sec), ctx2.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function gainEnv(ctx2, t0, peak, attack, decay) {
    const g = ctx2.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    return g;
  }

  const synth = {
    // 喵：锯齿波滑音 + 嘴型的低通，先上扬再回落
    meow() {
      const ctx2 = ready(); if (!ctx2) return;
      const t0 = ctx2.currentTime, dur = 0.5;
      const o = ctx2.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(430, t0);
      o.frequency.linearRampToValueAtTime(720, t0 + 0.13);   // 上扬
      o.frequency.linearRampToValueAtTime(360, t0 + dur);    // 收尾
      const vib = ctx2.createOscillator(), vg = ctx2.createGain();
      vib.frequency.value = 22; vg.gain.value = 14;
      vib.connect(vg).connect(o.frequency);
      const f = ctx2.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 5;
      f.frequency.setValueAtTime(900, t0);
      f.frequency.linearRampToValueAtTime(1800, t0 + 0.15);
      f.frequency.linearRampToValueAtTime(700, t0 + dur);
      const g = gainEnv(ctx2, t0, 0.16, 0.05, dur - 0.05);
      o.connect(f).connect(g).connect(ctx2.destination);
      o.start(t0); vib.start(t0);
      o.stop(t0 + dur + 0.1); vib.stop(t0 + dur + 0.1);
    },
    // 哈气：高频噪声
    hiss() {
      const ctx2 = ready(); if (!ctx2) return;
      const t0 = ctx2.currentTime, dur = 0.4;
      const src = ctx2.createBufferSource();
      src.buffer = noiseBuffer(ctx2, dur);
      const f = ctx2.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 3200;
      const g = gainEnv(ctx2, t0, 0.12, 0.02, dur - 0.02);
      src.connect(f).connect(g).connect(ctx2.destination);
      src.start(t0);
    },
    // 砸键盘：闷响 + 碎渣噪声
    smash() {
      const ctx2 = ready(); if (!ctx2) return;
      const t0 = ctx2.currentTime;
      const o = ctx2.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(120, t0);
      o.frequency.exponentialRampToValueAtTime(45, t0 + 0.22);
      const g = gainEnv(ctx2, t0, 0.35, 0.005, 0.24);
      o.connect(g).connect(ctx2.destination);
      o.start(t0); o.stop(t0 + 0.3);
      const src = ctx2.createBufferSource();
      src.buffer = noiseBuffer(ctx2, 0.18);
      const f = ctx2.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 1400;
      const g2 = gainEnv(ctx2, t0, 0.2, 0.004, 0.16);
      src.connect(f).connect(g2).connect(ctx2.destination);
      src.start(t0);
    },
    // 敲碗：清脆的小木头声
    tap() {
      const ctx2 = ready(); if (!ctx2) return;
      const t0 = ctx2.currentTime;
      const o = ctx2.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(820, t0);
      o.frequency.exponentialRampToValueAtTime(560, t0 + 0.07);
      const g = gainEnv(ctx2, t0, 0.18, 0.003, 0.07);
      o.connect(g).connect(ctx2.destination);
      o.start(t0); o.stop(t0 + 0.12);
    },
    // 铃铛：番茄钟切换阶段时的两声清脆小铃
    bell() {
      const ctx2 = ready(); if (!ctx2) return;
      [[880, 0], [1174, 0.18]].forEach(([freq, delay]) => {
        const t0 = ctx2.currentTime + delay;
        const o = ctx2.createOscillator();
        o.type = 'sine';
        o.frequency.value = freq;
        const o2 = ctx2.createOscillator();   // 泛音，让铃声更亮
        o2.type = 'sine'; o2.frequency.value = freq * 2.76;
        const g2 = ctx2.createGain(); g2.gain.value = 0.25;
        o2.connect(g2);
        const g = gainEnv(ctx2, t0, 0.14, 0.004, 0.5);
        o.connect(g); g2.connect(g);
        o.start(t0); o.stop(t0 + 0.6);
        o2.start(t0); o2.stop(t0 + 0.6);
      });
    },
  };

  // 呼噜：低通噪声被 26Hz 的呼吸式起伏调制，踩奶期间一直响
  function startPurr() {
    if (!enabled || purrNodes || !ready()) return;
    const ctx2 = ac;
    const src = ctx2.createBufferSource();
    src.buffer = noiseBuffer(ctx2, 2);
    src.loop = true;
    const f = ctx2.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 220; f.Q.value = 2;
    const g = ctx2.createGain(); g.gain.value = 0.0001;
    const lfo = ctx2.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 26;   // 猫呼噜的典型频率
    const lg = ctx2.createGain(); lg.gain.value = 0.1;
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(ctx2.destination);
    src.start(); lfo.start();
    g.gain.setTargetAtTime(0.12, ctx2.currentTime, 0.2);
    purrNodes = { src, lfo, g };
  }
  function stopPurr() {
    if (!purrNodes) return;
    const { src, lfo, g } = purrNodes;
    purrNodes = null;
    lastSoundAt = performance.now(); // 呼噜尾巴也算出声
    try {
      g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.15);
      src.stop(ac.currentTime + 0.6); lfo.stop(ac.currentTime + 0.6);
    } catch (e) { /* 已经停了就算了 */ }
  }

  window.SillySounds = {
    play(name) { if (synth[name]) synth[name](); },
    startPurr, stopPurr,
    setEnabled(v) {
      enabled = !!v;
      save();
      if (!enabled) stopPurr();
    },
    get: () => enabled,
    // 借输入事件解锁音频（浏览器要求先有用户交互才能出声）
    create() {
      return { block() { if (enabled) ready(); return false; } };
    },
  };
})();
