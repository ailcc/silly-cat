// 小奶猫串门：你发呆一阵后（12 秒没键鼠），一只毛色随机的小奶猫从画面左边
// 走进来，跳上键盘走到中间趴下打个小盹，几秒后起身从画面右边走出去。
// 四条腿对角步态、走路身体上下颠、尾巴摆动、偶尔眨眼，趴下时还会呼吸起伏；
// 大猫全程盯着它看，小猫趴下时大猫打一会儿呼噜。冷却几分钟，一次一只。
// 调试：?demo=visitor&loop=1（自动循环演出）或 &at=毫秒 冻结在时间轴某刻
(function () {
  'use strict';

  const Y_DESK = 556;   // 桌面地面（脚底）
  const Y_KEYS = 512;   // 键帽顶面（脚底）
  const PH_MS = 300;    // 一步的周期（一个完整步态循环 = 两拍）
  const SCALE = 1.3;    // 整体放大倍率（小奶猫要看得清）

  // 时间轴：走进来 → 跳上键盘 → 走到中间 → 趴下打盹 → 起身 → 走到右边 → 跳下 → 走出画面
  const SEG = [
    { name: 'walk1', t: 2600, x0: -80, x1: 170, y: Y_DESK },
    { name: 'step1', t: 500, x0: 170, x1: 230, y0: Y_DESK, y1: Y_KEYS, leap: true },
    { name: 'walk2', t: 1200, x0: 230, x1: 400, y: Y_KEYS },
    { name: 'lie',   t: 6300, x: 400, y: Y_KEYS },
    { name: 'stand', t: 400, x: 400, y: Y_KEYS },
    { name: 'walk3', t: 1200, x0: 400, x1: 570, y: Y_KEYS },
    { name: 'step2', t: 500, x0: 570, x1: 630, y0: Y_KEYS, y1: Y_DESK, leap: true },
    { name: 'walk4', t: 2500, x0: 630, x1: 880, y: Y_DESK },
  ];
  let TOTAL = 0, walkClock = 0;
  for (const s of SEG) {
    s.start = TOTAL;
    TOTAL += s.t;
    s.walkBefore = walkClock;
    if (!s.x0 && s.x0 !== 0) walkClock += 0; // 趴/站不累积步态时间
    else walkClock += s.t;
  }

  const COAT = [               // 小奶猫毛色：橘 / 灰 / 黑
    { fur: '#e8a25b', line: '#5c3a1e' },
    { fur: '#9aa0a6', line: '#3d4045' },
    { fur: '#3a3a3a', line: '#111' },
  ];

  function create(ctx, opts = {}) {
    const { S, STATES, fx, clamp } = ctx;
    const demo = opts.demo && opts.demo.name === 'visitor' ? opts.demo : null;
    const V = { phase: null, start: -1e9, next: 20e3, coat: 0, purrTimer: null, flags: {} };

    const rand = (a, b) => a + Math.random() * (b - a);
    const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));

    // 局部坐标原点 = 脚底中心，前进方向 +x。腿旋转中心在髋部（y=-14）
    document.getElementById('fx-layer').insertAdjacentHTML('beforebegin', `
      <g id="visitor-layer" style="display:none">
        <ellipse id="visitor-shadow" class="visitor-shadow" rx="38" ry="6"/>
        <g id="visitor-root">
          <path id="visitor-tail" class="visitor-tail" d=""/>
          <rect id="visitor-leg-br" class="visitor-leg" x="-14.5" y="-14" width="9" height="16" rx="4.5"/>
          <rect id="visitor-leg-bl" class="visitor-leg" x="-26.5" y="-14" width="9" height="16" rx="4.5"/>
          <path id="visitor-body" class="visitor-body" d="M -34 -4 Q -41 -24 -27 -40 Q -9 -54 10 -52 Q 31 -50 37 -32 Q 43 -16 34 -4 Q 16 3 0 3 Q -17 3 -34 -4 Z"/>
          <g id="visitor-upper">
            <g id="visitor-head">
              <path class="visitor-ear" d="M -17 -9 L -21 -29 L -3 -18 Z"/>
              <path class="visitor-ear" d="M 17 -9 L 21 -29 L 3 -18 Z"/>
              <circle class="visitor-head" cx="0" cy="0" r="19"/>
              <g id="visitor-eyes-open">
                <circle class="visitor-eye-dot" cx="-8" cy="-2" r="2.6"/>
                <circle class="visitor-eye-dot" cx="8" cy="-2" r="2.6"/>
              </g>
              <g id="visitor-eyes-closed" style="display:none">
                <path class="visitor-eye" d="M -11 -2 Q -8 1 -5 -2"/>
                <path class="visitor-eye" d="M 5 -2 Q 8 1 11 -2"/>
              </g>
              <path class="visitor-nose" d="M -2.5 4 L 2.5 4 L 0 7 Z"/>
            </g>
          </g>
          <rect id="visitor-leg-fr" class="visitor-leg" x="5.5" y="-14" width="9" height="16" rx="4.5"/>
          <rect id="visitor-leg-fl" class="visitor-leg" x="17.5" y="-14" width="9" height="16" rx="4.5"/>
        </g>
      </g>`);
    const E = {
      layer: document.getElementById('visitor-layer'),
      root: document.getElementById('visitor-root'),
      upper: document.getElementById('visitor-upper'),
      head: document.getElementById('visitor-head'),
      body: document.getElementById('visitor-body'),
      tail: document.getElementById('visitor-tail'),
      shadow: document.getElementById('visitor-shadow'),
      legs: {
        fl: document.getElementById('visitor-leg-fl'), fr: document.getElementById('visitor-leg-fr'),
        bl: document.getElementById('visitor-leg-bl'), br: document.getElementById('visitor-leg-br'),
      },
      eyesOpen: document.getElementById('visitor-eyes-open'),
      eyesClosed: document.getElementById('visitor-eyes-closed'),
    };
    // 髋部位置（x）：腿绕这点旋转
    const HIP = { fl: 22, fr: 10, bl: -22, br: -10 };

    function coatEls() {
      const els = [E.head.querySelector('.visitor-head'), ...E.head.querySelectorAll('.visitor-ear'), E.body, ...Object.values(E.legs)];
      els.forEach((el) => { el.style.fill = COAT[V.coat].fur; el.style.stroke = COAT[V.coat].line; });
      E.tail.style.stroke = COAT[V.coat].line;
    }

    function startVisit(now) {
      V.phase = 'play'; V.start = now; V.flags = {};
      V.coat = Math.floor(Math.random() * COAT.length);
      coatEls();
      E.layer.style.display = '';
    }
    function endVisit(now) {
      V.phase = null;
      E.layer.style.display = 'none';
      V.next = now + rand(3, 6) * 60000;
      if (V.purrTimer) { clearTimeout(V.purrTimer); V.purrTimer = null; }
      if (window.SillySounds) window.SillySounds.stopPurr();
    }

    function afterState(now) {
      if (demo || V.phase) return;
      if (S.state !== STATES.AWAKE || S.pet) return;
      if (now < V.next) return;
      const idle = (now - (S.lastKeyAt || 0) > 12000) && (now - (S.lastInputAt || 0) > 12000);
      if (idle) startVisit(now);
    }

    // 按时间轴算出此刻小猫该怎么摆：x / 地面高度 / 段名 / 步态相位 / 跳跃进度
    function layout(t) {
      for (const s of SEG) {
        if (t < s.start + s.t) {
          const p = clamp((t - s.start) / s.t, 0, 1);
          if (s.name === 'lie' || s.name === 'stand') return { seg: s, x: s.x, gy: s.y, p };
          const e = ease(p);
          return {
            seg: s,
            x: s.x0 + (s.x1 - s.x0) * e,
            gy: s.y0 !== undefined ? s.y0 + (s.y1 - s.y0) * e : s.y,
            ph: ((s.walkBefore + (t - s.start)) / PH_MS) * Math.PI * 2,
            p,
          };
        }
      }
      return null; // 演出结束
    }

    function pose(now, dt, rm, P) {
      if (demo) {
        if (Number.isFinite(demo.at)) {
          // 冻结协议：每帧把时间轴重新锚定在 demo.at（和其他模块一致）
          if (!V.frozenInit) { V.frozenInit = true; V.coat = 0; coatEls(); V.phase = 'play'; E.layer.style.display = ''; }
          V.start = now - demo.at;
        } else if (!V.phase) {
          startVisit(now); // 循环演出：上一轮结束立刻重来
        }
      }
      if (!V.phase) return;
      const t = now - V.start;
      const L = layout(t);
      if (!L) { endVisit(now); return; }

      const { seg, x, gy, ph, p } = L;
      const lieK = seg.name === 'lie' ? 1 : seg.name === 'stand' ? 1 - ease(p) : 0; // 1 = 完全趴下

      // 到位的小剧场：跳上键盘时打招呼，趴下时大猫打呼噜
      if (seg.name === 'step1' && !V.flags.greet) {
        V.flags.greet = true;
        fx.spawn('喵呜~ 小家伙', 430, 240, '', now);
      }
      if (seg.name === 'lie' && !V.flags.lie) {
        V.flags.lie = true;
        fx.spawn('呼噜呼噜…', 400, 250, '', now);
        if (window.SillySounds) {
          window.SillySounds.startPurr();
          V.purrTimer = setTimeout(() => { window.SillySounds.stopPurr(); V.purrTimer = null; }, (seg.start + seg.t - (t)) | 0);
        }
      }
      if (seg.name === 'stand' && V.flags.lie) {
        V.flags.lie = false;
        if (V.purrTimer) { clearTimeout(V.purrTimer); V.purrTimer = null; }
        if (window.SillySounds) window.SillySounds.stopPurr();
      }

      // 走路：身体上下颠（对角两步各颠一拍）；跳跃：额外一个抛物线小弧
      const bob = ph !== undefined && !seg.leap ? Math.abs(Math.sin(ph)) * 2.2 : 0;
      const hop = seg.leap ? -Math.sin(p * Math.PI) * 8 : 0;
      E.root.setAttribute('transform', `translate(${x.toFixed(1)} ${(gy + hop).toFixed(1)}) scale(${SCALE})`);
      E.upper.setAttribute('transform', `translate(0 ${(-bob).toFixed(2)})`);

      // 腿：对角步态（左前+右后一组，右前+左后一组）；跳跃时前伸后蹬；趴下时收起来
      const a1 = Math.sin(ph || 0) * 22, a2 = Math.sin((ph || 0) + Math.PI) * 22;
      const ang = {
        fl: seg.leap ? -24 : a1,
        fr: seg.leap ? -24 : a2,
        bl: seg.leap ? 24 : a2,
        br: seg.leap ? 24 : a1,
      };
      for (const k of Object.keys(E.legs)) {
        E.legs[k].style.opacity = 1 - lieK;
        E.legs[k].setAttribute('transform', `rotate(${ang[k].toFixed(1)} ${HIP[k]} -14)`);
      }

      // 身体：趴下时压扁 + 轻微呼吸起伏
      const breath = lieK > 0.9 ? Math.sin(now / 420) * 0.025 : 0;
      E.body.setAttribute('transform', `scale(1 ${(1 - 0.38 * lieK + breath).toFixed(3)})`);

      // 头：趴下时贴低；眼睛：趴下闭眼，走路偶尔眨眼
      E.head.setAttribute('transform', `translate(30 ${(-44 + 14 * lieK).toFixed(1)})`);
      const blink = lieK < 0.3 && (t % 2400) < 130;
      E.eyesOpen.style.display = blink || lieK > 0.5 ? 'none' : '';
      E.eyesClosed.style.display = blink || lieK > 0.5 ? '' : 'none';

      // 尾巴：走路翘着左右摆，趴下时垂在身后
      const walkTail = 35 + Math.sin((ph || 0) * 0.5 + 1) * 8;
      const tailAng = walkTail + (-50 - walkTail) * lieK;
      const rad = tailAng * Math.PI / 180, tl = 30;
      const ex = -34 - tl * Math.cos(rad), ey = -30 - tl * Math.sin(rad);
      const mx = -34 - tl * 0.55 * Math.cos(rad), my = -30 - tl * 0.55 * Math.sin(rad) - 4;
      E.tail.setAttribute('d', `M -34 -30 Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`);

      // 影子垫在脚下（趴下时略摊大）
      E.shadow.setAttribute('cx', x.toFixed(1));
      E.shadow.setAttribute('cy', (gy + 5).toFixed(1));
      E.shadow.setAttribute('rx', ((38 + 6 * lieK) * SCALE).toFixed(1));

      // 大猫的反应：盯着小家伙看，耳朵放松；做客期间算「有事发生」别让它睡着
      P.look = { x, y: gy - 30 };
      P.earDroop -= 3;
      S.lastInput = now;
    }

    return {
      afterState, pose,
      debugProps: { visitor: () => (V.phase ? V.phase + '@' + Math.round(now_x(V)) : null) },
    };
  }

  // debugProps 闭包里拿不到 now，用时间轴进度代替
  function now_x(V) { return V.start < 0 ? 0 : Math.min(TOTAL, performance.now() - V.start); }

  window.SillyVisitor = { create };
})();
