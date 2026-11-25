// 键盘跑马灯流光：打字的时候，键帽上泛起一层柔和的彩虹流光，从左往右轮转；
// 打字越快，流光转得越快、颜色越明显；停手一小会儿，光就慢慢熄掉。
// 手绘风上做得很轻（半透明色罩叠在键帽上），不会盖过键帽本身的质感。
// 设置里有开关（默认开）；系统开了「减弱动态效果」时不闪。
// 调试：?demo=kbdflow&at=毫秒 冻结（按 ~4 键/秒 的节奏演出）
(function () {
  'use strict';

  const MAX_ALPHA = 0.42;  // 流光最深时的不透明度
  const FADE_TAU = 420;    // 停手后光熄灭的平滑时长
  const RISE_TAU = 120;    // 开始打字时亮起的时长

  function create(ctx, opts = {}) {
    const { clamp, approach } = ctx;
    const demo = opts.demo && opts.demo.name === 'kbdflow' ? opts.demo : null;
    const A = { on: true, level: 0, hue: 200, hits: [], dark: true };

    // 键帽流光层：复制每颗键帽的几何，叠在键帽和键字上面（kb-keys 组自带 180° 旋转）
    const keysG = document.querySelector('#keyboard .kb-keys');
    const caps = [];
    if (keysG) {
      for (const cap of keysG.querySelectorAll('.key-cap')) {
        const tint = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        for (const k of ['x', 'y', 'width', 'height', 'rx']) tint.setAttribute(k, cap.getAttribute(k));
        tint.setAttribute('fill', 'hsl(200 85% 62%)');
        tint.style.opacity = '0';
        cap.parentNode.appendChild(tint);
        caps.push({ el: tint, x: +cap.getAttribute('x') });
      }
    }
    function hideAll() {
      for (const { el } of caps) el.style.opacity = '0';
      A.dark = true;
    }

    function afterKeyDown(code, now) {
      if (demo || !A.on) return;
      A.hits.push(now);
    }

    function pose(now, dt, rm, P) {
      if (!A.on || !caps.length) return;
      if (rm) { A.level = approach(A.level, 0, dt, FADE_TAU); if (A.dark) return; hideAll(); return; }
      // 打字节奏 = 最近 1 秒内的按键数；演示模式按 ~4 键/秒 的固定节奏演
      if (demo) {
        A.hits = [0, 1, 2, 3].map((i) => (Number.isFinite(demo.at) ? demo.at : now) - i * 220);
      } else {
        A.hits = A.hits.filter((t) => now - t <= 1000);
      }
      const kps = A.hits.length;
      const target = kps >= 1 ? clamp(0.3 + kps / 8, 0.3, 1) : 0;
      A.level = approach(A.level, target, dt, target > A.level ? RISE_TAU : FADE_TAU);
      // 色相整体轮转：打字越快转得越快；相邻键按 x 错开色相，形成从左往右的彩虹波
      A.hue = (A.hue + dt * (40 + 300 * A.level)) % 360;
      if (A.level < 0.01) { if (!A.dark) hideAll(); return; }
      A.dark = false;
      const alpha = (MAX_ALPHA * A.level).toFixed(3);
      for (const { el, x } of caps) {
        const hue = ((A.hue - x * 0.45) % 360 + 360) % 360;
        el.setAttribute('fill', `hsl(${hue.toFixed(0)} 85% 62%)`);
        el.style.opacity = alpha;
      }
    }

    function setEnabled(on) {
      A.on = !!on;
      if (!A.on) hideAll();
    }

    return {
      afterKeyDown, pose, setEnabled,
      debugProps: { kbdFlow: () => (A.on ? Math.round(A.level * 100) / 100 : 'off') },
    };
  }

  window.SillyKbdFlow = { create };
})();
