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
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); // 千分位

  // 按数据量级准备候选吐槽：每条都是一个 () => 文本 | null 的函数（数据不够说就返回 null）
  function lines() {
    const stats = window.SillyStats ? window.SillyStats.get() : { keys: 0, rage: 0, push: 0 };
    const aff = window.SillyAffection ? window.SillyAffection.get() : { v: 0 };
    const k = stats.keys, r = stats.rage, p = stats.push, v = aff.v;
    return [
      () => k >= 100000 ? `账本上记着你敲了 ${fmt(k)} 下键盘……爪子替你酸` : null,
      () => k >= 20000 ? `这阵子你敲了 ${fmt(k)} 下键盘，键盘快被你盘出包浆了` : null,
      () => k >= 3000 ? `才这个点就敲了 ${fmt(k)} 下键盘，你在写什么大作` : null,
      () => k >= 500 ? `本喵已经看着你敲了 ${fmt(k)} 下键盘，眼都花了` : null,
      () => r >= 1 ? `账本记着你惹我发飙 ${r} 回，一笔都没给你勾掉` : null,
      () => r >= 1 ? `发飙 ${r} 次都是你干的，我全记在小本本上了` : null,
      () => p >= 1 ? `我把杯子推出去 ${p} 次，你回回都接住了，没意思` : null,
      () => v >= 120 ? `好感度都 ${v} 了，死忠归死忠，小鱼干呢` : null,
      () => v >= 60 ? `咱俩好感度 ${v} 了，多摸摸头还能涨` : null,
      () => k + r + p === 0 ? '账本空空的？那我先帮你记一笔「铲屎的不敬业」' : null,
    ];
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
