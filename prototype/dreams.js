// 睡觉说梦话：宠物睡着后偶尔冒出一句梦话小气泡，身子跟着轻轻扭一下；
// 刚说完梦话就被吵醒的话，会一脸无辜地「喵？/汪？」一声。纯表演，不碰输入。
// 调试：?demo=dream&loop=1&at=毫秒（不等真的睡着，到点就冒梦话）
(function () {
  'use strict';

  const EVERY = [7000, 15000];  // 两句梦话之间隔多久（随机）
  const DREAM_MS = 1900;        // 一句梦话连同扭动持续多久
  const WAKE_RECENT = 4500;     // 说完梦话多久内被吵醒会「喵？/汪？」（词在 lines.js）

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function create(ctx, opts = {}) {
    const { S, STATES, clamp } = ctx;
    const lines = () => window.SillyLines.get('dreams');
    const demo = opts.demo && opts.demo.name === 'dream' ? opts.demo : null;
    // 睡眠类演示（趴睡/口水等）就是「真的睡着」：第一句梦话早点来，别让观众干等
    const sleepDemo = opts.demo && ['slumped', 'drool', 'slump-in'].includes(opts.demo.name);
    const W = {
      next: performance.now() + (demo || sleepDemo ? 800 : rand(EVERY[0], EVERY[1])),
      until: -1e9,          // 当前这句梦话的结束时刻
      line: null,
      start: -1e9,          // 当前这句梦话的开始时刻（扭动用）
      wasAsleep: false,
    };

    function say(now, t) {
      const ms = performance.now();
      W.start = now;
      W.until = now + DREAM_MS;
      W.line = t ?? pick(lines());
      // 梦话从脑袋附近飘出来；句子长，寿命给 2.4 秒（比浮键帽的 0.7 秒长）才看得清
      ctx.fx.spawn(W.line, 470 + rand(-24, 24), 118, '', ms, 2400);
    }

    function pose(now, dt, rm, P) {
      // 睡醒的「喵？」：上一帧还在睡、这一帧醒了，且刚说过梦话
      const asleep = S.state === STATES.ASLEEP;
      if (W.wasAsleep && !asleep && !S.pet && now - W.start < WAKE_RECENT) {
        ctx.fx.spawn(window.SillyLines.get('wake'), 400 + rand(-16, 16), 108, 'hot', performance.now());
      }
      W.wasAsleep = asleep;

      if (demo && !Number.isFinite(demo.at)) {
        // 非冻结的自动 demo：到点就冒一句，不要求真的睡着
        if (now >= W.next) { say(now); W.next = now + 2500; }
      }
      if (!asleep) return;
      if (Number.isFinite(demo?.at)) { if (now >= W.next) { say(now); W.next = 1e12; } }
      else if (!demo && now >= W.next && !S.pet) { say(now); W.next = now + rand(EVERY[0], EVERY[1]); }

      const t = now - W.start;
      const left = W.until - now;
      if (left <= 0) return;
      // 说梦话时身子轻轻左右扭，尾巴小幅度晃
      const k = Math.sin(Math.PI * clamp(t / DREAM_MS, 0, 1));
      P.bodyRot += 3.5 * k * Math.sin(t / 260);
      P.tailAmp = 9; P.tailSpeed = 0.008;
    }

    return {
      pose,
      debugProps: {
        dream: () => (W.until > performance.now() ? W.line : null),
        dreamNext: () => (S.state === 'asleep' ? Math.round(W.next - performance.now()) : null),
      },
    };
  }

  window.SillyDreams = { create };
})();
