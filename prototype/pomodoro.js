// 番茄钟：设置里开启后，猫陪你按 25 分钟专注 + 5 分钟休息的节奏工作，
// 每 4 个番茄后休息拉长到 15 分钟。阶段切换时铃铛响、猫冒气泡报幕，
// 画面左上角挂着一个小倒计时。进度存在 localStorage 里，退出软件再打开会接着上次的阶段继续倒计时。
// 调试：?demo=pomo&loop=1（6 秒专注 + 3 秒休息的加速版）或 &at=毫秒 冻结
(function () {
  'use strict';

  const FOCUS_MS = 25 * 60000;
  const REST_MS = 5 * 60000;
  const LONG_REST_MS = 15 * 60000;
  const LONG_EVERY = 4;        // 每 4 个番茄休一次长的
  const CHEER_MS = 2600;       // 完成番茄的庆祝时长：撒星星 +（长休）戴派对帽蹦跳
  const KEY = 'sillycat-pomo-v1'; // 进度存储：{ phase, round, end }，end 是阶段结束的时刻（Date.now() 口径，关掉软件也照走）

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
      cheer: true,           // 完成番茄的庆祝开关（设置里控制，默认开）
      cheerAt: -1e9,         // 庆祝开始时刻（-1e9 = 没在庆祝）
      cheerHat: false,       // 这次庆祝戴不戴派对帽（长休才戴）
      stars: [],             // 满天飞的星星
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
    // 狗的头顶比猫低、头也窄一圈：帽子跟着缩一点、压下来一点。切换品种时也重新适配
    const fitHat = () => {
      if (!E.hat) return;
      const dog = window.SillySpecies?.current?.scene?.template === 'parts-dog';
      E.hat.setAttribute('transform', dog ? 'translate(400 112) scale(0.86) translate(-400 -100)' : '');
    };
    window.addEventListener('silly:species', fitHat);

    // 派对帽：歪戴的大圆锥（够大，正好盖住头顶的小皇冠），插在头组里跟着头动。
    // 延迟到首次渲染才插入：排在后面的成长系统会把皇冠插进头部组，晚插的才能盖在皇冠上面
    const HAT_HTML = `
      <g id="pomo-hat" style="display:none">
        <path class="pomo-hat" d="M 340 98 Q 368 46 404 14 Q 440 52 448 92 Q 394 108 340 98 Z"/>
        <path class="pomo-hat-stripe" d="M 356 72 Q 400 52 440 66" fill="none"/>
        <path class="pomo-hat-stripe" d="M 348 88 Q 400 70 444 82" fill="none"/>
        <circle class="pomo-hat-pompom" cx="404" cy="14" r="8"/>
      </g>`;
    // 庆祝的星星：撒在特效层，独立管理
    $('fx-layer').insertAdjacentHTML('beforeend', `<g id="pomo-stars" style="display:none"></g>`);
    E.hat = null;
    E.stars = $('pomo-stars');

    function setPhase(phase, now) {
      W.phase = phase; W.start = now;
      W.dur = phase === 'focus' ? FOCUS : (W.round % LONG_EVERY === 0 ? LONG_REST : REST);
      if (window.SillySounds) window.SillySounds.play('bell');
      const msg = phase === 'focus'
        ? window.SillyLines.fmt('pomoFocus', { n: W.round })
        : (W.dur === LONG_REST ? window.SillyLines.fmt('pomoRestLong', { min: demo ? 4 : 15 }) : window.SillyLines.get('pomoRest'));
      ctx.fx.spawn(msg, 400, 92, 'hot', performance.now());
      if (phase === 'rest' && W.cheer && now - W.cheerAt > CHEER_MS) startCheer(now); // 完成一个番茄：撒星星庆祝
      saveState();
    }

    // ---------- 完成番茄的庆祝：撒星星；长休（每 4 个）再戴上派对帽蹦跳 ----------
    function startCheer(now) {
      W.cheerAt = now;
      W.cheerHat = W.dur === LONG_REST;
      spawnStars(now, W.cheerHat ? 14 : 8);
    }
    // 四角星星的路径（以 0,0 为中心，r 是半径）
    const starPath = (r) => `M 0 ${-r} Q ${r * 0.18} ${-r * 0.18} ${r} 0 Q ${r * 0.18} ${r * 0.18} 0 ${r} Q ${-r * 0.18} ${r * 0.18} ${-r} 0 Q ${-r * 0.18} ${-r * 0.18} 0 ${-r} Z`;
    function spawnStars(now, n) {
      const SVG_NS = 'http://www.w3.org/2000/svg';
      for (const s of W.stars) s.el.remove();
      W.stars = [];
      for (let i = 0; i < n; i++) {
        const el = document.createElementNS(SVG_NS, 'path');
        el.setAttribute('class', 'pomo-star');
        el.setAttribute('d', starPath(5 + Math.random() * 7));
        E.stars.appendChild(el);
        W.stars.push({
          el,
          x0: 400 + (Math.random() * 2 - 1) * 190,       // 从猫头顶周围撒出去
          y0: 130 + Math.random() * 130,
          vx: (Math.random() * 2 - 1) * 60,              // 向左右上方飘
          vy: -(40 + Math.random() * 70),
          born: now + i * 90,                            // 一颗接一颗冒出来
          life: 1500 + Math.random() * 700,
          spin: (Math.random() * 2 - 1) * 160,
        });
      }
      E.stars.style.display = '';
    }
    function tickStars(now) {
      if (!W.stars.length) return;
      const SVG_NS = 'http://www.w3.org/2000/svg';
      for (let i = W.stars.length - 1; i >= 0; i--) {
        const s = W.stars[i];
        const t = now - s.born;
        if (t < 0) { s.el.setAttribute('opacity', 0); continue; }
        if (t >= s.life) { s.el.remove(); W.stars.splice(i, 1); continue; }
        const p = t / s.life;
        const x = s.x0 + s.vx * p * (s.life / 1000);
        const y = s.y0 + s.vy * p * (s.life / 1000) + 260 * p * p; // 带一点重力回落
        s.el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(s.spin * p).toFixed(0)}) scale(${(0.5 + 0.7 * Math.sin(Math.PI * Math.min(1, p * 1.4))).toFixed(2)})`);
        s.el.setAttribute('opacity', (p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85).toFixed(2));
      }
      if (!W.stars.length) E.stars.style.display = 'none';
    }

    // ---------- 进度存取：退出软件再打开，接着上次的阶段继续 ----------
    function saveState() {
      if (demo) return; // 调试加速版不入库
      try {
        if (!W.on || !W.phase) { localStorage.removeItem(KEY); return; }
        // 剩余时间换算成墙钟时刻存：软件关着的时候时间照常流逝
        localStorage.setItem(KEY, JSON.stringify({
          phase: W.phase, round: W.round,
          end: Date.now() + Math.max(0, W.dur - (performance.now() - W.start)),
        }));
      } catch (e) { /* 存不了就算了，大不了重新数 */ }
    }
    function loadState() {
      try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
    }
    // 开关从关到开时尝试续跑：有效进度且阶段没走完就接着倒计时；走完了就开下一阶段；没有进度就从头来
    function resume() {
      const s = loadState();
      if (!s || (s.phase !== 'focus' && s.phase !== 'rest')
        || !Number.isFinite(s.round) || s.round < 1 || !Number.isFinite(s.end)) return false;
      const left = s.end - Date.now();
      if (left > 0) {
        W.round = s.round;
        W.phase = s.phase;
        W.dur = s.phase === 'focus' ? FOCUS : (W.round % LONG_EVERY === 0 ? LONG_REST : REST);
        W.start = performance.now() - (W.dur - left);
        return true;
      }
      // 关闭期间阶段已经走完：专注完开始休息，休息完进入下一个番茄
      if (s.phase === 'focus') { W.round = s.round; setPhase('rest', performance.now()); }
      else { W.round = s.round + 1; W.phase = null; W.start = performance.now() + 1200; W.pending = true; }
      return true;
    }

    function setEnabled(v) {
      const was = W.on;
      W.on = !!v;
      if (W.on && !was) {
        // 先试续跑（只在真实开关打开时；手动关掉时进度已清，自然走不到）
        if (resume()) return;
        W.round = 1; W.phase = null; W.start = performance.now() + 1200; W.pending = true;
      }
      if (!W.on) { W.phase = null; W.pending = false; E.chip.style.opacity = 0; saveState(); }
    }

    function pose(now, dt, rm, P) {
      if (demo) W.on = true; // demo 模式强制开启（循环演出和冻结演示都用得上）
      if (!W.on) return;
      if (Number.isFinite(demo?.at)) {
        if (!W.frozenInit) { // 冻结：默认停在专注进行到一半；带 &cheer=1 就停在长休庆祝的瞬间
          W.frozenInit = true; W.pending = false;
          if (demo.cheer) {
            W.phase = 'rest'; W.round = LONG_EVERY; W.dur = LONG_REST;
            W.start = now - 500; W.cheerAt = now - 260; W.cheerHat = true;
            spawnStars(now - 200, 14);
          } else {
            W.phase = 'focus'; W.start = now - FOCUS / 2; W.dur = FOCUS;
          }
        }
      } else if (demo && !W.phase && !W.pending) { W.pending = true; W.start = now + 400; }
      else if (W.pending && now >= W.start) { W.pending = false; setPhase('focus', now); }

      if (!W.phase) return;
      const t = now - W.start;

      // 阶段切换
      if (W.phase === 'focus' && t >= W.dur) { setPhase('rest', now); }
      else if (W.phase === 'rest' && t >= W.dur) { W.round++; setPhase('focus', now); }

      // 姿态：专注时端正；庆祝时蹦跳戴帽；休息时打滚示范
      const cheering = W.cheer && W.phase === 'rest' && now - W.cheerAt < CHEER_MS;
      if (W.phase === 'focus') {
        P.earDroop -= 3;
        P.bodyY -= 2;
        P.tailAmp = 8; P.tailSpeed = 0.01;
      } else if (cheering) {
        const ct = now - W.cheerAt;
        const wane = 1 - ct / CHEER_MS;                 // 越跳越收
        P.eyesHappy = true;
        P.bodyY -= Math.abs(Math.sin(ct / 140)) * 8 * wane;  // 原地蹦跳
        P.bodyRot += Math.sin(ct / 300) * 7 * wane;     // 左右摇摆
        P.tailAmp = 26; P.tailSpeed = 0.03;
      } else {
        const k = Math.sin(Math.PI * Math.min(1, t / W.dur));
        P.eyesHappy = true;
        P.bodyRot += 8 * k * Math.sin(now / 200);
        P.tailAmp = 22; P.tailSpeed = 0.02;
      }
    }

    function render(now) {
      if (!E.hat) { // 首次渲染才把派对帽插进头部组（盖在成长皇冠上面）
        document.getElementById('cat-head').insertAdjacentHTML('beforeend', HAT_HTML);
        E.hat = document.getElementById('pomo-hat');
        fitHat();
      }
      // 窗口外层按 settings.size 整体缩放 scene。番茄钟 chip 是左上角的小计数牌，
      // 猫缩到 50% 时时间数字也缩到 50% 就看不清了——所以用逆缩放抵消，视觉保持固定大小。
      // chip 几何中心：rect x=14 width=140 y=20 height=44 → cx=84 cy=42
      const size = window.__catSize || 1;
      const inv = size === 1 ? '' : `translate(84 42) scale(${(1 / size).toFixed(4)}) translate(-84 -42)`;
      E.chip.setAttribute('transform', inv);
      // 庆祝的帽子跟星星不依赖番茄钟总开关，关掉后也要能收拾干净
      const cheering = W.on && W.phase === 'rest' && now - W.cheerAt < CHEER_MS;
      E.hat.style.display = cheering && W.cheerHat ? '' : 'none';
      tickStars(now);
      if (!W.on || !W.phase) { E.chip.style.opacity = 0; return; }
      E.chip.style.opacity = 1;
      const left = W.dur - (now - W.start);
      const sec = Math.ceil(left / 1000);
      if (sec !== W.lastSecond) {
        W.lastSecond = sec;
        E.text.textContent = fmt(left);
        E.dot.style.fill = W.phase === 'focus' ? '#ff3b30' : '#34c759';
        saveState(); // 每秒存一次进度，退出软件也能接着走
      }
    }

    window.addEventListener('pagehide', saveState); // 窗口关闭/刷新前把当前进度落盘

    return {
      pose, render, setEnabled, setCheer(v) { W.cheer = !!v; },
      debugProps: { pomo: () => (W.on ? (W.phase || 'pending') : null), pomoRound: () => W.round, pomoCheer: () => (W.phase === 'rest' && performance.now() - W.cheerAt < CHEER_MS ? Math.floor(performance.now() - W.cheerAt) : null) },
    };
  }

  window.SillyPomodoro = { create };
})();
