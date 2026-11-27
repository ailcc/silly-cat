// 拉尾巴会生气：按住尾巴往外拖，猫猛地回头哈气「嘶！」，耳朵压平，还会涨一截疲劳。
// 自己监听 pointer（不碰摸头 / 拖窗口的管线）；桌面外壳里抓尾巴不再启动窗口拖动，留给本模块。
// 调试：?demo=pull&loop=1&at=毫秒
(function () {
  'use strict';

  const PULL_DIST = 70;    // 拖动这么远才算"拉"
  const HISS_MS = 1300;    // 哈气多久
  const COOLDOWN = 1600;   // 两次哈气之间至少隔这么久

  function create(ctx, opts = {}) {
    const { S, STATES, clamp } = ctx;
    const $ = (id) => document.getElementById(id);
    const scene = $('scene');
    const fatigue = opts.fatigue; // 主脚本传入（fatigue.bump 涨疲劳）
    const demo = opts.demo && opts.demo.name === 'pull' ? opts.demo : null;
    const tails = [$('tail'), $('tail-front')].filter(Boolean);

    const F = { grab: null, hissAt: -1e9, until: -1e9, next: performance.now() + 800, demoInit: false };

    function awake() { return S.state === STATES.AWAKE || S.state === STATES.DROWSY; }

    function scenePoint(e) { // 屏幕坐标 -> 画面坐标
      const m = scene.getScreenCTM();
      return m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : null;
    }

    function trigger(e, now) {
      F.hissAt = now;
      F.until = now + HISS_MS;
      if (fatigue && fatigue.bump) fatigue.bump(0.22); // 被拉尾巴当然更烦躁
      if (window.SillyAffection) window.SillyAffection.add(-2); // 被拉尾巴，掉好感
      S.shakeStart = now;
      const p = e ? scenePoint(e) : null;
      const x = p ? clamp(p.x, 120, 680) : 250, y = p ? clamp(p.y, 120, 560) : 330;
      ctx.fx.spawn(window.SillyLines.get('pullTail'), x, y - 26, 'angry', now);
      if (window.SillySounds) window.SillySounds.play('hiss');
    }

    // ---------- 自己的 pointer 监听：只盯着尾巴 ----------
    function onDown(e) {
      if (e.button !== 0 || now2() < F.until || !awake()) return;
      if (!tails.some((n) => n.contains(e.target))) return;
      F.grab = { x: e.clientX, y: e.clientY, dist: 0 };
    }
    function onMove(e) {
      if (!F.grab) return;
      if (e.pointerType === 'mouse' && !(e.buttons & 1)) { F.grab = null; return; }
      F.grab.dist += Math.hypot(e.clientX - F.grab.x, e.clientY - F.grab.y);
      F.grab.x = e.clientX; F.grab.y = e.clientY;
      if (F.grab.dist >= PULL_DIST && awake()) {
        trigger(e, now2());
        F.grab = null;
      }
    }
    function onUp() { F.grab = null; }
    const now2 = () => performance.now();

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    function pose(now, dt, rm, P) {
      if (demo && Number.isFinite(demo.at)) {
        // 冻结调试：从第一帧起就锁死在时间轴上
        if (!F.demoInit) { F.demoInit = true; trigger(null, now); }
        F.hissAt = now - demo.at;
        F.until = F.hissAt + HISS_MS;
      } else if (demo && now >= F.next && awake()) {
        trigger(null, now);
        F.next = now + 2600;
      }
      const t = now - F.hissAt;
      if (t < 0 || t >= HISS_MS) return;
      // 猛回头：脸水平翻过去看向尾巴（1 -> -0.9），耳朵压平，头一点点哈气地抖
      const k = clamp(t / 180, 0, 1), fade = 1 - t / HISS_MS;
      P.headSX = 1 - 1.9 * k;
      P.earDroop += 18 * k;
      P.lidMin = Math.max(P.lidMin || 0, 0.4);
      P.headRot += (2.5 * Math.sin(now / 45)) * fade;
    }

    return {
      pose,
      debugProps: { pull: () => (F.until > performance.now() ? 'hiss' : null) },
    };
  }

  window.SillyPullTail = { create };
})();
