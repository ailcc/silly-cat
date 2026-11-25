// 尾巴拍键：打字的时候，大猫的尾巴偶尔从身子后面绕过来，「啪」地拍一下你刚按过的
// 键帽——键帽往下沉一下再弹回去，尾巴收回去继续打字。低频随机（两次拍键间隔
// 6–14 秒），只在醒着打字时发生。设置里有开关（默认开）。
// 回车键彩蛋（keyeggs.js）也借用这里的拍键演出。
// 调试：?demo=tailslap&loop=1 循环演出；&at=毫秒 冻结在拍键时间轴的某一刻
(function () {
  'use strict';

  const OUT = 300;   // 甩过去（尾根先动、尾尖最后落）
  const HOLD = 230;  // 按在键帽上
  const BACK = 560;  // 收回来
  const CD_MIN = 6000, CD_MAX = 14000; // 自动拍键的最长 / 最短间隔
  // 拍键姿势的控制点（画面坐标）；尾根三段固定，后三段瞄准目标键帽
  function slapCtrl(tx, ty, bx, by, side) {
    const m = side === 'L' ? 1 : -1;               // 'L' = 从画面左边绕（尾根常规侧），右边整条镜像
    const X = (x) => 400 + m * (x - 400);
    return [
      { x: X(322) + bx, y: 370 + by },             // 尾根，藏在身体后面
      { x: X(286) + bx, y: 360 + by },             // 从身体侧面绕出来
      { x: X(222) + bx * 0.5, y: 344 + by * 0.5 }, // 抬起来拱一段
      { x: tx - m * 86, y: ty - 132 },             // 到目标键上后方
      { x: tx - m * 30, y: ty - 42 },              // 贴着键帽上沿压下去
      { x: tx, y: ty - 5 },                        // 尾尖盖在键帽正中
    ];
  }

  function create(ctx, opts = {}) {
    const { S, STATES, kb, fx, clamp, catmull, resample } = ctx;
    const demo = opts.demo && opts.demo.name === 'tailslap' ? opts.demo : null;
    const A = { enabled: true, active: null, next: 6000, demoWait: 0 };
    const rand = (a, b) => a + Math.random() * (b - a);
    const ease = (t) => { const x = clamp(t, 0, 1); return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x); };

    // 发起一次拍键：瞄准某颗键帽（画面坐标由键盘模块给出）
    function slap(code, now) {
      if (A.active || S.state !== STATES.AWAKE) return false;
      const c = kb.center(code);
      if (!c) return false;
      A.active = { code, tx: c.x, ty: c.y, t0: now, side: c.x < 400 ? 'L' : 'R', pressed: false, popped: false };
      return true;
    }

    // 打字时低频随机拍一下刚按过的键（空格留给蹬键盘彩蛋，不拍）
    function afterKeyDown(code, now) {
      if (demo) return;
      if (!A.enabled || A.active || code === 'Space') return;
      if (now < A.next || Math.random() < 0.4) return;
      if (slap(code, now)) A.next = now + rand(CD_MIN, CD_MAX) + 1200; // 拍完再排下一次
    }

    function pose(now, dt, rm, P) {
      if (demo) {
        // 冻结协议：时间轴锚定在 demo.at，目标固定回车键
        if (Number.isFinite(demo.at)) {
          if (!A.active) slap('Enter', now);
          if (A.active) A.active.t0 = now - demo.at; // 只锚定时间轴，pressed / popped 保持首帧的触发结果
        } else if (!A.active && now >= A.demoWait) { // 循环演出：拍完歇 800ms 再来
          if (slap('Enter', now)) A.demoWait = now + (OUT + HOLD + BACK) + 800;
        }
      }
      const a = A.active;
      if (!a) return;
      const t = now - a.t0;
      const total = OUT + HOLD + BACK;
      if (t >= total) { // 演出结束，尾巴交还给正常逻辑
        if (a.pressed) { kb.setDown(a.code, false); kb.pop(a.code); }
        A.active = null;
        return;
      }
      // 键帽的按下 / 弹起和音效、气泡按时间点触发
      if (t >= OUT && !a.pressed) {
        a.pressed = true;
        kb.setDown(a.code, true);
        fx.spawn('啪', a.tx, a.ty - 42, '', now);
        if (window.SillySounds) window.SillySounds.play('tap');
      }
      if (t >= OUT + HOLD && !a.popped) {
        a.popped = true;
        kb.setDown(a.code, false);
        kb.pop(a.code);
      }
      // 拍键姿势：OUT 段从当前姿势甩过去，HOLD 段按住（尾尖再往下压一点），BACK 段收回来
      const e = t < OUT ? ease(t / OUT) : t < OUT + HOLD ? 1 : 1 - ease((t - OUT - HOLD) / BACK);
      const dip = t >= OUT && t < OUT + HOLD ? 5 * Math.sin(Math.PI * clamp((t - OUT) / 160, 0, 1)) : 0;
      const ctrl = slapCtrl(a.tx, a.ty + dip, 0, 0, a.side);
      const curve = catmull(ctrl, 10);
      P.tailOverride = (now2, base) => {
        // 按宿主尾巴的实际点数重采样后逐点对齐：写死点数会和 cat.js 的 TAIL_N 隐式耦合，
        // 哪天 TAIL_N 一改，尾尖就悄悄够不到键帽了
        const slapPts = resample(curve, base.length);
        return base.map((p, i) => {
          const q = slapPts[i], s = i / (base.length - 1);
          const lift = 46 * Math.sin(Math.PI * clamp(e, 0, 1)) * s; // 中段抬起来，像把尾巴甩过去
          return { x: p.x + (q.x - p.x) * e, y: p.y + (q.y - p.y) * e - lift };
        });
      };
    }

    function setEnabled(on) { A.enabled = !!on; }

    return {
      afterKeyDown, pose, slap, setEnabled,
      debugProps: { tailSlap: () => (A.active ? A.active.code : null) },
    };
  }

  window.SillyTailSlap = { create };
})();
