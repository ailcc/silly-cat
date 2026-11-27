// 半夜跑酷：深夜（23 点到清晨 6 点）你闲着的时候，猫会突然压低身子、左右来回冲刺，
// 跑完喘口气趴回去。睡着了也会被自己的跑酷闹醒。只动画面，不打扰你。
(function () {
  'use strict';

  // 时间轴（毫秒，从起跑算起）
  const CROUCH = 500;
  const D1 = 500, D1E = 1100;      // 第一趟：冲向右边
  const D2 = 1100, D2E = 1700;     // 第二趟：跑回左边
  const D3 = 1700, D3E = 2300;     // 第三趟：回到原位
  const HAPPY = 3300, END = 3600;  // 喘气、得意
  const A1 = 240, A2 = 280;        // 每趟的冲刺距离
  const NIGHT_FROM = 23, NIGHT_TO = 6; // 深夜时段（24 小时制，跨午夜）
  const RECHECK = [60, 180];       // 跑完一次后，这个区间（秒）内再看要不要再来
  const DEMOS = ['zoomies'];

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (p) => { const u = clamp(p, 0, 1); return u * u * (3 - 2 * u); };

  function create(ctx, opts = {}) {
    const { S, STATES, fx, restPoint, paws } = ctx;
    const demo = opts.demo && DEMOS.includes(opts.demo.name) ? opts.demo : null;
    const frozen = demo && Number.isFinite(demo.at);

    const F = {
      runAt: -1e9, next: performance.now() + (demo ? 800 : rand(15, 35) * 1000),
      lastT: 0, demoInit: false,
    };
    const inNight = () => {
      const h = new Date().getHours();
      return h >= NIGHT_FROM || h < NIGHT_TO;
    };

    function start(now) {
      F.runAt = now;
      F.lastT = 0;
      fx.spawn(window.SillyLines.get('zoomies'), 400 + rand(-30, 30), 130, 'hot', now);
    }
    function end(now) {
      F.runAt = -1e9;
      F.next = now + rand(RECHECK[0], RECHECK[1]) * 1000 * (demo ? 0.02 : 1);
      S.lastInput = now;
    }

    function afterState(now) {
      if (frozen) return; // 冻结帧由 pose 钉住
      if (F.runAt > 0) {
        if (now - F.runAt >= END) end(now);
        return;
      }
      if (!demo && !inNight()) return;
      if (now < F.next) return;
      if (!S.pet && !S.pressed.size && !S.mouseButtons.size &&
          (demo || (now - S.lastInput >= 6000 && now - S.lastKeyAt >= 6000))) {
        start(now); // 睡着了也会跳起来跑
      }
    }

    function afterKeyDown(code, now) {
      if (F.runAt > 0) end(now); // 你开始打字就刹住
    }

    function overrideState() {
      return F.runAt > 0 ? STATES.AWAKE : null;
    }

    // 冲刺位移：三趟往返的分段缓动
    function dashX(t) {
      if (t < D1E) return A1 * ease((t - D1) / (D1E - D1));
      if (t < D2E) return A1 + (-A2 - A1) * ease((t - D2) / (D2E - D2));
      if (t < D3E) return -A2 + A2 * ease((t - D3) / (D3E - D3));
      return 0;
    }

    // 爪子：跑动时收在身下小碎步倒腾
    function softPawTarget(paw, now) {
      if (F.runAt <= 0) return null;
      const t = now - F.runAt;
      if (t < D1 || t >= D3E) return null;
      const rest = restPoint(paw.side);
      const bob = 3 * Math.sin(now * 0.045 + (paw.side === 'L' ? 0 : Math.PI));
      return { id: 'zoomies', x: rest.x + dashX(t), y: rest.y - 5 + bob, tau: 5, pressing: false };
    }

    function pose(now, dt, rm, P) {
      if (frozen) { // 冻结帧：把跑酷钉在时间轴上，方便调试截图
        F.demoInit = true;
        F.runAt = now - demo.at;
      }
      if (F.runAt <= 0) return;
      const t = now - F.runAt;
      S.lastInput = now;

      // 每趟起跑冒个「咻」
      for (const d of [D1, D2, D3]) {
        if (F.lastT < d && t >= d) fx.spawn('咻', 400 + dashX(t) + rand(-20, 20), 150 + rand(-10, 10), '', now);
      }
      F.lastT = t;

      if (t < CROUCH) {
        const e = ease(t / CROUCH);
        P.bodyY += 7 * e; P.headY += 7 * e;          // 压低身子蓄势
        P.earDroop += 8 * e;
        P.look = { x: 400 + (Math.sin(t * 0.02) > 0 ? 160 : -160), y: 240 }; // 眼珠乱转找方向
        P.tailAmp = Math.max(P.tailAmp || 0, 6);
      } else if (t < D3E) {
        const dx = dashX(t);
        P.bodyX += dx; P.headX += dx;                 // 头和身体一起跑
        P.bodyY += 5 + 2 * Math.sin(now * 0.05);      // 奔跑的颠簸
        P.headY += 5;
        P.bodyRot += 5 * Math.sign(dx || 1) * (t < D2 ? 1 : -1); // 顺着跑的方向倾斜
        P.earDroop += 8;
        P.look = { x: 400 + dx + (t < D2 ? 120 : -120), y: 230 };
        P.tailAmp = Math.max(P.tailAmp || 0, 16);
        P.tailSpeed = 0.02;
      } else {
        P.eyesHappy = true;                            // 跑完美滋滋地喘气
        P.headY += 3 * Math.sin(now * 0.02);
        P.tailAmp = Math.max(P.tailAmp || 0, 18);
        P.tailSpeed = 0.014;
      }
    }

    return {
      afterState, afterKeyDown, overrideState, softPawTarget, pose,
      debugProps: { zoomies: () => (F.runAt > 0 ? Math.floor(performance.now() - F.runAt) : inNight() ? 'night' : null) },
    };
  }

  window.SillyZoomies = { create };
})();
