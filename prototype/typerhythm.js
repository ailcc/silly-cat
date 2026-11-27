// 打字节奏反应：你打字飞快时猫看得眼都圆了，冒一句「好快！」；
// 连续狂敲 10 秒它会捂住耳朵，头顶挂一个「吵死了 N」的倒数气泡——倒数到 0 就把爪子
// 放回键盘，松口气「呼…」。倒数期间你继续打字它也不撒手（固定时长，不再看收手）。
// 按键统计借用现有 S.excited 的口径（基础代码已经在高速时放大瞳孔），这里只补姿态和台词。
// 调试：?demo=fasttype&loop=1（假装你在疯狂输出，10 秒后捂耳朵、倒数 8 秒）
(function () {
  'use strict';

  const FAST_KPS = 8;         // 每秒超过这几个键算「快」
  const FAST_MS = 1500;       // 持续这么久才冒「好快！」
  const POUND_MS = 10000;     // 快速持续这么久开始捂耳朵
  const COVER_HOLD = 8000;    // 捂耳朵固定时长：倒数从这一秒开始，倒数完爪子放回键盘
  const REST_GAP = 1500;      // 手停这么久算收手（只用于「好快」状态的复位）
  const CALM_DOWN = 30000;    // 捂耳朵之后冷却，短时间内不再表演

  // 倒数气泡：常驻显示「吵死了 N」，每秒更新数字，捂完整个收掉。
  // fx.spawn 的气泡会上浮淡出，不适合长驻，所以这里自管一个同款样式的节点。
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let bubble = null, bubbleRect = null, bubbleText = null, bubbleSec = -1;

  function hideBubble() {
    if (bubble) { bubble.remove(); bubble = bubbleRect = bubbleText = null; bubbleSec = -1; }
  }
  function showBubble(sec) {
    if (sec === bubbleSec) return;
    if (!bubble) {
      const layer = document.getElementById('fx-layer');
      if (!layer) return;
      bubble = document.createElementNS(SVG_NS, 'g');
      bubble.setAttribute('class', 'keycap-fx angry');
      bubble.setAttribute('transform', 'translate(400 88)');
      bubbleRect = document.createElementNS(SVG_NS, 'rect');
      bubbleRect.setAttribute('y', -17);
      bubbleRect.setAttribute('height', 34);
      bubbleRect.setAttribute('rx', 9);
      bubbleText = document.createElementNS(SVG_NS, 'text');
      bubbleText.setAttribute('y', 6.5);
      bubble.appendChild(bubbleRect);
      bubble.appendChild(bubbleText);
      layer.appendChild(bubble);
    }
    const text = `吵死了 ${sec}`;
    bubbleText.textContent = text;
    let w = 12 + text.length * 9; // 兜底估算
    try { w = bubbleText.getBBox().width; } catch { /* 量不出来就按估算 */ }
    w = Math.max(34, w + 20);
    bubbleRect.setAttribute('x', (-w / 2).toFixed(1));
    bubbleRect.setAttribute('width', w.toFixed(1));
    bubble.setAttribute('opacity', '1');
    bubbleSec = sec;
  }

  function create(ctx, opts = {}) {
    const { S, STATES, clamp } = ctx;
    const demo = opts.demo && opts.demo.name === 'fasttype' ? opts.demo : null;
    const W = {
      keys: [],            // 最近按键的时间戳
      fastSince: -1,       // 连续达到 FAST_KPS 的起点
      saidFast: false, saidRelax: false,
      cover: false,        // 正在捂耳朵
      coverUntil: 0,       // 捂到这一刻为止（倒数气泡跟它对表）
      cooldownUntil: -1e9,
      lastSynth: 0,        // demo 模式的假按键
    };

    const kps = (now) => W.keys.filter((t) => now - t <= 1000).length;
    // 给其他模块查询「猫正捂着耳朵」：咖啡、喝水、催饭、玩图标、扑鼠标这些动作触发前先让路，
    // 猫同时只做一件事（和 gamemode.js 暴露 SillyGameMode.active 是同一个约定）
    window.SillyTypeRhythm.covering = () => W.cover;

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
      // 双爪按在耳朵正中（耳朵三角形的重心一带），配合 earDroop 让耳朵往爪子方向倒
      const p = ctx.headToScene(paw.side === 'L' ? 470 : 330, 105);
      return { id: 'tr-cover', x: p.x, y: p.y, tau: 60, pressing: true };
    }

    function pose(now, dt, rm, P) {
      // demo：假装在飞速敲键盘
      if (demo && !Number.isFinite(demo.at)) {
        if (now - W.lastSynth >= 90) { W.keys.push(now); W.lastSynth = now; afterKeyDown('demo', now); }
      }
      if (demo && Number.isFinite(demo.at)) {
        // 冻结 demo：把时间轴整体平移到 demo.at，制造「狂敲中」的假象
        // （整组重建而不是每帧 push：冻结页挂久了数组会一直涨）
        W.keys = Array.from({ length: 14 }, (_, i) => now - i * 70);
      }

      // 收手判定改成固定时长：捂够 COVER_HOLD 倒数到 0 → 爪子放回键盘、松口气、进冷却。
      // 以前是「等你停手才松开」，一直打字就一直捂，看起来像卡住了。
      if (W.cover) {
        const left = W.coverUntil - now;
        if (left <= 0) {
          W.cover = false;
          W.cooldownUntil = now + (demo ? 1500 : CALM_DOWN); // demo 循环：歇 1.5 秒接着演
          hideBubble();
          if (!W.saidRelax) { ctx.fx.spawn(window.SillyLines.get('typeRelax'), 470, 108, '', performance.now()); W.saidRelax = true; }
          W.fastSince = -1; W.saidFast = false;
          return;
        }
        showBubble(Math.max(1, Math.ceil(left / 1000)));
        // 捂耳朵姿态：闭眼、耳朵往爪子的方向压低、身子微抖
        P.eyesClosed = true;
        P.earDroop += 8;
        P.bodyRot += 1.2 * Math.sin(now / 55);
        return;
      }
      // 平时清理过期按键
      if (!demo) { while (W.keys.length && now - W.keys[0] > 4000) W.keys.shift(); }
      const lastKey = W.keys.length ? W.keys[W.keys.length - 1] : -1e9;

      const fast = W.fastSince > 0 && kps(now) >= FAST_KPS - 1;
      if (!fast) {
        if (W.fastSince > 0 && now - lastKey >= REST_GAP) { W.fastSince = -1; W.saidFast = false; }
        return;
      }
      const held = now - W.fastSince;

      if (held >= POUND_MS) {
        W.cover = true;
        W.coverUntil = now + COVER_HOLD;
        bubbleSec = -1; // 强制气泡立刻按新时长刷新
        W.saidRelax = false; // 每轮捂完都要松口气
        if (window.SillySounds) window.SillySounds.play('hiss');
        return;
      } else if (held >= FAST_MS && !W.saidFast) {
        W.saidFast = true;
        ctx.fx.spawn(window.SillyLines.get('typeFast'), 480 + (Math.random() * 2 - 1) * 20, 104, 'hot', performance.now());
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
