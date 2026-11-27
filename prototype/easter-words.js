// 彩蛋词反应：打字打出 cat / mao / miao / meow 时，猫猛地抬头看你，尾巴竖起来晃，
// 头顶冒一个「喵！」。纯姿态 + 浮起键帽特效，不碰输入。键位码拼不出中文，所以只认这些拉丁词。
(function () {
  'use strict';

  const WORDS = ['cat', 'mao', 'miao', 'meow'];
  const REACT_MS = 1800;   // 反应持续多久
  const BUF_MAX = 12;      // 只记住最近这几个字母

  function create(ctx, opts = {}) {
    const { S, STATES, clamp } = ctx;
    // ?demo=catword：不等真的打出 cat，到点就演一遍（调试用）
    const demo = opts.demo && opts.demo.name === 'catword' ? opts.demo : null;
    const W = { buf: '', until: -1e9, word: null, next: performance.now() + (demo ? 800 : 0) };

    function trigger(word, now) {
      W.until = now + REACT_MS;
      W.word = word;
      W.buf = '';
      // 「喵！」从头顶冒出来（复用浮起键帽特效）
      ctx.fx.spawn(window.SillyLines.get('easter'), 400 + (Math.random() * 2 - 1) * 30, 104, 'hot', now);
      if (window.SillySounds) window.SillySounds.play('meow');
    }

    function afterKeyDown(code, now) {
      // 只关心字母；空格/其他键把拼到一半的词清掉
      const m = /^Key([A-Z])$/.exec(code);
      if (!m) {
        if (code !== 'ShiftLeft' && code !== 'ShiftRight') W.buf = '';
        return;
      }
      W.buf = (W.buf + m[1]).slice(-BUF_MAX);
      const low = W.buf.toLowerCase();
      const hit = WORDS.find((w) => low.endsWith(w));
      if (hit && S.state === STATES.AWAKE) trigger(hit, now);
    }

    function pose(now, dt, rm, P) {
      if (demo && now >= W.next && S.state === STATES.AWAKE) {
        W.next = Number.isFinite(demo.at) ? 1e12 : now + 2600;
        trigger('cat', demo && Number.isFinite(demo.at) ? now - demo.at : now);
      }
      const left = W.until - now;
      if (left <= 0) return;
      const k = clamp(left / REACT_MS, 0, 1);          // 越往后越平静
      if (left > REACT_MS * 0.3) P.look = { x: 400, y: -60 }; // 抬头看向"上面"（你）
      P.earDroop -= 5 * k;                              // 耳朵立起来
      P.headY -= 5 * k;
      P.tailAmp = 24; P.tailSpeed = 0.022;              // 尾巴竖起来晃
    }

    return {
      afterKeyDown, pose,
      debugProps: { easterWord: () => (W.until > performance.now() ? W.word : null) },
    };
  }

  window.SillyEasterWords = { create };
})();
