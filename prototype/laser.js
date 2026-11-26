// 激光笔：你闲下来时，一个红点会出现在键盘附近。猫瞳孔放大、死死盯着，
// 扑上去——红点一溜烟跳走；再扑一次，要么终于按住（开心），要么彻底跑了（甩尾巴生气）。
// 抓住不涨好感：这是猫自己打发时间，好感的分只来自你和它的互动。
// 调试：?demo=laser&loop=1（到点自动演）或 &at=毫秒 冻结在第二扑的瞬间
(function () {
  'use strict';

  const IDLE_MIN = 5000;
  const EVERY = [25000, 45000];
  const STARE = 900;        // 第一次出现：盯多久才扑
  const POUNCE = 520;       // 一次扑击的时长
  const ESCAPE_AT = 360;    // 扑到这一步红点逃走
  const STARE2 = 500;       // 逃走后重新盯
  const CATCH_RATE = 0.5;   // 第二扑抓住的概率

  const rand = (a, b) => a + Math.random() * (b - a);
  const $ = (id) => document.getElementById(id);
  const lerp = (a, b, k) => a + (b - a) * k;

  function create(ctx, opts = {}) {
    const { S, STATES } = ctx;
    const demo = opts.demo && opts.demo.name === 'laser' ? opts.demo : null;
    const W = {
      next: performance.now() + (demo ? 800 : rand(EVERY[0], EVERY[1])),
      phase: null,   // 'stare' | 'pounce' | 'stare2' | 'pounce2' | 'catch' | 'miss'
      start: 0,      // 当前阶段起点
      dot: null, from: null,  // 红点当前位置 / 扑击前的位置
      willCatch: false,
      endUntil: -1e9,
    };

    // 红点：亮核 + 光晕
    $('fx-layer').insertAdjacentHTML('beforebegin', `
      <g id="laser-dot" style="opacity:0">
        <circle r="13" fill="#ff3b30" opacity="0.28"/>
        <circle r="6.5" fill="#ff3b30"/>
      </g>`);
    const E = { dot: $('laser-dot') };

    // 红点出生点：键盘附近
    function dotBirth() {
      const c = ctx.kb.center(Math.random() < 0.5 ? 'KeyH' : 'KeyJ') || { x: 400, y: 470 };
      return { x: c.x + rand(-50, 50), y: c.y - rand(30, 80) };
    }
    // 逃走：往旁边跳一大步
    function dotEscape() {
      const dx = (W.dot.x < 400 ? 1 : -1) * rand(110, 160);
      return { x: Math.min(720, Math.max(120, W.dot.x + dx)), y: Math.max(300, W.dot.y - rand(40, 110)) };
    }

    function start(now) {
      W.phase = 'stare'; W.start = now;
      W.dot = dotBirth();
      W.willCatch = Math.random() < CATCH_RATE;
    }
    function finish(now, caught) {
      W.phase = caught ? 'catch' : 'miss';
      W.start = now;
      W.endUntil = now + 1600;
      ctx.fx.spawn(caught ? '抓住了！' : '哼，跑了', caught ? W.dot.x : 400, caught ? W.dot.y - 26 : 104, caught ? 'hot' : 'angry', performance.now());
      if (caught) {
        // 猫自己玩的，不给好感分（只有摸头/逗猫棒/零食这类用户互动才涨）
        if (window.SillySounds) window.SillySounds.play('meow');
      }
      if (!demo) W.next = now + rand(EVERY[0], EVERY[1]);
    }

    function forcedPawTarget(paw, now) {
      if ((W.phase !== 'pounce' && W.phase !== 'pounce2') || !W.dot) return null;
      const t = now - W.start;
      if (t >= POUNCE - 60) return null; // 扑完落定
      // 双爪一起扑向红点
      const jitter = paw.side === 'L' ? 14 : -14;
      return { id: 'laser-pounce', x: W.dot.x + jitter, y: W.dot.y + 6, tau: 60, pressing: t > POUNCE * 0.55 };
    }

    function pose(now, dt, rm, P) {
      if (demo) {
        if (Number.isFinite(demo.at)) {
          if (!W.frozenInit) { // 冻结：呈现第二扑刚起步、红点还没逃的瞬间
            W.frozenInit = true;
            W.phase = 'pounce2'; W.start = now - 200;
            W.dot = { x: 520, y: 380 }; W.from = { x: 380, y: 470 };
            W.willCatch = true;
          }
        } else if (!W.phase && now >= W.next) { start(now); }
      } else {
        const idleOk = S.state === STATES.AWAKE && !S.pet && !S.excited && now - S.lastInput >= IDLE_MIN;
        if (!W.phase && idleOk && now >= W.next) start(now);
      }
      if (!W.phase) return;
      const t = now - W.start;

      // 阶段推进
      if (W.phase === 'stare' && t >= STARE) { W.phase = 'pounce'; W.start = now; W.from = { ...W.dot }; }
      else if (W.phase === 'pounce') {
        if (t >= ESCAPE_AT && t < POUNCE - 80) { W.dot = dotEscape(); W.phase = 'stare2'; W.start = now; }
        else if (t >= POUNCE - 80) { W.dot = dotEscape(); W.phase = 'stare2'; W.start = now; }
      } else if (W.phase === 'stare2' && t >= STARE2) { W.phase = 'pounce2'; W.start = now; W.from = { ...W.dot }; }
      else if (W.phase === 'pounce2' && t >= POUNCE) {
        // 第二扑见分晓：抓没抓就看 willCatch
        finish(now, W.willCatch && t < POUNCE + 120);
        if (!W.willCatch) { W.dot = null; }
      } else if ((W.phase === 'catch' || W.phase === 'miss') && now >= W.endUntil) {
        W.phase = null; W.dot = null;
      }

      // 红点在扑击中段快速逃离（视觉上先爪子到、点再闪）
      if (W.phase === 'pounce' && t >= ESCAPE_AT && W.from) {
        const k = Math.min(1, (t - ESCAPE_AT) / 140);
        W.dot = { x: lerp(W.from.x, W.dot.x, k), y: lerp(W.from.y, W.dot.y, k) };
      }

      // 姿态
      if (W.phase === 'stare' || W.phase === 'stare2') {
        P.look = W.dot ? { x: W.dot.x, y: W.dot.y } : null;
        P.earDroop -= 7;                       // 耳朵立起来
        ctx.S.pupilR = 17.5;                   // 瞳孔放大（基础代码每帧往回拉，这里顶住）
        P.tailAmp = 10; P.tailSpeed = 0.02;    // 尾巴压低蓄势
        P.bodyY += 4;                          // 压低身子
      } else if (W.phase === 'pounce' || W.phase === 'pounce2') {
        ctx.S.pupilR = 17.5;
        const k = Math.min(1, t / POUNCE);
        P.bodyY += 4 - 10 * k;                 // 扑出去身子抬起
        if (W.from && W.dot) P.bodyX += (W.dot.x - W.from.x) * 0.12 * k;
        if (W.from && W.dot) P.headX = (P.headX || 0) + (W.dot.x - W.from.x) * 0.12 * k;
        P.tailAmp = 20; P.tailSpeed = 0.03;
      } else if (W.phase === 'catch') {
        P.eyesHappy = true;
        P.tailAmp = 24; P.tailSpeed = 0.03;
      } else if (W.phase === 'miss') {
        P.earDroop += 9;
        P.tailAmp = 8; P.tailSpeed = 0.006;    // 尾巴不高兴地垂着拍
        P.headRot += 6;
      }
    }

    function render(now) {
      let op = 0;
      if (W.dot && (W.phase === 'stare' || W.phase === 'stare2' || W.phase === 'pounce' || W.phase === 'pounce2')) op = 1;
      if (W.phase === 'catch' && now - W.start < 500) op = 1 - (now - W.start) / 500; // 抓住了：红点熄灭
      if (op <= 0) { E.dot.style.opacity = 0; return; }
      E.dot.setAttribute('transform', `translate(${W.dot.x.toFixed(1)} ${W.dot.y.toFixed(1)})`);
      E.dot.style.opacity = op;
    }

    return {
      forcedPawTarget, pose, render,
      debugProps: { laser: () => W.phase, laserDot: () => W.dot },
    };
  }

  window.SillyLaser = { create };
})();
