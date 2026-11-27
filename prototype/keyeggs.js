// 3/4 键彩蛋（适配成空格 / 回车，默认开启，没有开关）：
// 敲空格 → 猫像后脚蹬键盘似的，屁股往下磕一下，空格那边传来一声「咚」；
// 敲回车 → 尾巴绕过来拍一下回车键（借 tailslap 的拍键演出，键帽下沉再弹起）。
// 只在猫醒着、坐在键盘后的时候发生；发飙 / 罢工 / 睡着都不演。
// 调试：?demo=keyeggs&loop=1（循环蹬空格）&at=毫秒 冻结在蹬键盘的某一刻（回车的演出用 ?demo=tailslap 看）
(function () {
  'use strict';

  const KICK = 520; // 蹬一下的时长（屁股磕下去再起来）

  function create(ctx, opts = {}) {
    const { S, STATES, fx } = ctx;
    const demo = opts.demo && opts.demo.name === 'keyeggs' ? opts.demo : null;
    const A = { kickT0: -1e9 };

    function afterKeyDown(code, now) {
      if (demo || S.state !== STATES.AWAKE) return;
      if (code === 'Space') {
        A.kickT0 = now;
        fx.spawn('咚！', 420, 372, '', now);
        if (window.SillySounds) window.SillySounds.play('tap');
      } else if (code === 'Enter') {
        const ts = opts.tailslap && opts.tailslap();
        if (ts) ts.slap('Enter', now); // 拍键演出自己带音效和气泡
      }
    }

    function pose(now, dt, rm, P) {
      if (demo && !Number.isFinite(demo.at)) {
        // 演出循环：每 1.6 秒蹬一下，每下都带「咚！」气泡和音效；&at= 冻结协议：每帧把时间轴重新锚定
        const idx = Math.floor(now / 1600);
        A.kickT0 = idx * 1600;
        if (idx !== A.lastKick) {
          A.lastKick = idx;
          fx.spawn('咚！', 420, 372, '', now);
          if (window.SillySounds) window.SillySounds.play('tap');
        }
      } else if (demo) {
        A.kickT0 = now - demo.at;
      }
      const t = now - A.kickT0;
      if (t < 0 || t >= KICK || S.state !== STATES.AWAKE) return;
      const k = Math.sin(Math.PI * t / KICK); // 0 → 1 → 0
      P.bodyY += 7 * k;            // 屁股往下磕一下
      P.bodySY *= 1 + 0.035 * k;   // 身体压扁一点
      P.headY += 3.2 * k;          // 头跟着一起一沉
      P.headRot += -1.5 * k;
    }

    return {
      afterKeyDown, pose,
      debugProps: { kick: () => (performance.now() - A.kickT0 < KICK ? 'kicking' : null) },
    };
  }

  window.SillyKeyEggs = { create };
})();
