// 连戳猫会烦：在头上连拍好几下（每次都是一次很短的摸头），猫就不耐烦了，
// 耳朵压下去、扭头甩脑袋，挥起左爪把你的手拍开，头顶还「哼」一声，拍开期间不让你摸。
// 调试：?demo=poke&loop=1&at=毫秒
(function () {
  'use strict';

  const TAP_GAP = 900;   // 两次摸头间隔不超过这么久算"连戳"
  const ANNOY_AT = 4;    // 连戳这么多下就烦
  const SWAT_MS = 850;   // 拍开的动作时长

  function create(ctx, opts = {}) {
    const { S, STATES, clamp } = ctx;
    const demo = opts.demo && opts.demo.name === 'poke' ? opts.demo : null;
    const F = { count: 0, lastPet: -1e9, swatAt: -1e9, until: -1e9, next: performance.now() + 800, taps: 0, demoInit: false };

    function trigger(now) {
      F.swatAt = now;
      F.until = now + SWAT_MS;
      F.count = 0;
      F.lastPet = -1e9;
      S.shakeStart = now;               // 甩脑袋
      ctx.fx.spawn(window.SillyLines.get('poke'), 548, 108, 'angry', now);
      if (window.SillySounds) window.SillySounds.play('meow');
      if (window.SillyAffection) window.SillyAffection.add(-1); // 被戳烦了，掉一点好感
    }

    // 每次摸头（petStart）都会经过 block，这里顺便数连戳；烦了就挡掉这次摸头
    function block(kind, arg, now) {
      if (kind !== 'petStart') return false;
      if (now < F.until) return true;   // 正拍开：不给摸
      if (now - F.lastPet <= TAP_GAP) F.count++;
      else F.count = 1;
      F.lastPet = now;
      if (F.count >= ANNOY_AT) { trigger(now); return true; }
      return false;
    }

    // 挥爪拍开：朝头顶的手抬爪，再往斜上方扇出去
    function forcedPawTarget(paw, now) {
      if (now >= F.until || paw.side !== 'L') return null;
      const t = now - F.swatAt;
      const h = ctx.headToScene(470, 96);
      if (t < 320) return { id: 'poke', x: h.x, y: h.y, tau: 40 };
      if (t < 560) return { id: 'poke', x: h.x + 130, y: h.y + 30, tau: 14, pressing: true };
      return { id: 'poke', x: h.x + 100, y: h.y + 46, tau: 90 };
    }

    function pose(now, dt, rm, P) {
      if (demo && Number.isFinite(demo.at)) {
        // 冻结调试：从第一帧起就锁死在时间轴上，不依赖触发计时
        if (!F.demoInit) { F.demoInit = true; trigger(now); }
        F.swatAt = now - demo.at;
        F.until = F.swatAt + SWAT_MS;
      } else if (demo && now >= F.next && S.state === STATES.AWAKE) {
        // demo：模拟四连戳，到第 4 下就拍
        F.taps++;
        if (F.taps >= ANNOY_AT) {
          F.taps = 0;
          trigger(now);
          F.next = now + 2600;
        } else F.next = now + 260;
      }
      const t = now - F.swatAt;
      if (t < 0 || t >= SWAT_MS) return;
      const k = clamp(t / 200, 0, 1);
      P.earDroop += 14 * k;      // 耳朵压下去
      P.lidMin = Math.max(P.lidMin || 0, 0.45);
      P.headRot -= 6 * k;        // 头扭开一点
    }

    return {
      block, forcedPawTarget, pose,
      debugProps: { poke: () => (F.until > performance.now() ? F.count : null) },
    };
  }

  window.SillyPoke = { create };
})();
