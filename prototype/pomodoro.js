// 番茄钟：设置里开启后，猫陪你按 25 分钟专注 + 5 分钟休息的节奏工作，
// 每 4 个番茄后休息拉长到 15 分钟。阶段切换时铃铛响、猫冒气泡报幕，
// 画面左上角挂着一个小倒计时。专注时猫坐得端正，休息时它先伸懒腰做榜样。
// 调试：?demo=pomo&loop=1（6 秒专注 + 3 秒休息的加速版）或 &at=毫秒 冻结
(function () {
  'use strict';

  const FOCUS_MS = 25 * 60000;
  const REST_MS = 5 * 60000;
  const LONG_REST_MS = 15 * 60000;
  const LONG_EVERY = 4;        // 每 4 个番茄休一次长的

  const $ = (id) => document.getElementById(id);
  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  function create(ctx, opts = {}) {
    const { S, STATES } = ctx;
    const demo = opts.demo && opts.demo.name === 'pomo' ? opts.demo : null;
    const W = {
      on: false,             // 设置开关
      phase: null,           // 'focus' | 'rest'
      start: 0, round: 1,    // 第几个番茄
      dur: 0,
      lastSecond: -1,
    };
    const FOCUS = demo ? 6000 : FOCUS_MS;
    const REST = demo ? 3000 : REST_MS;
    const LONG_REST = demo ? 4000 : LONG_REST_MS;

    // 左上角的小倒计时
    $('bubble-layer').insertAdjacentHTML('beforebegin', `
      <g id="pomo-timer" style="opacity:0">
        <rect class="pomo-chip" x="14" y="20" width="140" height="44" rx="22"/>
        <text id="pomo-text" class="pomo-text" x="92" y="49">25:00</text>
        <circle id="pomo-dot" class="pomo-dot" cx="34" cy="42" r="7"/>
      </g>`);
    const E = { chip: $('pomo-timer'), text: $('pomo-text'), dot: $('pomo-dot') };

    function setPhase(phase, now) {
      W.phase = phase; W.start = now;
      W.dur = phase === 'focus' ? FOCUS : (W.round % LONG_EVERY === 0 ? LONG_REST : REST);
      if (window.SillySounds) window.SillySounds.play('bell');
      const msg = phase === 'focus'
        ? `专注开始！第 ${W.round} 个番茄`
        : (W.dur === LONG_REST ? `休息 ${demo ? 4 : 15} 分钟，辛苦啦` : `休息 5 分钟，摸摸猫`);
      ctx.fx.spawn(msg, 400, 92, 'hot', performance.now());
    }

    function setEnabled(v) {
      const was = W.on;
      W.on = !!v;
      if (W.on && !was) { W.round = 1; W.phase = null; W.start = performance.now() + 1200; W.pending = true; }
      if (!W.on) { W.phase = null; W.pending = false; E.chip.style.opacity = 0; }
    }

    function pose(now, dt, rm, P) {
      if (demo && !Number.isFinite(demo.at)) W.on = true; // demo 强制开启
      if (!W.on) return;
      if (Number.isFinite(demo?.at)) {
        if (!W.frozenInit) { // 冻结：专注进行到一半
          W.frozenInit = true; W.pending = false;
          W.phase = 'focus'; W.start = now - FOCUS / 2; W.dur = FOCUS;
        }
      } else if (demo && !W.phase && !W.pending) { W.pending = true; W.start = now + 400; }
      else if (W.pending && now >= W.start) { W.pending = false; setPhase('focus', now); }

      if (!W.phase) return;
      const t = now - W.start;

      // 阶段切换
      if (W.phase === 'focus' && t >= W.dur) { setPhase('rest', now); }
      else if (W.phase === 'rest' && t >= W.dur) { W.round++; setPhase('focus', now); }

      // 姿态：专注时端正；休息时打滚示范
      if (W.phase === 'focus') {
        P.earDroop -= 3;
        P.bodyY -= 2;
        P.tailAmp = 8; P.tailSpeed = 0.01;
      } else {
        const k = Math.sin(Math.PI * Math.min(1, t / W.dur));
        P.eyesHappy = true;
        P.bodyRot += 8 * k * Math.sin(now / 200);
        P.tailAmp = 22; P.tailSpeed = 0.02;
      }
    }

    function render(now) {
      if (!W.on || !W.phase) { E.chip.style.opacity = 0; return; }
      E.chip.style.opacity = 1;
      const left = W.dur - (now - W.start);
      const sec = Math.ceil(left / 1000);
      if (sec !== W.lastSecond) {
        W.lastSecond = sec;
        E.text.textContent = fmt(left);
        E.dot.style.fill = W.phase === 'focus' ? '#ff3b30' : '#34c759';
      }
    }

    return {
      pose, render, setEnabled,
      debugProps: { pomo: () => (W.on ? (W.phase || 'pending') : null), pomoRound: () => W.round },
    };
  }

  window.SillyPomodoro = { create };
})();
