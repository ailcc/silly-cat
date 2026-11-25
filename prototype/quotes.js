// 奶牛猫语录：你发呆的时候，猫偶尔冒一句精神状态不太稳定的语录。
// 纯浮字特效，不打扰任何状态；有输入立刻闭嘴。
// 调试：?demo=quote&loop=1&at=毫秒
(function () {
  'use strict';

  const LINES = [
    '键盘是我咬的，与我无关',
    '上班？我在上香',
    '这届铲屎的不太行',
    '我在工作，别吵',
    '摸我，立刻，马上',
    '稿子？我吃了',
    '喵生苦短，先睡为敬',
    '工资没有，猫粮管够吗',
    '今天也是不想上班的一天',
    '嘘——我在假装办公',
  ];
  const IDLE_MIN = 8000;        // 至少闲了这么久才开始说
  const EVERY = [20000, 45000]; // 两句之间隔多久（随机）

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function create(ctx, opts = {}) {
    const { S, STATES } = ctx;
    const demo = opts.demo && opts.demo.name === 'quote' ? opts.demo : null;
    const W = { next: performance.now() + (demo ? 800 : rand(EVERY[0], EVERY[1])), line: null };

    function say() {
      W.line = pick(LINES);
      // 语录是完整句子，寿命给 2.6 秒（比浮键帽的 0.7 秒长）才看得清
      ctx.fx.spawn(W.line, 400 + rand(-40, 40), 100, '', performance.now(), 2600);
      if (window.SillySounds) window.SillySounds.play('meow');
    }

    function pose(now) {
      const ok = S.state === STATES.AWAKE && !S.pet && !S.excited;
      if (demo) {
        if (now >= W.next) { say(); W.next = now + 2500; }
        return;
      }
      if (!ok || now - S.lastInput < IDLE_MIN) return;
      if (now >= W.next) { say(); W.next = now + rand(EVERY[0], EVERY[1]); }
    }

    return {
      pose,
      debugProps: { quote: () => W.line, quoteNext: () => Math.round(W.next - performance.now()) },
    };
  }

  window.SillyQuotes = { create };
})();
