// Web Audio：低频噪声的短脉冲形成呼噜，呼吸改变脉冲速度和力度。
(function () {
  'use strict';

  const FADE_IN = 0.4, HOLD = 1.2, FADE_OUT = 0.8, SUSPEND_MS = 5000;
  const PEAK = 10 ** (-6.05 / 20); // 给 16 位试听文件的舍入留余量
  const varied = (value, amount = 0.1) => value * (1 + amount * (2 * Math.random() - 1));

  function makeTexture(audio) {
    const rate = 12000;
    const sections = Array.from({ length: 12 }, (_, i) => {
      const inhale = i % 2 === 1;
      return { frames: Math.round(rate * varied(inhale ? 1 : 1.3)), hz: varied(inhale ? 28 : 24), level: varied(inhale ? 0.49 : 0.92) };
    });
    const buffer = audio.createBuffer(1, sections.reduce((n, s) => n + s.frames, 0), rate);
    const pcm = buffer.getChannelData(0);
    let pos = 0;
    for (const { frames, hz, level } of sections) {
      for (let start = 0; start < frames;) {
        const interval = Math.round(rate / varied(hz, 0.075));
        const width = Math.round(interval * 0.73);
        const amp = varied(level, 0.19) * (0.52 + 0.48 * Math.sin(Math.PI * start / frames));
        for (let n = 0; n < width && start + n < frames; n++) {
          const u = n / width;
          const pulse = Math.min(1, u * 9) * (1 - u) ** 1.6;
          const seam = Math.min(1, (frames - start - n) / (rate * 0.004));
          pcm[pos + start + n] = (2 * Math.random() - 1) * pulse * amp * seam;
        }
        start += interval;
      }
      pos += frames;
    }
    return buffer;
  }

  function makeVoice(audio, texture, volume) {
    const source = audio.createBufferSource();
    source.buffer = texture;
    source.loop = true;
    const low = audio.createBiquadFilter();
    low.type = 'lowpass'; low.frequency.value = 410; low.Q.value = 0.3;
    const resonance = audio.createBiquadFilter();
    resonance.type = 'peaking'; resonance.frequency.value = 145; resonance.Q.value = 0.9; resonance.gain.value = 5;
    const envelope = audio.createGain();
    envelope.gain.value = 0;
    const compressor = audio.createDynamicsCompressor();
    compressor.threshold.value = -15;
    compressor.knee.value = 8;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.12;
    const limiter = audio.createWaveShaper();
    const size = 1025;
    limiter.curve = Float32Array.from({ length: size }, (_, i) => {
      const x = 2 * i / (size - 1) - 1;
      return Math.max(-PEAK, Math.min(PEAK, x));
    });
    const level = audio.createGain();
    level.gain.value = volume / 100;
    // 音量满格也经过硬限幅，设备音量由系统控制。
    const nodes = [source, low, resonance, envelope, compressor, limiter, level];
    nodes.forEach((node, i) => node.connect(nodes[i + 1] || audio.destination));
    source.start();
    let ramp = { from: 0, to: 0, start: audio.currentTime, end: audio.currentTime };

    function fade(to, hold, duration) {
      const now = audio.currentTime;
      const progress = now >= ramp.end ? 1 : Math.max(0, (now - ramp.start) / (ramp.end - ramp.start));
      const from = ramp.from + (ramp.to - ramp.from) * progress;
      const start = now + hold, end = start + duration;
      envelope.gain.cancelScheduledValues(now);
      envelope.gain.setValueAtTime(from, now);
      if (hold) envelope.gain.setValueAtTime(from, start);
      envelope.gain.linearRampToValueAtTime(to, end);
      ramp = { from, to, start, end };
    }
    return {
      fade,
      setVolume(value) { level.gain.setTargetAtTime(value / 100, audio.currentTime, 0.02); },
      stop() { source.stop(); nodes.forEach(node => node.disconnect()); },
      // OfflineAudioContext 在渲染前一次排好与在线版相同的包络。
      scheduleSample(seconds) {
        envelope.gain.setValueAtTime(0, 0);
        envelope.gain.linearRampToValueAtTime(1, FADE_IN);
        envelope.gain.setValueAtTime(1, seconds - FADE_OUT);
        envelope.gain.linearRampToValueAtTime(0, seconds);
        source.stop(seconds);
      },
    };
  }

  async function renderSample() {
    const seconds = 8, rate = 44100;
    const audio = new OfflineAudioContext(1, seconds * rate, rate);
    makeVoice(audio, makeTexture(audio), 100).scheduleSample(seconds);
    return audio.startRendering();
  }

  function create(ctx, opts = {}) {
    const { S } = ctx;
    const supported = () => ctx.species?.purr !== false;
    let enabled = opts.enabled !== false, volume = opts.volume ?? 60;
    let audio = null, texture = null, voice = null, unlocked = false, resuming = null;
    let playing = false, cleanup = 0, idle = 0;

    function suspendLater() {
      if (idle || !audio || voice || audio.state !== 'running') return;
      idle = setTimeout(() => {
        idle = 0;
        if (!voice && audio.state === 'running') audio.suspend().catch(() => {});
      }, SUSPEND_MS);
    }

    function resume() {
      if (resuming) return;
      resuming = audio.resume().then(() => {
        unlocked = true;
        resuming = null;
        sync();
        suspendLater();
      }).catch(() => { unlocked = false; resuming = null; });
    }

    function unlock() {
      if (!supported() || !enabled || volume <= 0) return;
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      try {
        audio ||= new Context();
        if (audio.state === 'running') {
          unlocked = true;
          sync();
          suspendLater();
        } else resume();
      } catch (_) { /* 宿主未提供可用的音频输出。 */ }
    }

    function sync() {
      const want = supported() && enabled && volume > 0 && !!S.pet && (!opts.canPurr || opts.canPurr());
      if (want && unlocked && audio?.state === 'suspended') { resume(); return; }
      if (playing === want || audio?.state !== 'running') return;
      if (want) {
        clearTimeout(idle); idle = 0;
        clearTimeout(cleanup); cleanup = 0;
        texture ||= makeTexture(audio);
        voice ||= makeVoice(audio, texture, volume);
        voice.fade(1, 0, FADE_IN);
      } else if (voice) {
        const hold = supported() && enabled && volume > 0 && !S.pet ? HOLD : 0;
        voice.fade(0, hold, FADE_OUT);
        cleanup = setTimeout(() => {
          cleanup = 0;
          voice.stop();
          voice = null;
          suspendLater();
        }, (hold + FADE_OUT) * 1000 + 30);
      }
      playing = want;
    }

    return {
      onPetStart: unlock,
      onPetEnd: sync,
      afterState: sync,
      unlock,
      setEnabled(value) { enabled = !!value; sync(); },
      setVolume(value) {
        volume = value;
        if (voice) voice.setVolume(volume);
        sync();
      },
    };
  }

  window.SillyPurr = { create, renderSample };
})();
