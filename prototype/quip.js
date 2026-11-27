// 数据吐槽：猫翻你的小账本，按真实统计数据低频吐槽——累计敲了多少下键盘、
// 惹它发飙几回、推了几次杯子、好感度攒到多少。发呆一阵后才说，有输入立刻
// 闭嘴；设置里可以关掉（默认开）。纯浮字特效，不打扰任何状态。
// 调试：?demo=quip&loop=1（每 2.5 秒冒一条）或 &at=毫秒 冻结
(function () {
  'use strict';

  const IDLE_MIN = 8000;        // 至少闲了这么久才开始说
  const EVERY = [35000, 80000]; // 两条之间隔多久（随机，比语录更低频）

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // 按数据量级准备候选吐槽：门槛和文案在 lines.js（quips 键，猫狗各一套），
  // 这里只负责按真实数据把 {keys} 这类占位符填上；数据不够说的返回 null
  function lines() {
    const stats = window.SillyStats ? window.SillyStats.get() : { keys: 0, rage: 0, push: 0 };
    const aff = window.SillyAffection ? window.SillyAffection.get() : { v: 0 };
    const VALUES = { keys: stats.keys, rage: stats.rage, push: stats.push, v: aff.v };
    const total = stats.keys + stats.rage + stats.push;
    const fmtN = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); // 千分位
    return (window.SillyLines.get('quips') || []).map((q) => () => {
      if (q.f === 'none') return total === 0 ? q.text : null; // 空账本的专属吐槽
      const val = VALUES[q.f];
      if (val === undefined) return null;
      if (q.min !== undefined && val < q.min) return null;
      if (q.max !== undefined && val >= q.max) return null;
      return q.text.replace(/\{(\w+)\}/g, (_, name) =>
        name === 'keys' ? fmtN(VALUES[name]) : String(VALUES[name]));
    });
  }

  function create(ctx, opts = {}) {
    const { S, STATES } = ctx;
    const demo = opts.demo && opts.demo.name === 'quip' ? opts.demo : null;
    const W = { on: true, next: performance.now() + (demo ? 800 : rand(EVERY[0], EVERY[1])), line: null };

    function say() {
      const usable = lines().map((f) => f()).filter(Boolean);
      W.line = usable.length ? pick(usable) : null;
      if (!W.line) return; // 没有能说的就不说，稍后再试
      // 吐槽是完整句子，寿命 2.6 秒才看得清
      ctx.fx.spawn(W.line, 400 + rand(-40, 40), 100, '', performance.now(), 2600);
      if (window.SillySounds) window.SillySounds.play('meow');
    }

    function setEnabled(v) { W.on = !!v; }

    function pose(now) {
      if (demo) {
        if (now >= W.next) { say(); W.next = now + 2500; }
        return;
      }
      const ok = W.on && S.state === STATES.AWAKE && !S.pet && !S.excited;
      if (!ok || now - S.lastInput < IDLE_MIN) return;
      if (now >= W.next) { say(); W.next = now + rand(EVERY[0], EVERY[1]); }
    }

    return {
      pose, setEnabled,
      debugProps: { quip: () => W.line, quipNext: () => Math.round(W.next - performance.now()) },
    };
  }

  window.SillyQuips = { create };
})();
