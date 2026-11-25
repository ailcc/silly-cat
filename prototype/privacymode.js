// 密码隐私模式（默认开启，没有开关）：Rust 侧 140ms 一次看一眼前台焦点，落进密码框
// （Windows 用 UIA IsPassword + Win32 ES_PASSWORD 兜底；macOS 用系统安全输入 +
// AXSecureTextField，没有辅助功能权限就静默禁用）就发「silly:privacy」事件——
// 猫立刻闭上眼睛、把头扭到一边去：我才不偷看你的密码呢。焦点离开（防抖 280ms）
// 再转回来继续干活。
// 期间输密码的键盘 / 鼠标都不惊动它（block 钩子拦下，松键放行防长按卡爪）。
// 网页版没有检测能力；演示用 ?demo=privacy&loop=1（每 5 秒切换）或 &at=毫秒 冻结不看
(function () {
  'use strict';

  function create(ctx, opts = {}) {
    const { S, STATES, fx } = ctx;
    const demo = opts.demo && opts.demo.name === 'privacy' ? opts.demo : null;
    const A = { on: false, t0: -1e9, said: false, loopNext: 0 };

    function say(now) {
      fx.spawn('我不看不看～', 400, 118, '', now);
    }

    // 桌面版：监听 Rust 的密码框检测结果
    const T = window.__TAURI__;
    if (T && T.event && !demo) {
      T.event.listen('silly:privacy', (ev) => {
        const active = !!(ev.payload && ev.payload.active);
        if (active === A.on) return;
        A.on = active;
        A.t0 = performance.now();
        if (active && !A.said) { say(A.t0); A.said = true; }
        if (!active) A.said = false;
      });
    }
    if (demo) {
      A.on = true;
      A.t0 = performance.now();
      if (demo.loop) A.loopNext = A.t0 + 5000;
    }

    function overrideState(now) {
      if (demo && demo.loop && now >= A.loopNext) {
        A.on = !A.on;
        A.t0 = now;
        A.loopNext = now + 5000;
        if (A.on && !A.said) { say(now); A.said = true; }
        if (!A.on) A.said = false;
      }
      return null;
    }

    // 输密码的键盘 / 鼠标都不惊动猫（松键放行，防长按把爪子钉在键帽上）
    function block(kind) {
      return A.on && kind !== 'keyUp';
    }

    // 闭眼 + 扭头到一边：不看就是不看
    function pose(now, dt, rm, P) {
      if (!A.on) return;
      if (S.state !== STATES.AWAKE || P.hideCat || P.mouseAbs) return; // 睡着 / 罢工 / 被摆布时不演
      P.eyesClosed = true;
      P.earDroop = Math.max(P.earDroop, 4);
      P.headX += 16;
      P.headY += 4;
      P.headRot += 11;
    }

    return {
      overrideState, block, pose,
      debugProps: { privacy: () => (A.on ? 'covering' : null) },
    };
  }

  window.SillyPrivacyMode = { create };
})();
