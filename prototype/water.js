// 喝水提醒：每隔 40–70 分钟，猫把一杯水推到你面前盯着你看——「该喝水了」。
// 摸摸头表示喝过了，杯子收回去、进入下一轮计时；晾 90 秒不理它，它自己收回去，
// 但会提前（约 30 分钟后）再提醒。杯子只是表演道具，不会真被推下桌。
// 调试：?demo=water&loop=1（杯子立刻滑进来）或 &at=毫秒 冻结
(function () {
  'use strict';

  const EVERY = [40 * 60000, 70 * 60000]; // 两轮提醒之间
  const SOON = 30 * 60000;                // 被晾了之后提前多久再来
  const IGNORE_MS = 90000;                // 晾这么久算没理它
  const SLIDE_MS = 700;                   // 杯子滑入/滑出动画
  const IDLE_MIN = 4000;

  const rand = (a, b) => a + Math.random() * (b - a);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const $ = (id) => document.getElementById(id);

  // 桌面坐标：滑入终点在鼠标垫右侧（不挡鼠标和键盘）
  const END_X = 610, END_Y = 500, OUT_X = 840;

  function create(ctx, opts = {}) {
    const { S, STATES } = ctx;
    const demo = opts.demo && opts.demo.name === 'water' ? opts.demo : null;
    const W = {
      next: performance.now() + (demo ? 800 : rand(EVERY[0], EVERY[1])),
      phase: null,          // in | wait | out
      start: 0,
      said: false,
    };

    // 水杯：小一点的杯子，蓝色的水
    $('bubble-layer').insertAdjacentHTML('beforebegin', `
      <g id="water-cup" style="opacity:0">
        <path class="wc-body" d="M -22 -44 L 22 -44 L 18 40 Q 17 46 10 46 L -10 46 Q -17 46 -18 40 Z"/>
        <path class="wc-water" d="M -19 -22 L 19 -22 L 16.6 36 Q 16 40 10 40 L -10 40 Q -16 40 -16.6 36 Z"/>
        <path class="wc-rim" d="M -24 -44 L 24 -44"/>
        <ellipse class="wc-shine" cx="-9" cy="-6" rx="3.5" ry="14"/>
      </g>`);
    const E = { cup: $('water-cup') };

    function startRemind(now) {
      W.phase = 'in'; W.start = now; W.said = false;
    }
    function retract(now, soon) {
      W.phase = 'out'; W.start = now;
      if (!demo) W.next = now + (soon ? SOON : rand(EVERY[0], EVERY[1]));
    }

    function pose(now, dt, rm, P) {
      if (demo) {
        if (!W.phase && now >= W.next) { startRemind(now); W.next = 1e12; }
      } else if (!W.phase && S.state === STATES.AWAKE && !S.pet && !S.excited
                 && now - S.lastInput >= IDLE_MIN && now >= W.next
                 && !(window.SillyTypeRhythm && window.SillyTypeRhythm.covering && window.SillyTypeRhythm.covering())
                 && !(window.SillyListenMusic && window.SillyListenMusic.listening && window.SillyListenMusic.listening())) {
        startRemind(now);
      }
      if (!W.phase) return;
      const t = now - W.start;

      if (W.phase === 'in') {
        const k = easeOut(clamp01(t / SLIDE_MS));
        E.cup.style.opacity = k;
        E.cup.setAttribute('transform', `translate(${(OUT_X + (END_X - OUT_X) * k).toFixed(1)} ${END_Y}) scale(0.9)`);
        if (t >= SLIDE_MS) {
          W.phase = 'wait'; W.start = now;
          if (!W.said) {
            W.said = true;
            ctx.fx.spawn('该喝水了', 520, 130, '', performance.now());
            if (window.SillySounds) window.SillySounds.play('tap');
          }
        }
      } else if (W.phase === 'wait') {
        // 猫盯着杯子和你
        P.look = { x: END_X, y: END_Y - 40 };
        P.earDroop += 3;
        P.headRot += 4;
        // 摸头 = 喝过了
        if (S.pet) {
          retract(now, false);
          ctx.fx.spawn('真乖', 400, 100, 'hot', performance.now());
          if (window.SillySounds) window.SillySounds.play('meow');
        } else if (!demo && now - W.start >= IGNORE_MS) {
          retract(now, true); // 晾了：提前再来
        } else if (demo && now - W.start >= 4000) {
          retract(now, false);
        }
      } else if (W.phase === 'out') {
        const k = easeOut(clamp01(t / SLIDE_MS));
        E.cup.style.opacity = 1 - k;
        E.cup.setAttribute('transform', `translate(${(END_X + (OUT_X - END_X) * k).toFixed(1)} ${END_Y}) scale(0.9)`);
        if (t >= SLIDE_MS) { W.phase = null; E.cup.style.opacity = 0; }
      }
    }

    return {
      pose,
      debugProps: {
        water: () => W.phase,
        waterNext: () => Math.round(W.next - performance.now()),
      },
    };
  }

  window.SillyWater = { create };
})();
