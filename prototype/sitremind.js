// 久坐举牌：连续工作满 1 小时（中途没有超过 2 分钟的休息），猫举起一块
// 「起来动动！」的牌子催你休息。你继续打字它就把牌子举得更高、晃得更凶；
// 摸摸头表示知道了，牌子收起来、计时清零重新算。
// 调试：?demo=sit&loop=1（立刻举牌）或 &at=毫秒 冻结
(function () {
  'use strict';

  const BREAK_MS = 120000;       // 手停这么久算休息过
  const WORK_LIMIT = 60 * 60000; // 连续工作这么久开始举牌
  const NAG_EVERY = 60000;       // 举牌后继续干活，多久催一次
  const RISE_MS = 450;           // 牌子升起动画

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const $ = (id) => document.getElementById(id);

  function create(ctx, opts = {}) {
    const { S, STATES } = ctx;
    const demo = opts.demo && opts.demo.name === 'sit' ? opts.demo : null;
    const W = {
      workStart: performance.now(),  // 本轮连续工作的起点
      lastKey: -1e9,
      shown: false, showAt: -1e9,
      lastNag: -1e9,
      acked: false,                  // 摸头确认过
      downAt: -1e9,
      lastAckCheck: 0,
    };

    // 牌子：立杆 + 手写板（放在猫左侧，别挡键盘）
    $('bubble-layer').insertAdjacentHTML('beforebegin', `
      <g id="sit-sign" style="opacity:0">
        <rect class="sit-post" x="-5" y="-96" width="10" height="120" rx="4"/>
        <g id="sit-board">
          <rect class="sit-board" x="-72" y="-160" width="144" height="66" rx="10"/>
          <text class="sit-text" x="0" y="-120">起来动动！</text>
          <text class="sit-sub" x="0" y="-104">坐 1 小时啦</text>
        </g>
      </g>`);
    const E = { sign: $('sit-sign'), board: $('sit-board') };

    function afterKeyDown(code, now) {
      if (W.lastKey > 0 && now - W.lastKey >= BREAK_MS) {
        W.workStart = now; // 中途休息够了，重新计时
        if (W.shown) hide(now);
      }
      W.lastKey = now;
    }

    function hide(now, acked) {
      W.shown = false;
      W.downAt = now;
      if (acked) {
        W.acked = true;
        W.workStart = now;
        ctx.fx.spawn('真乖', 400, 100, 'hot', performance.now());
      }
    }

    function pose(now, dt, rm, P) {
      const working = S.state === STATES.AWAKE && !S.pet && now - W.lastKey < BREAK_MS;
      const workTime = now - W.workStart;

      // 摸头 = 收到
      if (W.shown && S.pet) hide(now, true);

      // 触发
      const maybeShow = () => {
        W.shown = true; W.showAt = now; W.lastNag = now;
        ctx.fx.spawn('起来动动！', 250, 120, 'angry', performance.now());
        if (window.SillySounds) window.SillySounds.play('meow');
      };
      if (demo) {
        if (!W.shown && W.downAt < 0) { W.workStart = now - WORK_LIMIT; W.lastKey = now; maybeShow(); }
      } else if (!W.shown && working && workTime >= WORK_LIMIT && S.state === STATES.AWAKE) {
        maybeShow();
      }

      // 举牌后一直干：周期性催
      if (W.shown && !demo && now - W.lastKey < 4000 && now - W.lastNag >= NAG_EVERY) {
        W.lastNag = now;
        ctx.fx.spawn('快起来！', 250, 116, 'angry', performance.now());
      }

      // 牌子动画：升起 / 举更高 / 收下
      let op = 0, rise = 0;
      if (W.shown) {
        const k = easeOut(clamp01((now - W.showAt) / RISE_MS));
        op = k;
        rise = 60 * k;
        // 举牌后继续打字：牌子举得更高、晃
        const nagK = !demo && now - W.lastKey < 4000 ? 1 : 0;
        rise += 34 * nagK;
        E.board.setAttribute('transform', `rotate(${(nagK ? 3 : 1.2) * Math.sin(now / 130)} 0 -96)`);
        // 猫看牌子一眼
        P.look = { x: 240, y: 220 };
        P.earDroop += 2;
      } else if (W.downAt > 0 && now - W.downAt < RISE_MS) {
        op = 1 - clamp01((now - W.downAt) / RISE_MS);
        rise = 60 * (1 - clamp01((now - W.downAt) / RISE_MS));
      } else {
        E.sign.style.opacity = 0;
        return;
      }
      E.sign.style.opacity = op;
      E.sign.setAttribute('transform', `translate(190 ${(352 + 80 - rise).toFixed(1)})`);
    }

    return {
      afterKeyDown, pose,
      debugProps: {
        sit: () => (W.shown ? 'shown' : Math.round((performance.now() - W.workStart) / 1000)),
      },
    };
  }

  window.SillySitRemind = { create };
})();
