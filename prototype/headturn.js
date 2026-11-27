// 2.5D 球面转头 + 捕猎态：
// - 转头：在眼睛跟着鼠标看的基础上，头也朝指针方向微微转过去——球面近似：横向转头时
//   头会稍稍变窄（球面透视），上下看时头跟着俯仰，像整颗头在转而不只是眼珠动。
// - 捕猎态：快速晃鼠标（半秒内划过很长一段路）会触发捕猎本能：瞳孔放大、身子压低、
//   耳朵压后、头死死盯住指针、尾巴兴奋地摆；停手后慢慢放松回来。
//   和「扑鼠标」的蓄势（pounce.js）叠加演出，互不抢戏。
// 设置里有开关（默认开）。
// 调试：?demo=headturn&at=毫秒 冻结（指针沿椭圆轨道转到某一刻）；&hunt=1 冻结在捕猎态
(function () {
  'use strict';

  const HUNT_PATH = 700;  // 半秒窗口内的指针行程（场景单位）超过它就进捕猎态
  const HUNT_HOLD = 900;  // 停手后捕猎态再保持的时长

  function create(ctx, opts = {}) {
    const { S, STATES, fx, clamp, approach } = ctx;
    const demo = opts.demo && opts.demo.name === 'headturn' ? opts.demo : null;
    const sceneEl = document.getElementById('scene');
    const A = { on: true, nx: 0, ny: 0, huntK: 0, huntUntil: -1e9, trail: [], lastPtrAt: -1, said: false };
    const f = (v) => Math.round(v * 100) / 100;

    // 屏幕（视口）坐标 -> 场景坐标
    function toScene(px, py) {
      const ctm = sceneEl && sceneEl.getScreenCTM();
      if (!ctm) return null;
      const p = new DOMPoint(px, py).matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    }

    function pointerScene(now) {
      if (demo) {
        // 演示：指针沿椭圆轨道转（&at= 冻结在某一刻）；&hunt=1 固定在鼠标位置演捕猎
        if (demo.hunt) return { x: 140, y: 500 };
        const t = Number.isFinite(demo.at) ? demo.at : now;
        return { x: 400 + 330 * Math.cos(t * 0.0012), y: 250 + 240 * Math.sin(t * 0.0012) };
      }
      return S.pointer ? toScene(S.pointer.x, S.pointer.y) : null;
    }

    function pose(now, dt, rm, P) {
      if (!A.on) return;
      if (demo && demo.hunt) A.huntUntil = now + 1e9; // 捕猎演示：直接按住捕猎态
      const p = pointerScene(now);
      // 捕猎态：统计最近半秒的指针行程
      if (!demo && p && S.pointer && S.pointer.at !== A.lastPtrAt) {
        A.lastPtrAt = S.pointer.at;
        A.trail.push({ x: p.x, y: p.y, t: now });
      }
      A.trail = A.trail.filter((s) => now - s.t <= 500);
      let path = 0;
      for (let i = 1; i < A.trail.length; i++) {
        path += Math.hypot(A.trail[i].x - A.trail[i - 1].x, A.trail[i].y - A.trail[i - 1].y);
      }
      if (path >= HUNT_PATH) {
        if (!A.said && A.huntK < 0.2) {
          A.said = true;
          fx.spawn(window.SillyLines.get('stare'), 505, 130, '', now);
        }
        A.huntUntil = now + HUNT_HOLD;
      } else if (A.huntK < 0.05) A.said = false;
      const hunting = now < A.huntUntil;
      A.huntK = approach(A.huntK, hunting ? 1 : 0, dt, hunting ? 110 : 380);

      // 球面转头：头朝指针方向转过去（睡着 / 转身中 / 被摆布时不转）
      const awake = S.state !== STATES.ASLEEP && P.turnSX === 1 && !P.hideCat && !P.mouseAbs;
      if (p && awake) {
        const k = (S.state === STATES.DROWSY ? 0.5 : 1) * (1 + 0.4 * A.huntK);
        const nx = clamp((p.x - 400) / 340, -1, 1), ny = clamp((p.y - 250) / 280, -1, 1);
        A.nx = approach(A.nx, nx, dt, 130);
        A.ny = approach(A.ny, ny, dt, 130);
        P.headX += A.nx * 9 * k;
        P.headY += A.ny * 6 * k;
        P.headRot += A.nx * 5.5 * k;
        P.headSX *= 1 - Math.abs(A.nx) * 0.055 * k; // 球面透视：侧转头时头的横向微微变窄
        P.headSY *= 1 - Math.abs(A.ny) * 0.03 * k;
      } else {
        A.nx = approach(A.nx, 0, dt, 260);
        A.ny = approach(A.ny, 0, dt, 260);
      }

      // 捕猎态：瞳孔放大、身子压低、耳朵压后、盯住指针、尾巴兴奋
      if (A.huntK > 0.01) {
        const k = A.huntK;
        P.pupilR = 13 + 6 * k;
        P.lidMin = Math.max(P.lidMin, 0.02);
        P.bodyY += 9 * k;
        P.bodySY *= 1 + 0.045 * k;
        P.headY += 4 * k;
        P.earDroop += 2.5 * k;
        P.tailAmp = (P.tailAmp ?? 9) + 6 * k;
        P.tailSpeed += 0.012 * k;
        if (p && awake) P.look = p;
      }
    }

    function setEnabled(on) { A.on = !!on; }

    return {
      pose, setEnabled,
      debugProps: { headTurn: () => (A.on ? `${f(A.nx)},${f(A.ny)} hunt=${f(A.huntK)}` : 'off') },
    };
  }

  window.SillyHeadTurn = { create };
})();
