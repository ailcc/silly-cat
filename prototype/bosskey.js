// 摸鱼老板键：连按两下 Esc（350ms 内，中间没混别的键），猫瞬间趴下装睡——
// 眼睛闭上、脑袋耷拉、耳朵压平；再连按两下 Esc 秒醒，「喵？！」装无辜。
// 只有 Esc：打字、点鼠标都不打断装睡（老板就在背后，动不得）。
// 调试：?demo=boss&loop=1（每 3 秒自动切换）或 &at=毫秒 冻结在装睡姿态
(function () {
  'use strict';

  const GAP = 350; // 两下 Esc 的判定窗口

  function create(ctx, opts = {}) {
    const { S, STATES, fx } = ctx;
    const demo = opts.demo && opts.demo.name === 'boss' ? opts.demo : null;
    const B = {
      on: false,
      lastEsc: -1, otherKey: false,
      nextAuto: 0, // demo 自动切换
    };
    const AWAKE_LIKE = new Set([STATES.AWAKE, STATES.DROWSY, STATES.PETTED]);

    function toggle(now) {
      B.on = !B.on;
      if (B.on) fx.spawn('呼——睡着的猫', 400, 92, '', now);
      else fx.spawn('喵？！', 400, 92, 'hot', now);
    }

    function afterKeyDown(code, now) {
      if (demo) return;
      if (code === 'Escape') {
        // 双击 Esc：两下之间没混别的键（单按 Esc 不触发别的功能，安全）
        if (B.lastEsc > 0 && !B.otherKey && now - B.lastEsc <= GAP && now - B.lastEsc > 25) {
          B.lastEsc = -1; B.otherKey = false;
          toggle(now);
        } else { B.lastEsc = now; B.otherKey = false; }
      } else if (B.lastEsc > 0) {
        B.otherKey = true;
      }
    }

    function pose(now, dt, rm, P) {
      if (demo) {
        if (Number.isFinite(demo.at)) {
          if (!B.frozenInit) { B.frozenInit = true; B.on = true; }
        } else {
          if (now >= B.nextAuto) { toggle(now); B.nextAuto = now + 3000; }
        }
      }
      // 装睡姿态：只在醒着的几个状态下盖一层（真睡着 / 罢工时不画蛇添足）
      if (!B.on || !AWAKE_LIKE.has(S.state)) return;
      P.eyesClosed = true;
      P.eyesHappy = false;
      P.headY += 30;       // 脑袋耷拉到键盘上
      P.headRot += 4;
      P.earDroop += 20;    // 耳朵压平
      P.bodyY += 3;
      P.tailAmp = 1;
      P.lidMin = 1;
    }

    return {
      afterKeyDown, pose,
      debugProps: { boss: () => (B.on ? '装睡中' : null) },
    };
  }

  window.SillyBossKey = { create };
})();
