// 桌宠状态机和渲染。只消费抽象输入事件，不碰 DOM 键鼠事件。
(function () {
  'use strict';

  // 启动/帧错误的取证：存 localStorage（设置窗口的调试面板会显示），卡死/冻结时有据可查
  function recordBootError(text) {
    try {
      const list = JSON.parse(localStorage.getItem('silly-boot-errors') || '[]');
      list.unshift(new Date().toLocaleTimeString() + ' ' + String(text).slice(0, 300));
      localStorage.setItem('silly-boot-errors', JSON.stringify(list.slice(0, 5)));
    } catch (e) { /* 存不了就算了 */ }
    if (window.__sillyBootErrors) window.__sillyBootErrors.push(String(text).slice(0, 300));
  }

  const STATES = Object.freeze({
    AWAKE: 'awake', DROWSY: 'drowsy', ASLEEP: 'asleep', PETTED: 'petted',
    RAGE: 'rage', STRIKE: 'strike', REPAIR: 'repair', // 由 fatigue.js 覆盖
  });

  // 这些演示本身演的就是「睡着」，demo 循环时不能强行保持清醒（真入睡状态是演出的一部分）。
  // listenmusic 的听歌睡着不在此列：它自己压着清醒并画闭眼，game（装睡）靠自己的 overrideState。
  const SLEEP_DEMOS = new Set(['slumped', 'slump-in', 'drool', 'wake-marks', 'dream']);

  // 爪子的左右一律按猫自己的视角：'L' = 猫的左爪 = 观众右侧（白爪），'R' = 猫的右爪 = 观众左侧（黑爪）。
  // 键盘和鼠标都朝向猫摆放。猫的左爪按标准指法负责左手键区；其余归右爪。
  const LEFT_CODES = new Set([
    'Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
    'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG',
    'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB',
    'Tab', 'CapsLock', 'Escape', 'ShiftLeft', 'ControlLeft', 'AltLeft', 'MetaLeft',
  ]);

  const currentSpecies = () => window.SillySpecies.current;
  const currentRig = () => currentSpecies().rig;
  const FULL_LEFT_CODES = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);

  const GAZE_HOLD_MS = 3000, GAZE_FALLOFF = 160;
  const GAZE_TAU = 60, GAZE_SLOW_TAU = 3 * GAZE_TAU;
  // mouseSide 也按猫的视角：'right' = 猫的右手边 = 画面里键盘左侧
  const MOUSE_HOME = { right: { x: 104, y: 484 }, left: { x: 696, y: 484 } };
  const REST_KEY = { L: 'KeyG', R: 'KeyK' };
  const MOUSE_HOLD_MS = 1500;
  const RELEASE_MS = 120;
  const HOLD_RELAX_MS = 10000; // 同一颗键按住超过这么久，爪子先收回来（多半是抬起丢了）
  const EXCITE_COUNT = 6;     // 一秒内超过 6 次
  const TYPING_WAG_MS = 3000, TYPING_WAG_MAX_HZ = 8;
  const TILT_IDLE_MS = 6000, TILT_COOLDOWN_MS = 20000;
  const TILT_MS = 1500, TILT_EASE_MS = 200, TILT_DEGREES = 12;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const approach = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
  const f1 = (v) => (Math.round(v * 10) / 10).toString();
  const smooth = (v) => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
  function rotationOffset(x, y, degrees) {
    const angle = degrees * Math.PI / 180;
    const c = Math.cos(angle) - 1, s = Math.sin(angle);
    return { x: x * c - y * s, y: x * s + y * c };
  }
  const tiltAt = (elapsed) => TILT_DEGREES * smooth(elapsed / TILT_EASE_MS) * smooth((TILT_MS - elapsed) / TILT_EASE_MS);
  // Windows 上不跟随系统：浏览器内核在 Windows 上把「在 Windows 中显示动画」关掉当成减少动画，
  // 而这个开关常被「最佳性能」、远程桌面、虚拟机顺手关掉，用户并没有要求少看动画。
  // 跟随时键名不飘、不推杯子、不砸键盘，猫就少了大半表演。macOS 的「减弱动态效果」是专门打开的辅助功能，照常跟随。
  const IS_WINDOWS = /Windows/i.test(navigator.userAgent || '');
  const mq = !IS_WINDOWS && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reducedMotion = () => !!(mq && mq.matches);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // ---------- 尾巴几何 ----------
  // 尾巴画成一条有粗细的实心带子：沿中线取点，按宽度往两侧偏移，尾尖封半圆；白尾尖是同一条中线最后一段、往里缩一圈描边宽度的带子。
  const idleTailCurves = new WeakMap();

  function cubicPts(c, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
      out.push({ x: a * c[0] + b * c[2] + d * c[4] + e * c[6], y: a * c[1] + b * c[3] + d * c[5] + e * c[7] });
    }
    return out;
  }
  function resample(pts, n, s0 = 0, s1 = 1) { // 按弧长等距重取整条中线或其中一段
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const L = cum[cum.length - 1] || 1, out = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const s = L * s0 + L * (s1 - s0) * k / (n - 1);
      while (j < pts.length - 2 && cum[j + 1] < s) j++;
      const seg = cum[j + 1] - cum[j] || 1, t = Math.min(1, Math.max(0, (s - cum[j]) / seg));
      out.push({ x: pts[j].x + (pts[j + 1].x - pts[j].x) * t, y: pts[j].y + (pts[j + 1].y - pts[j].y) * t });
    }
    return out;
  }
  function catmull(ctrl, per) { // 均匀 Catmull-Rom：曲线经过每个控制点、切线连续
    const out = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[i - 1] || ctrl[i], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[i + 2] || ctrl[i + 1];
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
      }
    }
    out.push(ctrl[ctrl.length - 1]);
    return out;
  }
  function idleTail(tail) {
    if (!idleTailCurves.has(tail)) {
      const points = tail.idleCurves.flatMap(({ points, steps }, i) => cubicPts(points, steps).slice(i ? 1 : 0));
      idleTailCurves.set(tail, resample(points, tail.samples));
    }
    return idleTailCurves.get(tail);
  }
  function pathLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return L; }
  // 中线 pts（s0..s1 是这段在整条尾巴上的位置，用来取宽度）-> 闭合轮廓路径；roundStart：起点也封半圆（白尾尖靠身体那头）
  function ribbonD(halfWidth, pts, s0, s1, inset, press, roundStart, roundEnd = true) {
    const n = pts.length, L = [], R = [], C = 7;
    let n0 = null, t0 = null, nl = null, tl = null, h0 = 0, hl = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, tx = (b.x - a.x) / len, ty = (b.y - a.y) / len;
      const h = halfWidth(s0 + (s1 - s0) * i / (n - 1), press) - inset;
      L.push({ x: pts[i].x - ty * h, y: pts[i].y + tx * h });
      R.push({ x: pts[i].x + ty * h, y: pts[i].y - tx * h });
      if (i === 0) { n0 = { x: -ty, y: tx }; t0 = { x: tx, y: ty }; h0 = h; }
      if (i === n - 1) { nl = { x: -ty, y: tx }; tl = { x: tx, y: ty }; hl = h; }
    }
    const P = L.slice();
    const e = pts[n - 1];
    for (let k = 1; roundEnd && k < C; k++) { // 尾尖半圆：左 -> 前 -> 右
      const th = Math.PI * k / C, c = Math.cos(th), s = Math.sin(th);
      P.push({ x: e.x + (nl.x * c + tl.x * s) * hl, y: e.y + (nl.y * c + tl.y * s) * hl });
    }
    for (let i = n - 1; i >= 0; i--) P.push(R[i]);
    if (roundStart) {
      const b = pts[0];
      for (let k = 1; k < C; k++) {
        const th = Math.PI * k / C, c = Math.cos(th), s = Math.sin(th);
        P.push({ x: b.x - (n0.x * c + t0.x * s) * h0, y: b.y - (n0.y * c + t0.y * s) * h0 });
      }
    }
    // 中点二次曲线平滑：轮廓没有折角
    const m = (p, q) => `${f1((p.x + q.x) / 2)} ${f1((p.y + q.y) / 2)}`;
    let d = `M ${m(P[P.length - 1], P[0])}`;
    for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; d += ` Q ${f1(p.x)} ${f1(p.y)} ${m(p, q)}`; }
    return d + ' Z';
  }
  function tipPts(pts, total, tipLength) { // 中线最靠近尾尖的一段
    let acc = total;
    for (let i = pts.length - 1; i > 0; i--) {
      const sl = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (total - (acc - sl) >= tipLength) {
        const t = (tipLength - (total - acc)) / (sl || 1);
        const first = { x: pts[i].x + (pts[i - 1].x - pts[i].x) * t, y: pts[i].y + (pts[i - 1].y - pts[i].y) * t };
        return resample([first, ...pts.slice(i)], 8);
      }
      acc -= sl;
    }
    return resample(pts, 8);
  }

  // 鼠标演示共用时间轴：静止 → 伸过去跟着动 → 点击 → 停够 1.5 秒 → 收回。
  const MD = { move0: 300, move1: 2000, down: 2250, up: 2400, off: 2400 + MOUSE_HOLD_MS, period: 5000 };
  const TILT_DEMO_START = 300, PET_DEMO_START = 300, PET_DEMO_END = 1800;
  const MOTION_DEMO_PERIODS = { 'paw-mouse': MD.period, tilt: 2300, pet: 2300 };

  // ---------- 浮起键帽上显示的文字 ----------
  // 所有"显示什么"都集中在这里：以后做隐私模式（只显示左右手、不显示键名）只改这一个函数。
  // side 是负责这个键的爪（'L' / 'R'，猫的视角），现在没用到，留给隐私模式。
  const KEY_SYMBOLS = {
    Space: '␣', Enter: '↵', NumpadEnter: '↵', Backspace: '⌫', Tab: '⇥',
    ShiftLeft: '⇧', ShiftRight: '⇧',
    ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
    MetaLeft: 'Cmd', MetaRight: 'Cmd', CapsLock: 'Caps', Escape: 'Esc', ContextMenu: 'Menu',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\',
    Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
    PrintScreen: 'PrtSc', ScrollLock: 'ScrLk', Pause: 'Pause', NumLock: 'NumLk', Fn: 'Fn',
  };
  const FULL_KEY_SYMBOLS = new Map([['Power', 'Pwr'], ['Sleep', 'Slp'], ['WakeUp', 'Wk'], ['LaunchApp2', 'Calc']]);
  function keycapText(code, side) { // eslint-disable-line no-unused-vars
    if (KEY_SYMBOLS[code]) return KEY_SYMBOLS[code];
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if ((m = /^Digit(\d)$/.exec(code))) return m[1];
    if (/^F\d{1,2}$/.test(code)) return code;
    if ((m = /^Numpad(.+)$/.exec(code))) {
      const ops = { Add: '+', Subtract: '-', Multiply: '*', Divide: '/', Decimal: '.', Equal: '=' };
      return 'Num' + (ops[m[1]] || m[1]).slice(0, 3);
    }
    return String(code || '?').replace(/(Left|Right)$/, '').slice(0, 5);
  }

  // ---------- 浮起键帽特效（画面坐标，正着显示给观众） ----------
  const FX_MAX = 24, FX_LIFE = 700;
  function createKeycapFx(layer) {
    const live = []; // { g, text, start, x, y, dx, rot, rise, life }
    // style: '' | 'hot'（兴奋）| 'angry'（生气）；life 可选，定制寿命（梦话、语录这类长句给长一点）
    function spawn(text, x, y, style, now, life) {
      const excited = !!style;
      while (live.length >= FX_MAX) live.shift().g.remove();
      const w = Math.max(26, 12 + text.length * 9), h = 26;
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'keycap-fx' + (style ? ' ' + style : ''));
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', -w / 2); r.setAttribute('y', -h / 2);
      r.setAttribute('width', w); r.setAttribute('height', h); r.setAttribute('rx', 7);
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', 0); t.setAttribute('y', 5);
      t.textContent = text;
      g.appendChild(r); g.appendChild(t);
      g.setAttribute('opacity', '0');
      layer.appendChild(g);
      // 边框宽度按渲染出来的实际文字量（中文字比估算宽得多，纯估算会溢出）
      try {
        const measured = t.getBBox().width;
        if (measured > 0) {
          const w2 = Math.max(34, measured + 20);
          r.setAttribute('x', -w2 / 2); r.setAttribute('width', w2);
        }
      } catch { /* 量不出来退回估算 */ }
      live.push({
        g, text, start: now, x, y,
        dx: (Math.random() * 2 - 1) * 14,
        rot: (Math.random() * 2 - 1) * 8,
        rise: (excited ? 62 : 40) + Math.random() * (excited ? 14 : 18),
        life: life || FX_LIFE,
      });
    }
    function tick(now, rm) {
      for (let i = live.length - 1; i >= 0; i--) {
        const f = live[i];
        const p = (now - f.start) / f.life;
        if (p >= 1) { f.g.remove(); live.splice(i, 1); continue; }
        let op, tx = f.x, ty = f.y, sc = 1, rot = 0;
        if (rm) {
          op = p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75; // 原地淡入淡出
        } else {
          const e = 1 - Math.pow(1 - p, 3); // ease-out
          tx += f.dx * e; ty -= f.rise * e;
          sc = 0.8 + 0.45 * Math.sin(Math.PI * Math.min(1, p * 1.6)) + 0.2 * p; // 先放大再缩回
          rot = f.rot * e;
          op = p < 0.12 ? p / 0.12 : p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
        }
        f.g.setAttribute('transform', `translate(${f1(tx)} ${f1(ty)}) rotate(${rot.toFixed(2)}) scale(${sc.toFixed(3)})`);
        f.g.setAttribute('opacity', op.toFixed(3));
      }
    }
    function prune(now) { // 不依赖渲染帧也能清掉过期的（后台标签页 rAF 被节流时）
      for (let i = live.length - 1; i >= 0; i--) if (now - live[i].start >= live[i].life) { live[i].g.remove(); live.splice(i, 1); }
    }
    return { spawn, tick, texts(now) { prune(now); return live.map((f) => f.text); } };
  }

  // modules：扩展行为（睡眠阶段、疲劳……）的工厂函数数组，每个接收 ctx 返回一个带可选钩子的对象。
  function createCat({ keyboard: kb, sleepSeconds = 20, mouseSide = 'right', eyesFollow = true, modules = [], demo = null }) {
    const $ = (id) => {
      const n = document.getElementById(id);
      if (!n) throw new Error('missing #' + id);
      return n;
    };
    const eyeEls = (s) => {
      const open = $('eye-' + s + '-open');
      return {
        open, closed: $('eye-' + s + '-closed'), happy: $('eye-' + s + '-happy'),
        sclera: open.querySelector('.sclera'), ring: open.querySelector('.eye-ring'),
        clip: $('clip-eye-' + s).querySelector('circle'),
        iris: $('iris-' + s), pupil: $('pupil-' + s), shine: $('shine-' + s),
        lid: $('lid-' + s), lidLine: $('lidline-' + s),
      };
    };
    const puppyEyeEls = (s) => ({
      open: $('puppy-' + s + '-open'), clip: $('clip-puppy-' + s).querySelector('circle'),
      closed: $('eye-' + s + '-closed'), happy: $('eye-' + s + '-happy'),
      pupil: $('puppy-' + s + '-pupil'), dot: $('puppy-' + s + '-dot'), shine: $('puppy-' + s + '-shine'),
      glint: $('puppy-' + s + '-glint'), lid: $('puppy-' + s + '-lid'),
      lidLine: $('puppy-' + s + '-lidline'),
    });
    const el = {
      head: $('cat-head'), body: $('cat-body'),
      // 尾巴画两份：#tail 在身体后面（整条），#tail-front 在鼠标上面（遮罩掉身体那一块，只露出绕到前面的部分）
      tail: {
        back: $('tail'), front: $('tail-front'), mask: $('mask-tail-body'),
        body: [$('tail-body'), $('tail-front-body')],
        tip: [$('tail-tip'), $('tail-front-tip')],
        rings: [$('tail-rings'), $('tail-front-rings')],
      },
      ear: { L: $('ear-l'), R: $('ear-r') },
      mouse: $('mouse'), mouseBtn: { 0: $('mouse-btn-l'), 2: $('mouse-btn-r') },
      zzz: [$('z1'), $('z2'), $('z3')],
      eye: { L: eyeEls('l'), R: eyeEls('r') },
      puppyEye: { L: puppyEyeEls('l'), R: puppyEyeEls('r') },
      dogMouth: { open: $('dog-mouth-open'), closed: $('dog-mouth-closed'), tongue: $('dog-tongue') },
      headShape: [$('head-fill'), $('head-line')],
      headClip: $('clip-head-path'),
      armG: { l: $('arm-l'), r: $('arm-r') },
    };
    const fx = createKeycapFx($('fx-layer'));
    const scene = $('scene');

    const t0 = performance.now();
    const initialRig = currentRig();
    const initialRotation = initialRig.head.restRotation;
    const initialGazeY = initialRig.eyes.gaze.restY;
    const S = {
      state: STATES.AWAKE,
      excited: false, excitedUntil: 0, keyTimes: [],
      sleepMs: sleepSeconds * 1000, lastInput: t0, sleepSince: 0,
      pressed: new Map(),               // code -> 'L' | 'R'；画面上没画的键是 null（爪子不动）
      heldSince: new Map(),             // code -> 按下时刻，只记爪子去按的键
      mouseSide, mouseActiveUntil: 0, mouseButtons: new Set(), mouseOff: { x: 0, y: 0 },
      mouseLean: 0,
      pet: null,                        // { nx, ny, movedAt }
      shakeStart: -1e9, nodStart: -1e9, lastKeyAt: -1e9, lookCode: null, lookSide: 'R',
      pointer: null, followingPointer: false, lastPointerMove: t0,
      lid: 0.18, pupil: { L: { x: 0, y: initialGazeY }, R: { x: 0, y: initialGazeY } },
      pupilR: initialRig.eyes.pupil.rest,
      nextBlink: t0 + 3000 + Math.random() * 3000, blinkUntil: 0,
      twitch: { ear: null, start: -1e9 }, nextTwitch: t0 + 5000 + Math.random() * 5000,
      tailPhase: 0, tailAngle: 0, tailTypingMix: 0, tailWagSpeed: 0, eyeMode: null, dogMouthMode: null,
      tailReach: 0, tailWant: false, tailSide: mouseSide, tailLag: null, tailPress: 0, tailPressX: 0, tailTapAt: -1e9, tailFrontOn: null,
      tiltIdle: null, tiltStart: -Infinity, tiltSide: 0, tiltAngle: 0,
      headBaseRot: initialRotation, headBaseX: 0, headBaseY: 0,
      headTf: { tx: 0, ty: 0, rot: initialRotation, sx: 1, sy: 1, pivot: initialRig.head.pivot },
      catHidden: false, cheek: 0, cheekDrawn: -1,
    };

    // ---------- 扩展钩子 ----------
    const mods = [];
    let requestedKeyboard = kb.style;
    const call = (name, ...a) => { for (const m of mods) if (m[name]) m[name](...a); };
    const ask = (name, ...a) => {
      for (const m of mods) if (m[name]) { const r = m[name](...a); if (r) return r; }
      return null;
    };

    function makePaw(side) {
      const s = side === 'L' ? 'r' : 'l'; // SVG 元素按画面左右命名
      const rest = restPoint(side);
      return {
        side, artSlot: 'arm-' + s, held: [], releaseAt: 0, lastCode: null,
        x: rest.x, y: rest.y, press: 0, lift: 0,
        els: { armOutline: $('arm-' + s + '-outline'), armFill: $('arm-' + s + '-fill'), armStripes: $('arm-' + s + '-stripes'), paw: $('paw-' + s) },
      };
    }
    function restPoint(side) {
      const { restKeys, restY } = currentRig().paws;
      const c = kb.center(restKeys?.[side] ?? REST_KEY[side]);
      return { x: c.x, y: c.y + restY * kb.heightScale };
    }
    const paws = { L: makePaw('L'), R: makePaw('R') };
    // 发飙和修理沿用鼠标所在侧；平时是否用爪操作鼠标，由物种决定。
    const mousePaw = () => (S.mouseSide === 'right' ? paws.R : paws.L);
    const mouseHome = () => {
      const home = MOUSE_HOME[S.mouseSide], reach = currentSpecies().mouseReach;
      const direction = S.mouseSide === 'left' ? 1 : -1;
      // 全尺寸键盘给鼠标外描边和左右各 6px 的位移留出空间。
      const padding = kb.style === 'full' ? 6 : 0;
      return { x: home.x + direction * (padding - (reach?.inset ?? 0)), y: home.y - (reach?.rise ?? 0) };
    };
    const mousePoint = () => {
      const off = motionFrame?.mouse || S.mouseOff;
      return { x: mouseHome().x + off.x, y: mouseHome().y + off.y };
    };
    const mousePressed = (button) => S.mouseButtons.has(button) || (button === 0 && motionFrame?.mouse?.down);
    // 睡着、发飙、罢工、修理时，鼠标动作让位给相应姿态。
    const mouseAvailable = () =>
      (S.state === STATES.AWAKE || S.state === STATES.DROWSY || S.state === STATES.PETTED);
    const tailWanted = (now) => !currentSpecies().mousePaw && now < S.mouseActiveUntil && mouseAvailable();

    function pawMouseTarget(paw, now, P) {
      if (!currentSpecies().mousePaw || paw !== mousePaw() || !mouseAvailable() || P?.mouseAbs || P?.mouseHidden || P?.hideCat || ask('blocksMouseReach', now)) return null;
      const on = motionFrame?.mouse?.active ?? (now < S.mouseActiveUntil || S.mouseButtons.size > 0);
      if (!on) return null;
      const point = mousePoint();
      const button = mousePressed(0) ? 0 : mousePressed(2) ? 2 : S.mouseButtons.has(1) ? 1 : null;
      return { id: 'mouse', x: point.x + (P?.mouseX || 0) + (button === 0 ? 9 : button === 2 ? -9 : 0),
        y: point.y + (P?.mouseY || 0) + (button === null ? 4 : 9), pressing: button !== null, tau: 32 };
    }

    // ---------- 状态 ----------
    function noteInput(now) {
      if (S.state === STATES.ASLEEP) { S.shakeStart = now; call('onWake', now); } // 被叫醒：甩头
      S.lastInput = now;
      if (!S.pet) S.state = STATES.AWAKE;
    }

    function choosePaw(code, now) {
      if (code === 'Space') {
        // 默认用鼠标那一侧的爪（默认是猫的右爪）；它正按着别的键就换另一只
        const primary = mousePaw();
        const other = primary === paws.R ? paws.L : paws.R;
        return primary.held.length > 0 ? other : primary;
      }
      return LEFT_CODES.has(code) || (kb.style === 'full' && FULL_LEFT_CODES.has(code)) ? paws.L : paws.R;
    }

    function targetOf(paw, now, P) {
      const forced = ask('forcedPawTarget', paw, now); // 发飙、罢工等：压过一切
      if (forced) return forced;
      const last = paw.held[paw.held.length - 1];
      if (last && now - (S.heldSince.get(last) ?? now) < HOLD_RELAX_MS) return { id: last, pressing: true };
      if (!last && now < paw.releaseAt && paw.lastCode) return { id: paw.lastCode, pressing: false };
      const soft = ask('softPawTarget', paw, now); // 抹嘴、趴着摊开：只在没按键时
      if (soft) return soft;
      return pawMouseTarget(paw, now, P) || { id: 'rest', pressing: false };
    }

    const displayKey = (code, side) =>
      (kb.style === 'full' ? FULL_KEY_SYMBOLS.get(code) : null) ?? keycapText(code, side);
    function keyPoint(code, side) {
      const c = kb.center(code);
      if (c) return { x: c.x, y: c.y + currentRig().paws.keyY * kb.heightScale };
      return kb.edgePoint(code, side);
    }

    function pointFor(id, paw) {
      if (id === 'rest') return restPoint(paw.side);
      return keyPoint(id, paw.side);
    }

    // 每个输入先把状态推进到此刻，再问扩展模块要不要拦下（发飙、罢工时猫不理人）
    function guard(kind, arg) {
      const now = performance.now();
      if (pinnedMotionDemo && motionDemoSupported()) return true;
      refreshState(now);
      return !!ask('block', kind, arg, now);
    }

    // ---------- 抽象输入事件 ----------
    const api = {
      setKeyboardStyle(style) { if (SillyKeyboard.isStyle(style)) requestedKeyboard = style; },
      keyDown(code) {
        if (guard('keyDown', code)) return;
        const now = performance.now();
        noteInput(now);
        if (S.pressed.has(code)) return;
        S.lastKeyAt = now;
        S.keyTimes.push(now);
        pruneKeyTimes(now);
        if (S.keyTimes.filter(at => now - at <= 1000).length > EXCITE_COUNT) S.excited = true;
        if (S.excited) S.excitedUntil = now + 1000;
        if (!kb.has(code)) {
          // 画面上没画这颗键（紧凑键盘的小键盘、方向键、F 键，以及 Fn 等）：爪子不去够，
          // 只算在打字——照常不让猫睡着、累积疲劳。
          S.pressed.set(code, null);
          call('afterKeyDown', code, now);
          return;
        }
        const paw = choosePaw(code, now);
        S.pressed.set(code, paw.side);
        S.heldSince.set(code, now);
        paw.held.push(code);
        kb.setDown(code, true);
        S.nodStart = now;
        S.lookCode = code;
        S.lookSide = paw.side;
        const center = kb.center(code);
        const style = ask('keycapStyle', now) || (S.excited ? 'hot' : '');
        fx.spawn(displayKey(code, paw.side), center.x, center.y, style, now);
        call('afterKeyDown', code, now);
      },
      keyUp(code) {
        if (guard('keyUp', code)) return;
        const now = performance.now();
        if (!S.pressed.has(code)) return;
        const side = S.pressed.get(code);
        noteInput(now);
        S.pressed.delete(code);
        S.heldSince.delete(code);
        if (!side) return; // 没画出来的键，爪子本来就没动
        const paw = paws[side];
        const i = paw.held.lastIndexOf(code);
        if (i >= 0) paw.held.splice(i, 1);
        if (paw.held.length === 0) { paw.releaseAt = now + RELEASE_MS; paw.lastCode = code; }
        kb.setDown(code, false);
      },
      pointerAt(x, y) {
        if (pinnedMotionDemo && motionDemoSupported()) return;
        S.pointer = { x, y, at: performance.now() };
      },
      pointerMove(dx, dy) {
        if (guard('pointerMove', null)) return;
        const now = performance.now();
        // 只移动鼠标不算「在干活」：不重置入睡计时，猫照样会犯困、睡着
        S.lastPointerMove = now;
        S.mouseActiveUntil = now + MOUSE_HOLD_MS;
        S.mouseOff.x = clamp(S.mouseOff.x + dx * 0.25, -6, 6);
        S.mouseOff.y = clamp(S.mouseOff.y + dy * 0.25, -6, 6);
      },
      pointerDown(button) {
        if (guard('pointerDown', button)) return;
        const now = performance.now();
        noteInput(now);
        S.mouseActiveUntil = now + MOUSE_HOLD_MS;
        S.mouseButtons.add(button);
        if (el.mouseBtn[button]) el.mouseBtn[button].classList.add('down');
      },
      pointerUp(button) {
        if (guard('pointerUp', button)) return;
        const now = performance.now();
        if (!S.mouseButtons.has(button)) return;
        noteInput(now);
        S.mouseActiveUntil = now + MOUSE_HOLD_MS;
        S.mouseButtons.delete(button);
        if (S.mouseButtons.size === 0) S.tailTapAt = now; // 尾尖松开时弹一下
        if (el.mouseBtn[button]) el.mouseBtn[button].classList.toggle('down', !!mousePressed(button));
      },
      petStart(nx, ny) {
        if (guard('petStart', null)) return;
        const now = performance.now();
        noteInput(now);
        if (ask('handlePetStart', now)) return;
        S.pet = { nx: nx || 0, ny: ny || 0, movedAt: -Infinity };
        S.state = STATES.PETTED;
        call('onPetStart', now);
      },
      petMove(nx, ny) {
        if (guard('petMove', null)) return;
        if (!S.pet) return;
        const now = performance.now();
        if (nx !== S.pet.nx || ny !== S.pet.ny) S.pet.movedAt = now;
        S.pet.nx = nx; S.pet.ny = ny;
        S.lastInput = now;
      },
      petEnd() {
        if (guard('petEnd', null)) return;
        if (!S.pet) return;
        S.pet = null;
        S.lastInput = performance.now();
        S.state = STATES.AWAKE;
        call('onPetEnd', S.lastInput);
      },
      setSleepSeconds(sec) {
        S.sleepMs = clamp(+sec || 20, 1, 3600) * 1000;
      },
      setEyesFollow(enabled) {
        eyesFollow = enabled;
      },
      setMouseSide(side) {
        S.mouseSide = side === 'left' ? 'left' : 'right';
        S.mouseActiveUntil = 0;
      },
    };

    // ---------- 每帧 ----------
    // 状态推进不依赖渲染帧：页面在后台、rAF 被节流时，读 __cat 也能拿到正确状态
    function refreshState(now) {
      if (S.pressed.size || S.mouseButtons.size) S.lastInput = now; // 长按也算有输入
      const prev = S.state;
      if (S.pet || motionFrame?.pet) S.state = STATES.PETTED;
      else {
        const idle = now - S.lastInput;
        S.state = idle >= S.sleepMs ? STATES.ASLEEP : idle >= S.sleepMs / 2 ? STATES.DROWSY : STATES.AWAKE;
      }
      // 调试循环模式（?demo=x&loop=1）：页面上没有真实输入，20 秒后猫会真的睡着，
      // 而大部分演出都要求清醒，于是全都停了——看起来就是「点了按钮没反应」。
      // 除睡眠类演示外（SLEEP_DEMOS），循环演示期间把猫按在清醒状态，并刷新 lastInput
      // 挡掉其他模块按「空闲」自触发的演出（听歌、小奶猫串门等）——调试页只演选中的那一个。
      // gamemode 等模块自己的 overrideState 在后面仍会生效。
      if (demo && demo.loop && !SLEEP_DEMOS.has(demo.name)) {
        S.lastInput = now;
        if (S.state !== STATES.AWAKE) S.state = STATES.AWAKE;
      }
      call('refresh', now);
      const o = ask('overrideState', now);
      if (o) S.state = o;
      if (S.state === STATES.ASLEEP && prev !== STATES.ASLEEP) S.sleepSince = now;
      if (S.excited && now > S.excitedUntil) S.excited = false;
      call('afterState', now);
    }

    const demoTail = demo && demo.name === 'tail-mouse' ? { t0: performance.now(), done: false } : null;
    function demoTailTime(now) {
      if (Number.isFinite(demo.at)) return demo.at;
      const t = now - demoTail.t0;
      return demo.loop ? t % MD.period : t;
    }
    function demoTailStep(now) {
      if (!demoTail || demoTail.done || currentSpecies().mousePaw) return;
      const t = demoTailTime(now);
      if (t >= MD.period) { demoTail.done = true; return; }
      S.lastInput = now;
      S.mouseActiveUntil = t >= MD.move0 && t < MD.off ? now + (MD.off - t) : 0;
      if (t >= MD.move0 && t < MD.move1) {
        const u = (t - MD.move0) / (MD.move1 - MD.move0), env = Math.sin(Math.PI * Math.min(1, u * 1.15));
        S.mouseOff.x = 6 * env * Math.sin(2 * Math.PI * (t - MD.move0) / 850);
        S.mouseOff.y = 5 * env * Math.sin(2 * Math.PI * (t - MD.move0) / 560);
      }
      const down = t >= MD.down && t < MD.up;
      if (down !== S.mouseButtons.has(0)) {
        if (down) S.mouseButtons.add(0); else S.mouseButtons.delete(0);
        el.mouseBtn[0].classList.toggle('down', down);
      }
      S.tailTapAt = t >= MD.up ? now - (t - MD.up) : -1e9;
    }

    const motionPeriod = demo && Object.hasOwn(MOTION_DEMO_PERIODS, demo.name) ? MOTION_DEMO_PERIODS[demo.name] : 0;
    const pinnedMotionDemo = motionPeriod > 0 && Number.isFinite(demo.at);
    let motionStarted = null, motionFinished = false, motionFrame = null;

    function motionDemoSupported() {
      const species = currentSpecies();
      if (demo.name === 'paw-mouse') return !!species.mousePaw;
      if (demo.name === 'tilt') return !!species.idleTilt;
      return true;
    }

    function sampleMotionDemo(now) {
      if (!motionPeriod || motionFinished || !motionDemoSupported()) {
        motionStarted = null;
        return null;
      }
      motionStarted ??= now;
      const elapsed = now - motionStarted;
      if (!pinnedMotionDemo && !demo.loop && elapsed >= motionPeriod) {
        motionFinished = true;
        return null;
      }
      const time = pinnedMotionDemo ? clamp(demo.at, 0, motionPeriod) : elapsed % motionPeriod;
      if (demo.name === 'tilt') return { time, tilt: tiltAt(time - TILT_DEMO_START) };
      if (demo.name === 'pet') {
        const pet = time >= PET_DEMO_START && time < PET_DEMO_END
          ? { nx: 0.55 * Math.sin((time - PET_DEMO_START) / 200), ny: -0.25 } : null;
        return { time, pet };
      }
      const moved = time - MD.move0;
      const envelope = time >= MD.move0 && time < MD.move1 ? Math.sin(Math.PI * moved / (MD.move1 - MD.move0)) : 0;
      return { time, mouse: {
        x: 6 * envelope * Math.sin(2 * Math.PI * moved / 850),
        y: 5 * envelope * Math.sin(2 * Math.PI * moved / 560),
        active: time >= MD.move0 && time < MD.off, down: time >= MD.down && time < MD.up,
      } };
    }

    function demoMouseReach(t, extendMs, retractMs) {
      if (t < MD.off) return clamp((t - MD.move0) / extendMs, 0, 1);
      return Math.max(0, 1 - (t - MD.off) / retractMs);
    }

    function pruneKeyTimes(now) {
      const windowMs = currentSpecies().tailTyping ? TYPING_WAG_MS : 1000;
      while (S.keyTimes.length && now - S.keyTimes[0] > windowMs) S.keyTimes.shift();
    }

    function updateTilt(now, dt, rm) {
      if (!currentSpecies().idleTilt || rm) {
        S.tiltSide = 0;
        S.tiltAngle = 0;
        return;
      }
      const idle = Math.max(S.lastInput, S.lastPointerMove);
      if (motionFrame || (demo && !motionFinished) || S.state !== STATES.AWAKE || now - idle < TILT_IDLE_MS) {
        S.tiltSide = 0;
        S.tiltAngle = approach(S.tiltAngle, 0, dt, 70);
        return;
      }
      if (S.tiltIdle !== idle) {
        S.tiltIdle = idle;
        if (now - S.tiltStart >= TILT_COOLDOWN_MS && Math.random() < 0.45) {
          S.tiltStart = now;
          S.tiltSide = Math.random() < 0.5 ? -1 : 1;
        }
      }
      const angle = tiltAt(now - S.tiltStart);
      S.tiltAngle = angle && S.tiltSide * angle;
    }

    function update(now, dt, rm) {
      demoTailStep(now);
      const wasDown = !!motionFrame?.mouse?.down;
      motionFrame = sampleMotionDemo(now);
      if (wasDown !== !!motionFrame?.mouse?.down) el.mouseBtn[0].classList.toggle('down', !!mousePressed(0));
      if (motionFrame) S.lastInput = now;
      refreshState(now);
      updateTilt(now, dt, rm);
      if (pinnedMotionDemo && motionFrame) {
        S.blinkUntil = 0;
        S.twitch.ear = null;
        return;
      }
      if (!rm && (S.state === STATES.AWAKE || S.state === STATES.DROWSY) && now > S.nextBlink) {
        S.blinkUntil = now + 140;
        S.nextBlink = now + 3000 + Math.random() * 3000;
      }
      if (!rm && S.state === STATES.AWAKE && now > S.nextTwitch) {
        S.twitch = { ear: Math.random() < 0.5 ? 'L' : 'R', start: now };
        S.nextTwitch = now + 5000 + Math.random() * 7000;
      }
    }

    const pawOutward = (paw) => paw.side === 'L' ? 1 : -1;

    function poseMouseReach(now, dt, rm, P, rig) {
      const reach = currentSpecies().mouseReach;
      if (!reach) { S.mouseLean = 0; return; }
      const paw = mousePaw(), target = targetOf(paw, now, P);
      const direction = pawOutward(paw);
      const demoReach = motionFrame?.mouse && (target.id === 'mouse' || target.id === 'rest');
      const goal = direction * (demoReach ? smooth(demoMouseReach(motionFrame.time, 380, 520)) : Number(target.id === 'mouse'));
      S.mouseLean = rm || demoReach ? goal : approach(S.mouseLean, goal, dt, reach.tau);
      if (Math.abs(S.mouseLean) < 0.001) S.mouseLean = 0;
      const angle = S.mouseLean * reach.degrees;
      const body = rig.body.pivot, head = rig.head.pivot;
      const shift = rotationOffset(head.x - body.x, head.y - body.y, angle);
      const slide = S.mouseLean * reach.slide;
      P.bodyRot += angle;
      P.bodyX += slide;
      P.headRot += angle;
      P.headX += shift.x + slide;
      P.headY += shift.y;
    }

    function renderPaws(now, dt, P, rig) {
      const { shoulders, pressScale, lift, wristY, bend: curve } = rig.paws;
      const pivot = rig.body.pivot;
      const mouseReach = currentSpecies().mouseReach;
      for (const paw of [paws.L, paws.R]) {
        const t = targetOf(paw, now, P);
        const goal = t.x !== undefined ? { x: t.x, y: t.y } : pointFor(t.id, paw);
        const tau = (t.tau || (t.pressing ? 14 : t.id === 'rest' ? 45 : 25)) * P.pawTau;
        if (motionFrame?.mouse && currentSpecies().mousePaw && paw === mousePaw() && (t.id === 'mouse' || t.id === 'rest')) {
          const reach = demoMouseReach(motionFrame.time, 380, 520), amount = smooth(reach);
          const rest = restPoint(paw.side), m = mousePoint();
          paw.x = rest.x + ((t.id === 'mouse' ? goal.x : m.x) - rest.x) * amount;
          paw.y = rest.y + ((t.id === 'mouse' ? goal.y : m.y + 4) - rest.y) * amount;
          paw.press = Number(!!t.pressing);
          paw.lift = Math.sin(Math.PI * reach);
        } else if ((pinnedMotionDemo && motionFrame) || P.dogPoseTime != null) {
          paw.x = goal.x; paw.y = goal.y; paw.press = Number(!!t.pressing); paw.lift = 0;
        } else {
          paw.x = approach(paw.x, goal.x, dt, tau);
          paw.y = approach(paw.y, goal.y, dt, tau);
          const dist = Math.hypot(goal.x - paw.x, goal.y - paw.y);
          paw.press = approach(paw.press, t.pressing && dist < 6 ? 1 : 0, dt, 16);
          paw.lift = approach(paw.lift, dist > 10 ? 1 : 0, dt, 30);
        }

        const sx = 1 + (pressScale.x + P.pressBoost) * paw.press + lift.scale * paw.lift;
        const sy = 1 - (pressScale.y + P.pressBoost) * paw.press + lift.scale * paw.lift;
        let px = paw.x, py = paw.y - lift.y * paw.lift;

        // 手臂：肩部锚点 -> 爪背的二次曲线，距离越近弯得越多
        // 肩部锚点跟着身体的缩放走
        const shoulder = shoulders[paw.side];
        const sh = {
          x: pivot.x + (shoulder.x - pivot.x) * P.bodySX + P.bodyX,
          y: pivot.y + (shoulder.y - pivot.y) * P.bodySY + P.lift + P.bodyY,
        };
        const outward = pawOutward(paw); // 猫的左爪在观众右侧
        const lean = Math.max(0, S.mouseLean * outward);
        const reaching = mouseReach && (t.id === 'mouse' || (t.id === 'rest' && lean > 0));
        if (mouseReach && P.bodyRot) {
          const shift = rotationOffset((shoulder.x - pivot.x) * P.bodySX, (shoulder.y - pivot.y) * P.bodySY, P.bodyRot);
          sh.x += shift.x;
          sh.y += shift.y;
        }
        const reachBend = mouseReach ? Math.max(curve.min, mouseReach.bend * lean) : 0;
        if (lean > 0) {
          sh.x += outward * lean * mouseReach.shoulderX;
          sh.y += lean * mouseReach.shoulderY;
        }
        if (reaching) {
          const rest = restPoint(paw.side);
          const max = mouseReach.stretch * Math.hypot(rest.x - shoulder.x, rest.y + wristY - shoulder.y);
          // 两段控制多边形是二次曲线弧长的上界，先为肘弯留出长度。
          const limit = Math.sqrt(Math.max(0, max * max - 4 * reachBend * reachBend));
          const dx = px - sh.x, dy = py + wristY - sh.y;
          const scale = Math.min(1, limit / (Math.hypot(dx, dy) || 1));
          px = sh.x + dx * scale;
          py = sh.y + dy * scale - wristY;
        }
        paw.els.paw.setAttribute('transform', `${turnTf(P, rig.turnX)}translate(${f1(px)} ${f1(py)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})`);
        const ex = px, ey = py + wristY;
        const vx = ex - sh.x, vy = ey - sh.y, len = Math.hypot(vx, vy) || 1;
        let nx = -vy / len, ny = vx / len;
        if (nx * outward < 0) { nx = -nx; ny = -ny; }
        const bend = reaching ? reachBend : Math.max(t.armBend || 0, clamp(curve.base - len * curve.falloff, curve.min, curve.max));
        const cx = sh.x + vx * 0.5 + nx * bend, cy = sh.y + vy * 0.5 + ny * bend;
        const d = `M ${f1(sh.x)} ${f1(sh.y)} Q ${f1(cx)} ${f1(cy)} ${f1(ex)} ${f1(ey)}`;
        SillyArt.arm(paw.artSlot, sh, cx, cy, ex, ey);
        paw.els.armOutline.setAttribute('d', d);
        paw.els.armFill.setAttribute('d', d);
        paw.els.armStripes.setAttribute('d', d);
      }
      const at = turnTf(P, rig.turnX);
      el.armG.l.setAttribute('transform', at);
      el.armG.r.setAttribute('transform', at);
    }

    let drawnHead = null;
    function renderHead(now, dt, rm, P, rig) {
      const head = rig.head;
      const fixed = P.dogPoseTime != null;
      const asleep = S.state === STATES.ASLEEP;
      let rotGoal = head.restRotation, xGoal = 0, yGoal = 0;
      if (asleep) { rotGoal += head.sleepRotation; yGoal += head.sleepY; }
      const pet = S.pet || motionFrame?.pet;
      if (pet) {
        rotGoal += pet.nx * head.pet.rotation + (rm ? 0 : head.pet.wobble * Math.sin((motionFrame?.time ?? now) / 90));
        xGoal += pet.nx * head.pet.x;
        yGoal += pet.ny * head.pet.y;
      }
      if ((pinnedMotionDemo && motionFrame) || fixed) {
        S.headBaseRot = rotGoal; S.headBaseX = xGoal; S.headBaseY = yGoal;
      } else {
        S.headBaseRot = approach(S.headBaseRot, rotGoal, dt, asleep ? 500 : 70);
        S.headBaseX = approach(S.headBaseX, xGoal, dt, 70);
        S.headBaseY = approach(S.headBaseY, yGoal, dt, asleep ? 500 : 70);
      }

      let rot = S.headBaseRot + P.headRot + (fixed ? 0 : motionFrame?.tilt ?? S.tiltAngle);
      const tx = S.headBaseX + P.headX;
      let ty = S.headBaseY + P.headY + P.lift;
      const tn = now - S.nodStart;
      if (!fixed && tn < 140) ty += head.nod * Math.sin(Math.PI * tn / 140);
      const ts = now - S.shakeStart;
      if (!fixed && ts >= 0 && ts < 420) rot += head.shake * Math.sin(4 * Math.PI * ts / 420);
      if (asleep && !rm) ty += head.breathY * P.breath * Math.sin(now * 2 * Math.PI / 3200);
      const hsx = P.headSX, hsy = P.headSY;
      const { x, y } = head.pivot;
      S.headTf = { tx, ty, rot, sx: hsx, sy: hsy, pivot: head.pivot };
      // 鼓腮帮：改头部轮廓本身
      S.cheek = approach(S.cheek, P.cheek, dt, 90);
      SillyArt.cheek(S.cheek);
      if (drawnHead !== head || Math.abs(S.cheek - S.cheekDrawn) > 0.05) {
        drawnHead = head;
        S.cheekDrawn = S.cheek;
        const d = head.path(S.cheek);
        for (const n of el.headShape) n.setAttribute('d', d);
        if (!SillyCoats.current().art?.headPath) el.headClip.setAttribute('d', d);
      }
      const hs = hsx !== 1 || hsy !== 1 ? ` translate(${x} ${y}) scale(${hsx.toFixed(4)} ${hsy.toFixed(4)}) translate(${-x} ${-y})` : '';
      el.head.setAttribute('transform', `${turnTf(P, rig.turnX)}translate(${f1(tx)} ${f1(ty)}) rotate(${rot.toFixed(2)} ${x} ${y})${hs}`);
    }

    let drawnEyes = null;
    function applyEyeGeometry(eyes) {
      const puppy = eyes.style === 'puppy';
      const nodes = puppy ? el.puppyEye : el.eye;
      const inactive = puppy ? el.eye : el.puppyEye;
      for (const s of ['L', 'R']) {
        const { x, y } = eyes.centers[s], e = nodes[s];
        const { radius, lidPadding } = eyes;
        inactive[s].open.style.display = 'none';
        for (const n of puppy ? [e.clip, e.pupil] : [e.sclera, e.ring, e.clip]) {
          n.setAttribute('cx', x); n.setAttribute('cy', y); n.setAttribute('r', radius);
        }
        if (puppy) {
          e.glint.setAttribute('r', eyes.glint.radius);
          e.dot?.setAttribute('r', eyes.dot?.radius ?? 0);
        }
        else e.iris.setAttribute('r', eyes.irisRadius);
        e.shine.setAttribute('r', eyes.shine.radius);
        const edge = radius + lidPadding + (puppy ? eyes.gaze.max : 0);
        const left = x - edge, right = x + edge;
        e.lid.setAttribute('x', left);
        e.lid.setAttribute('y', y - radius - lidPadding);
        e.lid.setAttribute('width', right - left);
        e.lidLine.setAttribute('x1', left);
        e.lidLine.setAttribute('x2', right);
        for (const [mode, { halfWidth, edgeY, controlY }] of Object.entries(eyes.arcs)) {
          e[mode].setAttribute('d', `M ${x - halfWidth} ${y + edgeY} Q ${x} ${y + controlY} ${x + halfWidth} ${y + edgeY}`);
        }
        S.pupil[s].x = 0;
        S.pupil[s].y = eyes.gaze.restY;
      }
      if (puppy || drawnEyes?.style === 'puppy') S.lid = eyes.restLid ?? 0.18;
      $('scene').setAttribute('data-eye-style', eyes.style ?? 'cat');
      S.pupilR = eyes.pupil.rest;
      S.eyeMode = null;
      drawnEyes = eyes;
    }

    function renderEyes(now, dt, P, eyes) {
      if (drawnEyes !== eyes) applyEyeGeometry(eyes);
      const fixed = P.dogPoseTime != null;
      const puppy = eyes.style === 'puppy';
      const nodes = puppy ? el.puppyEye : el.eye;
      const tongueOut = currentSpecies().petTongue && S.state === STATES.PETTED && !P.suppressPetSmile;
      const mode = tongueOut ? 'happy' : S.state === STATES.ASLEEP || P.eyesClosed ? 'closed'
        : (P.eyesHappy || (S.state === STATES.PETTED && !P.suppressPetSmile)) ? 'happy' : 'open';
      const mouthMode = puppy && (P.dogGrip || P.suppressPetSmile || mode === 'closed' ? 'closed' : tongueOut ? 'petted' : 'open');
      if (mouthMode !== S.dogMouthMode) {
        S.dogMouthMode = mouthMode;
        const { open, closed, tongue } = el.dogMouth;
        open.style.display = mouthMode && mouthMode !== 'closed' ? '' : 'none';
        closed.style.display = mouthMode === 'closed' ? '' : 'none';
        tongue.setAttribute('transform', tongueOut ? 'translate(0 241) scale(1 1.65) translate(0 -241)' : '');
      }
      if (mode !== S.eyeMode) {
        S.eyeMode = mode;
        for (const s of ['L', 'R']) {
          const e = nodes[s];
          e.open.style.display = mode === 'open' ? '' : 'none';
          e.closed.style.display = mode === 'closed' ? '' : 'none';
          e.happy.style.display = mode === 'happy' ? '' : 'none';
        }
      }
      if (mode !== 'open') return;

      let lidGoal = S.state === STATES.DROWSY ? 0.55 : S.excited ? 0.04 : (eyes.restLid ?? 0.18);
      lidGoal = Math.max(lidGoal, P.lidMin);
      const blinking = !fixed && now < S.blinkUntil;
      if (blinking) lidGoal = 1;
      S.lid = fixed ? lidGoal : approach(S.lid, lidGoal, dt, blinking ? 18 : 60);

      const { gaze, pupil, centers, irisTravel, shine, radius, lidPadding } = eyes;
      const eyeX = (centers.L.x + centers.R.x) / 2, eyeY = (centers.L.y + centers.R.y) / 2;
      let lx = 0, ly = gaze.restY, tau = GAZE_TAU, pointerTarget = null;
      if (P.look || fixed) {
        // 扩展模块按时间轴控制转眼的过渡。
        lx = clamp(((P.look?.x ?? eyeX) - eyeX) / 300, -1, 1) * gaze.max;
        ly = gaze.restY + clamp(((P.look?.y ?? eyeY) - eyeY) / 520, -1, 1) * gaze.max;
      } else if (now - S.lastKeyAt < 1200 && S.lookCode) {
        const p = keyPoint(S.lookCode, S.lookSide);
        lx = clamp((p.x - eyeX) / 220, -1, 1) * gaze.keyX; ly = gaze.keyY;
      } else if (followsPointer(now, P)) {
        // 头部的屏幕矩阵同时包含场景留边和本帧写入的头部姿态。
        const headToScreen = nodes.L.open.getScreenCTM();
        if (headToScreen) {
          pointerTarget = new DOMPoint(S.pointer.x, S.pointer.y).matrixTransform(headToScreen.inverse());
          tau = S.state === STATES.DROWSY ? GAZE_SLOW_TAU : GAZE_TAU;
        }
      } else if (!eyesFollow && (motionFrame?.mouse?.active ?? (now < S.mouseActiveUntil))) {
        lx = clamp((mousePoint().x - eyeX) / 220, -1, 1) * gaze.keyX; ly = gaze.keyY;
      } else if (S.followingPointer) {
        tau = GAZE_SLOW_TAU;
      }
      // 回正期间延续慢速，直到下一个明确的目标接管。
      if (pointerTarget || tau !== GAZE_SLOW_TAU) S.followingPointer = !!pointerTarget;
      S.pupilR = fixed ? pupil.rest : approach(S.pupilR, P.pupilR ?? (S.excited ? pupil.excited : pupil.rest), dt, 80);
      // 瞳孔变大时，缩小最大偏移，给虹膜留出边缘。
      const maxGaze = gaze.max - (S.pupilR - pupil.rest) * gaze.taper;

      for (const s of ['L', 'R']) {
        const { x: cx, y: cy } = centers[s], e = nodes[s], offset = S.pupil[s];
        let x = lx, y = ly;
        if (pointerTarget) {
          const dx = pointerTarget.x - cx, dy = pointerTarget.y - cy;
          const scale = maxGaze / Math.max(GAZE_FALLOFF, Math.hypot(dx, dy));
          x = dx * scale; y = dy * scale;
        }
        offset.x = P.look || fixed ? x : approach(offset.x, x, dt, tau);
        offset.y = P.look || fixed ? y : approach(offset.y, y, dt, tau);
        if (pointerTarget) {
          const scale = maxGaze / Math.max(maxGaze, Math.hypot(offset.x, offset.y));
          offset.x *= scale;
          offset.y *= scale;
        }
        const px = cx + offset.x, py = cy + offset.y;
        if (puppy) {
          e.clip.setAttribute('cx', f1(px));
          e.clip.setAttribute('cy', f1(py));
          e.glint.setAttribute('cx', f1(px + eyes.glint.x));
          e.glint.setAttribute('cy', f1(py + eyes.glint.y));
          const lead = eyes.dot?.lead ?? 0;
          e.dot?.setAttribute('cx', f1(px + offset.x * lead));
          e.dot?.setAttribute('cy', f1(py + offset.y * lead));
          e.lid.setAttribute('y', f1(py - radius - lidPadding));
        } else {
          e.iris.setAttribute('cx', f1(cx + offset.x * irisTravel));
          e.iris.setAttribute('cy', f1(cy + offset.y * irisTravel));
        }
        e.pupil.setAttribute('cx', f1(px));
        e.pupil.setAttribute('cy', f1(py));
        e.pupil.setAttribute('r', f1(S.pupilR));
        e.shine.setAttribute('cx', f1(px + (puppy ? shine.x : -S.pupilR * shine.offset)));
        e.shine.setAttribute('cy', f1(py + (puppy ? shine.y : -S.pupilR * shine.offset)));
        const h = S.lid * (radius * 2 + lidPadding * 2);
        e.lid.setAttribute('height', f1(h));
        const ly2 = (puppy ? py : cy) - radius - lidPadding + h;
        e.lidLine.setAttribute('y1', f1(ly2));
        e.lidLine.setAttribute('y2', f1(ly2));
        e.lidLine.style.display = S.lid > 0.03 ? '' : 'none';
      }
    }

    function renderEars(now, P, { pivots, twitch }) {
      for (const s of ['L', 'R']) {
        let a = 0;
        if (P.dogPoseTime == null && S.twitch.ear === s) {
          const t = now - S.twitch.start;
          if (t < twitch.duration) a = twitch.degrees * Math.sin(2 * Math.PI * t / twitch.period) * (1 - t / twitch.duration);
        }
        a += P.earDroop; // 耷拉：两只耳朵都往外侧倒
        if (s === 'L') a = -a;
        const { x, y } = pivots[s];
        el.ear[s].setAttribute('transform', `rotate(${a.toFixed(2)} ${x} ${y})`);
      }
    }

    function renderTail(now, dt, rm, P, rig) {
      const tail = rig.tail;
      const { pivot, wag, mouse, halfWidth, tipLength, markingInset } = tail;
      const typingWag = currentSpecies().tailTyping;
      const joyfulWag = typingWag && S.state === STATES.PETTED;
      const asleep = S.state === STATES.ASLEEP;
      let motion = wag.awake;
      if (asleep) motion = wag.asleep;
      else if (typingWag && rm) motion = null;
      else if (joyfulWag) motion = { amp: wag.excited.amp * 1.15, speed: wag.excited.speed * 1.55, tau: wag.tau / 3 };
      else if (typingWag) {
        pruneKeyTimes(now);
        const rate = S.keyTimes.length / (TYPING_WAG_MS / 1000);
        const mix = S.tailTypingMix = approach(S.tailTypingMix, clamp(rate / TYPING_WAG_MAX_HZ, 0, 1), dt, 180);
        const calm = S.state === STATES.DROWSY ? wag.drowsy : wag.awake;
        motion = { amp: calm.amp + (wag.excited.amp - calm.amp) * mix, speed: calm.speed + (wag.excited.speed - calm.speed) * mix };
      } else if (S.excited) motion = wag.excited;
      else if (rm) motion = null;
      else if (S.state === STATES.DROWSY) motion = wag.drowsy;
      let { amp = 0, speed = 0, base = 0, tau = wag.tau } = motion || {};
      if (P.tailAmp !== null && !asleep && !joyfulWag) { amp = P.tailAmp; speed = P.tailSpeed; }
      S.tailWagSpeed = speed;
      const fixed = (pinnedMotionDemo && motionFrame) || P.dogPoseTime != null;
      if (P.dogPoseTime != null) {
        S.tailPhase = P.dogPoseTime * speed;
      } else if (pinnedMotionDemo && motionFrame) {
        const time = motionFrame.time;
        S.tailPhase = joyfulWag ? PET_DEMO_START * wag.awake.speed + (time - PET_DEMO_START) * speed : time * speed;
      } else S.tailPhase += dt * speed;
      const angle = base + amp * Math.sin(S.tailPhase);
      S.tailAngle = (typingWag && asleep) || fixed ? angle : approach(S.tailAngle, angle, dt, tau);

      // 伸出 / 收回：匀速推进进度，画的时候再缓入缓出
      const want = tailWanted(now) && !P.mouseAbs && !P.mouseHidden && !P.hideCat;
      S.tailWant = want;
      if (S.tailReach === 0) S.tailSide = S.mouseSide; // 只在收好时换边，伸到一半换边不会跳
      if (currentSpecies().mousePaw) S.tailReach = 0;
      else if (demoTail && !demoTail.done) S.tailReach = demoMouseReach(demoTailTime(now), mouse.extendMs, mouse.retractMs);
      else if (rm) S.tailReach = want ? 1 : 0;
      else S.tailReach = want ? Math.min(1, S.tailReach + dt / mouse.extendMs) : Math.max(0, S.tailReach - dt / mouse.retractMs);
      const r = S.tailReach;

      // 平时的中线：绕尾根转 tailAngle，再跟着身体平移
      const a = S.tailAngle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      const bx = P.bodyX, by = P.lift + P.bodyY;
      const idle = idleTail(tail).map((p, i) => {
        const vx = p.x - pivot.x, vy = p.y - pivot.y;
        const lift = P.tailTipLift * (1 - r) * (i / (tail.samples - 1)) ** 3;
        return { x: pivot.x + vx * ca - vy * sa + bx, y: pivot.y + vx * sa + vy * ca + by - lift };
      });

      const fixedFrame = pinnedMotionDemo && motionFrame;
      if (mouse && !currentSpecies().mousePaw) {
        // 尾尖按键：按下时朝对应的按钮挪动并压扁。鼠标左键在画面右边。
        const btn = mousePressed(0) ? 0 : mousePressed(2) ? 2 : null;
        const press = Number(btn !== null), x = btn === 0 ? mouse.pressX : btn === 2 ? -mouse.pressX : S.tailPressX;
        S.tailPress = rm || fixedFrame ? press : approach(S.tailPress, press, dt, mouse.pressMs);
        S.tailPressX = fixedFrame ? x : approach(S.tailPressX, x, dt, mouse.pressMs);
      }

      let pts = idle;
      if (r > 0) {
        const H = MOUSE_HOME[S.tailSide], off = motionFrame?.mouse || S.mouseOff;
        const m = { x: H.x + off.x + P.mouseX, y: H.y + off.y + P.mouseY };
        const tap = motionFrame?.mouse ? motionFrame.time - MD.up : now - S.tailTapAt;
        const { duration, height } = mouse.bounce;
        const bounce = !rm && tap >= 0 && tap < duration ? height * Math.sin(Math.PI * tap / duration) : 0;
        // 尾巴中段比尾尖慢半拍跟上鼠标，曲线跟着鼠标的移动轻轻弯
        if (!S.tailLag || rm || fixedFrame) S.tailLag = { x: m.x, y: m.y };
        else { S.tailLag.x = approach(S.tailLag.x, m.x, dt, mouse.lagMs); S.tailLag.y = approach(S.tailLag.y, m.y, dt, mouse.lagMs); }
        const direction = H.x < rig.turnX ? 1 : -1;                     // 从鼠标指向身体的横向方向
        const mirrorX = (x) => (direction > 0 ? x : 2 * rig.turnX - x);    // 固定点按鼠标所在侧镜像
        const sway = rm ? 0 : mouse.sway.height * Math.sin((motionFrame?.time ?? now) / mouse.sway.period);
        const ctrl = mouse.points({
          bx, by, mirrorX, direction, lag: S.tailLag, mouse: m, sway, pressX: S.tailPressX, press: S.tailPress, bounce,
        });
        const reach = resample(catmull(ctrl, 10), tail.samples);
        // 逐点插值：伸出时尾根先动、尾尖最后到；收回时尾尖先离开鼠标。中间整体往上抬一段，像把尾巴甩过来
        pts = idle.map((p, i) => {
          const s = i / (tail.samples - 1);
          const e0 = clamp(r * 1.35 - 0.35 * s, 0, 1), e = e0 < 0.5 ? 2 * e0 * e0 : 1 - 2 * (1 - e0) * (1 - e0);
          const q = reach[i];
          return { x: p.x + (q.x - p.x) * e, y: p.y + (q.y - p.y) * e - mouse.reachLift * Math.sin(Math.PI * e) * s };
        });
        // 过渡中把中线抹顺几遍：平时的尾尖小弯钩和搭鼠标的走向插值时会挤出很急的弯，轮廓内侧会打结
        const k = 0.5 * Math.sin(Math.PI * Math.min(1, r));
        for (let it = 0; k > 0.01 && it < 4; it++) {
          const prev = pts.map((p) => ({ x: p.x, y: p.y }));
          for (let i = 1; i < tail.samples - 1; i++) {
            pts[i].x += k * ((prev[i - 1].x + prev[i + 1].x) / 2 - prev[i].x);
            pts[i].y += k * ((prev[i - 1].y + prev[i + 1].y) / 2 - prev[i].y);
          }
          const n = tail.samples - 1; // 尾尖顺着前两点的方向延伸
          pts[n].x += k * (2 * prev[n - 1].x - prev[n - 2].x - prev[n].x);
          pts[n].y += k * (2 * prev[n - 1].y - prev[n - 2].y - prev[n].y);
        }
      } else S.tailLag = null;

      // 扩展模块接管尾巴（尾巴拍键等演出）：从当前中线过渡到模块给的姿势
      if (P.tailOverride) pts = resample(P.tailOverride(now, pts), tail.samples);

      const press = P.tailOverride ? 0 : S.tailPress * r;
      if (SillyArt.tailSegments) {
        SillyArt.tail(resample(pts, SillyArt.tailSegments + 1), s => 2 * halfWidth(s, press));
      }
      const bodyD = ribbonD(halfWidth, pts, 0, 1, 0, press, false);
      for (const n of el.tail.body) n.setAttribute('d', bodyD);
      const markings = window.SillyCoats?.current()?.tail;
      let tipD;
      if (markings) {
        const section = ([s0, s1], roundEnd) =>
          ribbonD(halfWidth, resample(pts, 8, s0, s1), s0, s1, markingInset, press, false, roundEnd);
        const ringsD = markings.rings.map((range) => section(range, false)).join(' ');
        for (const n of el.tail.rings) n.setAttribute('d', ringsD);
        tipD = section(markings.tip, true);
      } else {
        const L = pathLen(pts);
        tipD = ribbonD(halfWidth, tipPts(pts, L, tipLength), 1 - tipLength / L, 1, markingInset, press, true);
      }
      for (const n of el.tail.tip) n.setAttribute('d', tipD);
      const tf = turnTf(P, rig.turnX);
      const offset = P.dogTailOffset;
      el.tail.back.setAttribute('transform', offset ? tf + `translate(${f1(offset.x)} ${f1(offset.y)})` : tf);
      el.tail.front.setAttribute('transform', tf);
      // 前面那一份只在伸出来时画（不用半透明淡入：叠在键盘上会显出一块灰）。平时尾巴根部被键盘上沿挡住的那一小截，
      // 一开始甩就到了键盘上面，几帧之内整条就抬起来了
      const frontOn = r > 0 && !P.hideCat;
      if (frontOn !== S.tailFrontOn) { S.tailFrontOn = frontOn; el.tail.front.style.display = frontOn ? '' : 'none'; }
    }

    function renderBody(now, rm, P, rig) {
      const { pivot: { x, y }, breathScale } = rig.body;
      const b = S.state === STATES.ASLEEP && !rm ? Math.sin(now * 2 * Math.PI / 3200) * P.breath : 0;
      const tf = `translate(${f1(P.bodyX)} ${f1(P.bodyY + P.lift)}) rotate(${P.bodyRot.toFixed(2)} ${x} ${y}) ` +
        `translate(${x} ${y}) scale(${(P.bodySX * (1 + breathScale.x * b)).toFixed(4)} ${(P.bodySY * (1 + breathScale.y * b)).toFixed(4)}) translate(${-x} ${-y})`;
      el.body.setAttribute('transform', turnTf(P, rig.turnX) + tf);
      el.tail.mask.setAttribute('transform', tf); // 前面那份尾巴的遮罩跟着身体走（#tail-front 自己已带转身变换）
    }

    function renderZzz(now, P, { origin }) {
      const on = S.state === STATES.ASLEEP;
      el.zzz.forEach((z, i) => {
        if (!on) { z.style.display = 'none'; return; }
        const t = now - S.sleepSince;
        const ph = ((t / 2600) + i / 3) % 1;
        const born = t > i * 860; // 依次出现
        z.style.display = born ? '' : 'none';
        const x = origin.x + P.zzzDx + ph * 40 + Math.sin(ph * 6) * 4;
        const y = origin.y + P.zzzDy - ph * 78;
        const sc = 0.7 + ph * 0.8;
        z.setAttribute('transform', `translate(${f1(x)} ${f1(y)}) scale(${sc.toFixed(3)})`);
        z.setAttribute('opacity', Math.sin(Math.PI * ph).toFixed(3));
      });
    }

    function renderMouse(dt, P) {
      if (S.mouseButtons.size === 0) {
        S.mouseOff.x = approach(S.mouseOff.x, 0, dt, 300);
        S.mouseOff.y = approach(S.mouseOff.y, 0, dt, 300);
      }
      el.mouse.style.display = P.mouseHidden ? 'none' : '';
      if (P.mouseAbs) { // 发飙、修理时由扩展模块直接摆鼠标
        const a = P.mouseAbs;
        el.mouse.setAttribute('transform', `translate(${f1(a.x)} ${f1(a.y)}) rotate(${(a.rot || 0).toFixed(1)}) scale(${(a.sx || 1).toFixed(3)} ${(a.sy || 1).toFixed(3)})`);
        return;
      }
      const m = mousePoint();
      el.mouse.setAttribute('transform', `translate(${f1(m.x + P.mouseX)} ${f1(m.y + P.mouseY)}) rotate(${P.mouseRot.toFixed(2)})`);
    }

    // 转身过渡：角色绕自身中线横向挤压
    const turnTf = (P, x) => (P.turnSX !== 1 ? `translate(${x} 0) scale(${Math.max(0.02, P.turnSX).toFixed(3)} 1) translate(${-x} 0) ` : '');

    // 每帧由扩展模块叠加的姿态（加法 / 乘法），默认值等于"什么都不改"
    function defaultPose() {
      return {
        headX: 0, headY: 0, headRot: 0, bodyX: 0, bodyY: 0, bodyRot: 0, lift: 0,
        earDroop: 0, breath: 1, lidMin: 0, tailAmp: null, tailSpeed: 0, tailTipLift: 0,
        pawTau: 1, pressBoost: 0, zzzDx: 0, zzzDy: 0, mouseX: 0, mouseY: 0, mouseRot: 0, hideCat: false,
        turnSX: 1, eyesClosed: false, eyesHappy: false, look: null, cheek: 0, mouseAbs: null, mouseHidden: false,
        suppressPetSmile: false, // 扩展模块可以压掉「被摸头」的眯眼笑（听歌、游戏等接管表情时用）
        tailOverride: null, // 扩展模块接管尾巴：function(now, basePts) 返回完整中线（画面坐标），用于尾巴拍键等演出
        pupilR: null, // 瞳孔半径（画面单位），扩展模块可放大瞳孔（捕猎态）
        headSX: 1, headSY: 1, bodySX: 1, bodySY: 1, // 乘法：围绕各自的物种枢轴缩放
      };
    }
    const catParts = ['cat-head', 'cat-body', 'tail', 'arm-l', 'arm-r', 'paw-l', 'paw-r'].map($);
    function setCatHidden(h) {
      if (h === S.catHidden) return;
      S.catHidden = h;
      for (const n of catParts) n.style.display = h ? 'none' : '';
    }

    let last = performance.now();
    const loggedFrameErrors = new Set();    function frame(now) {
      try {
        const dt = clamp(now - last, 0, 64);
        last = now;
        const rm = reducedMotion();
        update(now, dt, rm);
        if (requestedKeyboard !== kb.style && !ask('blocksKeyboardChange', now)) {
          releaseKeys();
          S.lookCode = null;
          kb.setStyle(requestedKeyboard);
          call('keyboardChanged');
        }
        const P = defaultPose();
        call('pose', now, dt, rm, P);   // 扩展模块叠加姿态
        const rig = currentRig();
        poseMouseReach(now, dt, rm, P, rig);
        setCatHidden(P.hideCat);
        renderMouse(dt, P);
        renderPaws(now, dt, P, rig);
        renderHead(now, dt, rm, P, rig);
        renderEyes(now, dt, P, rig.eyes);
        renderEars(now, P, rig.ears);
        renderTail(now, dt, rm, P, rig);
        renderBody(now, rm, P, rig);
        renderZzz(now, P, rig.zzz);
        call('render', now, dt, rm, P);
        fx.tick(now, rm);
      } catch (error) {
        const signature = String(error);
        if (!loggedFrameErrors.has(signature)) {
          loggedFrameErrors.add(signature);
          console.error('SillyCat frame failed', error);
          recordBootError('frame: ' + (error && error.stack || error));
        }
      } finally {
        requestAnimationFrame(frame);
      }
    }
    // ---------- 给扩展模块的上下文 ----------
    function pointerInScene() {
      const matrix = S.pointer && scene.getScreenCTM();
      return matrix ? new DOMPoint(S.pointer.x, S.pointer.y).matrixTransform(matrix.inverse()) : null;
    }
    function followsPointer(now, P) {
      return eyesFollow && S.pointer && now < S.pointer.at + GAZE_HOLD_MS &&
        !S.pet && !P.look && !P.hideCat && !P.eyesClosed && !P.eyesHappy && P.dogPoseTime == null &&
        (S.state === STATES.AWAKE || S.state === STATES.DROWSY) &&
        !(now - S.lastKeyAt < 1200 && S.lookCode);
    }
    function headToScene(x, y) { // 头部局部坐标 -> 画面坐标（按当前头部变换）
      const { tx, ty, rot, sx, sy, pivot } = S.headTf;
      const a = rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      const vx = (x - pivot.x) * sx, vy = (y - pivot.y) * sy;
      return { x: pivot.x + vx * c - vy * s + tx, y: pivot.y + vx * s + vy * c + ty };
    }
    function sceneToHead(x, y) { // headToScene 的逆变换
      const H = S.headTf, { pivot } = H, a = -H.rot * Math.PI / 180;
      const vx = x - H.tx - pivot.x, vy = y - H.ty - pivot.y;
      return {
        x: pivot.x + (vx * Math.cos(a) - vy * Math.sin(a)) / H.sx,
        y: pivot.y + (vx * Math.sin(a) + vy * Math.cos(a)) / H.sy,
      };
    }
    function releaseKeys() {
      for (const code of S.pressed.keys()) kb.setDown(code, false);
      S.pressed.clear();
      S.heldSince.clear();
      for (const p of [paws.L, paws.R]) { p.held.length = 0; p.releaseAt = 0; }
    }
    function releaseAll() { // 发飙时松开所有键和鼠标（画面上）
      releaseKeys();
      for (const b of S.mouseButtons) if (el.mouseBtn[b]) el.mouseBtn[b].classList.remove('down');
      S.mouseButtons.clear();
      S.mouseActiveUntil = 0;
    }
    const ctx = {
      S, STATES, el, kb, fx, paws, keycapText: displayKey, keyPoint, mousePoint, mousePaw, mouseHome, restPoint, headToScene, sceneToHead, choosePaw,
      // 尾巴几何工具：tailslap 拍键姿势要按宿主尾巴重采样（缺了会在 pose 钩子里抛错，
      // 整个渲染帧被 try/catch 吞掉——眼睛冻住、猫像断电一样不动）
      catmull, resample,
      releaseAll, reducedMotion, clamp, approach, f1, pointerInScene, followsPointer,
      get species() { return currentSpecies(); },
      get rig() { return currentRig(); },
      get shoulders() { return currentRig().paws.shoulders; },
    };
    // 模块创建逐个上护栏：一个模块在创建时抛异常不能拖死整个启动（猫会永远冻结）
    for (const make of modules) {
      try {
        mods.push(make(ctx) || {});
      } catch (error) {
        console.error('SillyCat module failed to start', error);
        recordBootError('module: ' + (error && error.stack || error));
        mods.push({});
      }
    }

    requestAnimationFrame(frame);

    // ---------- 只读调试信息 ----------
    const debugObj = {
      get state() { refreshState(performance.now()); return S.state; },
      get excited() { refreshState(performance.now()); return S.excited; },
      get paws() {
        const now = performance.now();
        if (currentSpecies().mousePaw) refreshState(now);
        return Object.freeze({ left: targetOf(paws.L, now).id, right: targetOf(paws.R, now).id });
      },
      get pressed() { return Object.freeze([...S.pressed.keys()]); },
      get sleepSeconds() { return S.sleepMs / 1000; },
      get mouseSide() { return S.mouseSide; },
      // 尾巴操作鼠标：'idle' 收在身后 | 'reaching' 伸出途中 | 'on-mouse' 搭在鼠标上 | 'retracting' 收回途中
      get tail() {
        const now = performance.now();
        refreshState(now);
        const r = S.tailReach; // 伸出进度按渲染帧推进；后台标签页 rAF 被节流时会落后
        return tailWanted(now) ? (r >= 1 ? 'on-mouse' : 'reaching') : r > 0 ? 'retracting' : 'idle';
      },
      get tailReach() { return Math.round(S.tailReach * 1000) / 1000; },
      get tailWagHz() { return S.tailWagSpeed * 1000 / (2 * Math.PI); },
      get tilt() { return motionFrame?.tilt ?? S.tiltAngle; },
      get floaters() { return Object.freeze(fx.texts(performance.now())); },
    };
    // 扩展模块的调试字段：读取前同样先推进状态
    for (const m of mods) {
      for (const [k, fn] of Object.entries(m.debugProps || {})) {
        Object.defineProperty(debugObj, k, { enumerable: true, get() { refreshState(performance.now()); return fn(); } });
      }
    }
    const debug = Object.freeze(debugObj);
    api.debug = debug;
    return Object.freeze(api);
  }

  window.SillyCat = { createCat, STATES, LEFT_CODES };
})();
