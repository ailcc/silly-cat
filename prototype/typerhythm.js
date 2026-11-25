// 打字节奏反应：你打字飞快时猫看得眼都圆了，冒一句「好快！」；
// 连续狂敲 10 秒它会捂耳朵喊「耳朵要炸了！」，收手后松口气「呼…」。
// 按键统计借用现有 S.excited 的口径（基础代码已经在高速时放大瞳孔），这里只补姿态和台词。
// 调试：?demo=fasttype&loop=1&at=毫秒（假装你在疯狂输出）
(function () {
  'use strict';

  const FAST_KPS = 8;         // 每秒超过这几个键算「快」
  const FAST_MS = 1500;       // 持续这么久才冒「好快！」
  const POUND_MS = 10000;     // 快速持续这么久开始捂耳朵
  const REST_GAP = 1500;      // 手停这么久算收手
  const CALM_DOWN = 30000;    // 捂耳朵之后冷却，短时间内不再表演

  function create(ctx, opts = {}) {
    const { S, STATES, clamp } = ctx;
    const demo = opts.demo && opts.demo.name === 'fasttype' ? opts.demo : null;
    const W = {
      keys: [],            // 最近按键的时间戳
      fastSince: -1,       // 连续达到 FAST_KPS 的起点
      saidFast: false, saidCover: false, saidRelax: false,
      cover: false,        // 正在捂耳朵
      cooldownUntil: -1e9,
      lastSynth: 0,        // demo 模式的假按键
    };

    const kps = (now) => W.keys.filter((t) => now - t <= 1000).length;

    function afterKeyDown(code, now) {
      W.keys.push(now);
      if (W.keys.length > 80) W.keys.splice(0, W.keys.length - 80);
      // 打字中恢复演出状态
      if (W.cover) return;
      if (now >= W.cooldownUntil && S.state === STATES.AWAKE) {
        if (W.fastSince < 0 && kps(now) >= FAST_KPS) W.fastSince = now;
      }
    }

    // 捂耳朵要盖过打字爪位，所以用 forced（打字正欢时爪子都在键盘上，soft 抢不过基础行为）
    function forcedPawTarget(paw, now) {
      if (!W.cover) return null;
      // 双爪按住耳朵：耳朵在头部两侧偏上
      const p = ctx.headToScene(paw.side === 'L' ? 486 : 314, 152);
      return { id: 'tr-cover', x: p.x, y: p.y, tau: 60, pressing: true };
    }

    function pose(now, dt, rm, P) {
      // demo：假装在飞速敲键盘
      if (demo && !Number.isFinite(demo.at)) {
        if (now - W.lastSynth >= 90) { W.keys.push(now); W.lastSynth = now; afterKeyDown('demo', now); }
      }
      if (demo && Number.isFinite(demo.at)) {
        // 冻结 demo：把时间轴整体平移到 demo.at，制造「狂敲中」的假象
        for (let i = 0; i < 14; i++) W.keys.push(now - i * 70);
      }

      // 收手判定：距最后按键 REST_GAP 以上 → 松开耳朵、松口气、进入冷却
      const lastKey = W.keys.length ? W.keys[W.keys.length - 1] : -1e9;
      if (W.cover && now - lastKey >= REST_GAP) {
        W.cover = false;
        W.cooldownUntil = now + CALM_DOWN;
        if (!W.saidRelax) { ctx.fx.spawn('呼…', 470, 108, '', performance.now()); W.saidRelax = true; }
        W.fastSince = -1; W.saidFast = false; W.saidCover = false;
        return;
      }
      // 平时清理过期按键
      if (!demo) { while (W.keys.length && now - W.keys[0] > 4000) W.keys.shift(); }

      if (W.cover) {
        // 捂耳朵姿态：闭眼、耳朵压得更低、身子微抖
        P.eyesClosed = true;
        P.earDroop += 8;
        P.bodyRot += 1.2 * Math.sin(now / 55);
        return;
      }

      const fast = W.fastSince > 0 && kps(now) >= FAST_KPS - 1;
      if (!fast) {
        if (W.fastSince > 0 && now - lastKey >= REST_GAP) { W.fastSince = -1; W.saidFast = false; }
        return;
      }
      const held = now - W.fastSince;

      if (held >= POUND_MS) {
        if (!W.saidCover) {
          W.saidCover = true;
          W.cover = true;
          ctx.fx.spawn('耳朵要炸了！', 400, 96, 'angry', performance.now());
          if (window.SillySounds) window.SillySounds.play('hiss');
          return;
        }
      } else if (held >= FAST_MS && !W.saidFast) {
        W.saidFast = true;
        ctx.fx.spawn('好快！', 480 + (Math.random() * 2 - 1) * 20, 104, 'hot', performance.now());
      }

      // 快速打字时的姿态：眼睛瞪圆、耳朵立起、尾巴快甩
      const k = clamp(held / FAST_MS, 0, 1);
      P.lidMin = 0;
      P.earDroop -= 6 * k;
      P.headRot += 1.5 * Math.sin(now / 120) * k;
      P.tailAmp = 26; P.tailSpeed = 0.03;
    }

    return {
      afterKeyDown, pose, forcedPawTarget,
      debugProps: {
        rhythm: () => (W.cover ? 'cover' : W.fastSince > 0 ? 'fast' : null),
        kps: () => kps(performance.now()),
      },
    };
  }

  window.SillyTypeRhythm = { create };
})();
