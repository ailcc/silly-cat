// 猫：状态机 + 渲染。只消费抽象输入事件，不碰 DOM 键鼠事件。
(function () {
  'use strict';

  const STATES = Object.freeze({
    AWAKE: 'awake', DROWSY: 'drowsy', ASLEEP: 'asleep', PETTED: 'petted',
    RAGE: 'rage', STRIKE: 'strike', REPAIR: 'repair', // 由 fatigue.js 覆盖
  });

  // 爪子的左右一律按猫自己的视角：'L' = 猫的左爪 = 观众右侧（白爪），'R' = 猫的右爪 = 观众左侧（黑爪）。
  // 键盘和鼠标都朝向猫摆放。猫的左爪按标准指法负责左手键区；其余归右爪。
  const LEFT_CODES = new Set([
    'Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
    'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG',
    'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB',
    'Tab', 'CapsLock', 'Escape', 'ShiftLeft', 'ControlLeft', 'AltLeft', 'MetaLeft',
  ]);

  const EYE = { L: { cx: 345, cy: 178, r: 29 }, R: { cx: 455, cy: 178, r: 29 } };
  // 肩部锚点贴在身体轮廓内侧，手臂基本竖直往下，让观众右侧的鞍状黑斑露出来
  const SHOULDER = { L: { x: 446, y: 304 }, R: { x: 354, y: 304 } }; // 画面坐标
  // mouseSide 也按猫的视角：'right' = 猫的右手边 = 画面里键盘左侧
  const MOUSE_HOME = { right: { x: 104, y: 484 }, left: { x: 696, y: 484 } };
  const REST_KEY = { L: 'KeyG', R: 'KeyK' };
  const PAW_ON_KEY_DY = -8;   // 爪心略高于键心，让高亮的下半个键露出来
  const MOUSE_HOLD_MS = 1500;  // 鼠标停下这么久后尾巴收回身后
  const RELEASE_MS = 120;
  const EXCITE_COUNT = 6;     // 一秒内超过 6 次

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const approach = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
  const f1 = (v) => (Math.round(v * 10) / 10).toString();
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reducedMotion = () => !!(mq && mq.matches);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // 头部轮廓；b > 0 时两颊向外鼓（生气鼓腮帮），填色、裁切和描边用同一条路径
  function headPathD(b) {
    const r = (v) => Math.round(v * 10) / 10;
    return `M 270 176 C 268 98, 328 70, 400 70 C 472 70, 532 98, 530 176 ` +
      `C ${r(531 + b * 1.25)} ${r(236 + b * 0.5)}, ${r(478 + b * 0.5)} ${r(276 + b * 0.2)}, 400 276 ` +
      `C ${r(322 - b * 0.5)} ${r(276 + b * 0.2)}, ${r(269 - b * 1.25)} ${r(236 + b * 0.5)}, 270 176 Z`;
  }

  // ---------- 尾巴几何 ----------
  // 尾巴画成一条有粗细的实心带子：沿中线取点，按宽度往两侧偏移，尾尖封半圆；白尾尖是同一条中线最后一段、往里缩一圈描边宽度的带子。
  // 平时的中线 = 原来那条贝塞尔（绕 322,372 摆动）；操作鼠标时的中线按鼠标位置现算，两者按伸出进度逐点插值。
  const TAIL_PIVOT = { x: 322, y: 372 };
  const TAIL_N = 34;                 // 中线取点数
  const TAIL_EXTEND_MS = 380, TAIL_RETRACT_MS = 520;
  const TAIL_TIP_LEN = 30;           // 白尾尖沿中线的长度（不含两端的半圆）
  const TAIL_INSET = 2.3;            // 白尾尖往里缩的量（≈ 描边宽度的一半），让黑色描边整圈露出来
  const tailWidth = (s, press) => (13.2 - 2.6 * s * s) * (1 + 0.14 * press * Math.max(0, (s - 0.7) / 0.3));
  function cubicPts(c, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
      out.push({ x: a * c[0] + b * c[2] + d * c[4] + e * c[6], y: a * c[1] + b * c[3] + d * c[5] + e * c[7] });
    }
    return out;
  }
  function resample(pts, n) { // 按弧长等距重取 n 个点
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const L = cum[cum.length - 1] || 1, out = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const s = L * k / (n - 1);
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
  const TAIL_IDLE = resample([
    ...cubicPts([322, 370, 272, 372, 222, 374, 198, 350], 30),
    ...cubicPts([198, 350, 182, 334, 184, 314, 198, 306], 14).slice(1),
  ], TAIL_N);
  function pathLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return L; }
  // 中线 pts（s0..s1 是这段在整条尾巴上的位置，用来取宽度）-> 闭合轮廓路径；roundStart：起点也封半圆（白尾尖靠身体那头）
  function ribbonD(pts, s0, s1, inset, press, roundStart) {
    const n = pts.length, L = [], R = [], C = 7;
    let n0 = null, t0 = null, nl = null, tl = null, h0 = 0, hl = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, tx = (b.x - a.x) / len, ty = (b.y - a.y) / len;
      const h = tailWidth(s0 + (s1 - s0) * i / (n - 1), press) - inset;
      L.push({ x: pts[i].x - ty * h, y: pts[i].y + tx * h });
      R.push({ x: pts[i].x + ty * h, y: pts[i].y - tx * h });
      if (i === 0) { n0 = { x: -ty, y: tx }; t0 = { x: tx, y: ty }; h0 = h; }
      if (i === n - 1) { nl = { x: -ty, y: tx }; tl = { x: tx, y: ty }; hl = h; }
    }
    const P = L.slice();
    const e = pts[n - 1];
    for (let k = 1; k < C; k++) { // 尾尖半圆：左 -> 前 -> 右
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
  function tipPts(pts, total) { // 中线最后 TAIL_TIP_LEN 的那一段
    let acc = total;
    for (let i = pts.length - 1; i > 0; i--) {
      const sl = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (total - (acc - sl) >= TAIL_TIP_LEN) {
        const t = (TAIL_TIP_LEN - (total - acc)) / (sl || 1);
        const first = { x: pts[i].x + (pts[i - 1].x - pts[i].x) * t, y: pts[i].y + (pts[i - 1].y - pts[i].y) * t };
        return resample([first, ...pts.slice(i)], 8);
      }
      acc -= sl;
    }
    return resample(pts, 8);
  }

  // ?demo=tail-mouse 时间轴（毫秒）：静止 -> 鼠标开始动、尾巴伸出 -> 跟着动几下 -> 停 -> 点一下 -> 停够 1.5 秒收回 -> 静止
  const TD = { move0: 300, move1: 2000, down: 2250, up: 2400, period: 5000 };
  TD.off = TD.up + MOUSE_HOLD_MS;

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
    const live = []; // { g, text, start, x, y, dx, rot, rise }
    // style: '' | 'hot'（兴奋）| 'angry'（生气）
    function spawn(text, x, y, style, now) {
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
      live.push({
        g, text, start: now, x, y,
        dx: (Math.random() * 2 - 1) * 14,
        rot: (Math.random() * 2 - 1) * 8,
        rise: (excited ? 62 : 40) + Math.random() * (excited ? 14 : 18),
      });
    }
    function tick(now, rm) {
      for (let i = live.length - 1; i >= 0; i--) {
        const f = live[i];
        const p = (now - f.start) / FX_LIFE;
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
      for (let i = live.length - 1; i >= 0; i--) if (now - live[i].start >= FX_LIFE) { live[i].g.remove(); live.splice(i, 1); }
    }
    return { spawn, tick, texts(now) { prune(now); return live.map((f) => f.text); } };
  }

  // modules：扩展行为（睡眠阶段、疲劳……）的工厂函数数组，每个接收 ctx 返回一个带可选钩子的对象。
  function createCat({ keyboard: kb, sleepSeconds = 20, mouseSide = 'right', modules = [], demo = null }) {
    const $ = (id) => {
      const n = document.getElementById(id);
      if (!n) throw new Error('missing #' + id);
      return n;
    };
    const eyeEls = (s) => ({
      open: $('eye-' + s + '-open'), closed: $('eye-' + s + '-closed'), happy: $('eye-' + s + '-happy'),
      iris: $('iris-' + s), pupil: $('pupil-' + s), shine: $('shine-' + s),
      lid: $('lid-' + s), lidLine: $('lidline-' + s),
    });
    const el = {
      head: $('cat-head'), body: $('cat-body'),
      // 尾巴画两份：#tail 在身体后面（整条），#tail-front 在鼠标上面（遮罩掉身体那一块，只露出绕到前面的部分）
      tail: { back: $('tail'), front: $('tail-front'), body: [$('tail-body'), $('tail-front-body')], tip: [$('tail-tip'), $('tail-front-tip')], mask: $('mask-tail-body') },
      ear: { L: $('ear-l'), R: $('ear-r') },
      mouse: $('mouse'), mouseBtn: { 0: $('mouse-btn-l'), 2: $('mouse-btn-r') },
      zzz: [$('z1'), $('z2'), $('z3')],
      eye: { L: eyeEls('l'), R: eyeEls('r') },
      headShape: [$('head-fill'), $('head-line'), $('clip-head-path')],
      armG: { l: $('arm-l'), r: $('arm-r') },
    };
    const fx = createKeycapFx($('fx-layer'));

    const t0 = performance.now();
    const S = {
      state: STATES.AWAKE,
      excited: false, excitedUntil: 0, keyTimes: [],
      sleepMs: sleepSeconds * 1000, lastInput: t0, sleepSince: 0,
      pressed: new Map(),               // code -> 'L' | 'R'
      mouseSide, mouseActiveUntil: 0, mouseButtons: new Set(), mouseOff: { x: 0, y: 0 },
      pet: null,                        // { nx, ny }
      shakeStart: -1e9, nodStart: -1e9, lastKeyAt: -1e9, lookCode: null, lookSide: 'R',
      lid: 0.18, pupilX: 0, pupilY: 1, pupilR: 13,
      nextBlink: t0 + 3000 + Math.random() * 3000, blinkUntil: 0,
      twitch: { ear: null, start: -1e9 }, nextTwitch: t0 + 5000 + Math.random() * 5000,
      tailPhase: 0, tailAngle: 0, eyeMode: null,
      tailReach: 0, tailWant: false, tailSide: mouseSide, tailLag: null, tailPress: 0, tailPressX: 0, tailTapAt: -1e9, tailFrontOn: null,
      headBaseRot: -4, headBaseX: 0, headBaseY: 0,
      headTf: { tx: 0, ty: 0, rot: -4, sx: 1, sy: 1 }, catHidden: false, cheek: 0, cheekDrawn: -1,
    };

    // ---------- 扩展钩子 ----------
    const mods = [];
    const call = (name, ...a) => { for (const m of mods) if (m[name]) m[name](...a); };
    const ask = (name, ...a) => {
      for (const m of mods) if (m[name]) { const r = m[name](...a); if (r) return r; }
      return null;
    };

    function makePaw(side) {
      const s = side === 'L' ? 'r' : 'l'; // SVG 元素按画面左右命名
      const rest = restPoint(side);
      return {
        side, held: [], releaseAt: 0, lastCode: null,
        x: rest.x, y: rest.y, press: 0, lift: 0,
        els: { armOutline: $('arm-' + s + '-outline'), armFill: $('arm-' + s + '-fill'), paw: $('paw-' + s) },
      };
    }
    function restPoint(side) {
      const c = kb.center(REST_KEY[side]);
      return { x: c.x, y: c.y - 14 };
    }
    const paws = { L: makePaw('L'), R: makePaw('R') };
    // 鼠标那一侧的爪：只在发飙抓鼠标、修理时用；平时操作鼠标的是尾巴，两只爪都留在键盘上
    const mousePaw = () => (S.mouseSide === 'right' ? paws.R : paws.L);
    const mouseHome = () => MOUSE_HOME[S.mouseSide];
    const mousePoint = () => ({ x: mouseHome().x + S.mouseOff.x, y: mouseHome().y + S.mouseOff.y });
    // 尾巴要不要去操作鼠标：鼠标最近动过/点过，且醒着（睡着、发飙、罢工、修理时都不去）
    const tailWanted = (now) => now < S.mouseActiveUntil &&
      (S.state === STATES.AWAKE || S.state === STATES.DROWSY || S.state === STATES.PETTED);

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
      return LEFT_CODES.has(code) ? paws.L : paws.R;
    }

    function targetOf(paw, now) {
      const forced = ask('forcedPawTarget', paw, now); // 发飙、罢工等：压过一切
      if (forced) return forced;
      if (paw.held.length) return { id: paw.held[paw.held.length - 1], pressing: true };
      if (now < paw.releaseAt && paw.lastCode) return { id: paw.lastCode, pressing: false };
      const soft = ask('softPawTarget', paw, now); // 抹嘴、趴着摊开：只在没按键时
      if (soft) return soft;
      return { id: 'rest', pressing: false };
    }

    function keyPoint(code, side) {
      const c = kb.center(code);
      if (c) return { x: c.x, y: c.y + PAW_ON_KEY_DY };
      return kb.edgePoint(code, side);
    }

    function pointFor(id, paw) {
      if (id === 'rest') return restPoint(paw.side);
      return keyPoint(id, paw.side);
    }

    // 每个输入先把状态推进到此刻，再问扩展模块要不要拦下（发飙、罢工时猫不理人）
    function guard(kind, arg) {
      const now = performance.now();
      refreshState(now);
      return !!ask('block', kind, arg, now);
    }

    // ---------- 抽象输入事件 ----------
    const api = {
      keyDown(code) {
        if (guard('keyDown', code)) return;
        const now = performance.now();
        noteInput(now);
        if (S.pressed.has(code)) return;
        const paw = choosePaw(code, now);
        S.pressed.set(code, paw.side);
        paw.held.push(code);
        kb.setDown(code, true);
        S.nodStart = now;
        S.lastKeyAt = now;
        S.lookCode = code;
        S.lookSide = paw.side;
        S.keyTimes.push(now);
        while (S.keyTimes.length && now - S.keyTimes[0] > 1000) S.keyTimes.shift();
        if (S.keyTimes.length > EXCITE_COUNT) S.excited = true;
        if (S.excited) S.excitedUntil = now + 1000;
        const at = keyPoint(code, paw.side);
        const style = ask('keycapStyle', now) || (S.excited ? 'hot' : '');
        fx.spawn(keycapText(code, paw.side), at.x, at.y - PAW_ON_KEY_DY, style, now);
        call('afterKeyDown', code, now);
      },
      keyUp(code) {
        if (guard('keyUp', code)) return;
        const now = performance.now();
        const side = S.pressed.get(code);
        if (!side) return;
        noteInput(now);
        S.pressed.delete(code);
        const paw = paws[side];
        const i = paw.held.lastIndexOf(code);
        if (i >= 0) paw.held.splice(i, 1);
        if (paw.held.length === 0) { paw.releaseAt = now + RELEASE_MS; paw.lastCode = code; }
        kb.setDown(code, false);
      },
      pointerMove(dx, dy) {
        if (guard('pointerMove', null)) return;
        const now = performance.now();
        // 只移动鼠标不算「在干活」：不重置入睡计时，猫照样会犯困、睡着
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
        if (el.mouseBtn[button]) el.mouseBtn[button].classList.remove('down');
      },
      petStart(nx, ny) {
        if (guard('petStart', null)) return;
        const now = performance.now();
        noteInput(now);
        S.pet = { nx: nx || 0, ny: ny || 0 };
        S.state = STATES.PETTED;
      },
      petMove(nx, ny) {
        if (guard('petMove', null)) return;
        if (!S.pet) return;
        S.pet.nx = nx; S.pet.ny = ny;
        S.lastInput = performance.now();
      },
      petEnd() {
        if (guard('petEnd', null)) return;
        if (!S.pet) return;
        S.pet = null;
        S.lastInput = performance.now();
        S.state = STATES.AWAKE;
      },
      setSleepSeconds(sec) {
        S.sleepMs = clamp(+sec || 20, 1, 3600) * 1000;
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
      if (S.pet) S.state = STATES.PETTED;
      else {
        const idle = now - S.lastInput;
        S.state = idle >= S.sleepMs ? STATES.ASLEEP : idle >= S.sleepMs / 2 ? STATES.DROWSY : STATES.AWAKE;
      }
      call('refresh', now);
      const o = ask('overrideState', now);
      if (o) S.state = o;
      if (S.state === STATES.ASLEEP && prev !== STATES.ASLEEP) S.sleepSince = now;
      if (S.excited && now > S.excitedUntil) S.excited = false;
      call('afterState', now);
    }

    // ?demo=tail-mouse：鼠标位置、按键、"最近动过鼠标"都由时间轴直接给出（&at= 冻结时画面完全确定）
    const demoTail = demo && demo.name === 'tail-mouse' ? { t0: performance.now(), done: false } : null;
    function demoTailTime(now) {
      if (Number.isFinite(demo.at)) return demo.at;
      const t = now - demoTail.t0;
      return demo.loop ? t % TD.period : t;
    }
    function demoTailStep(now) {
      if (!demoTail || demoTail.done) return;
      const t = demoTailTime(now);
      if (t >= TD.period) { demoTail.done = true; return; } // 不循环：放一遍后交还给真实输入
      S.lastInput = now; // 演示期间一直醒着
      S.mouseActiveUntil = t >= TD.move0 && t < TD.off ? now + (TD.off - t) : 0;
      if (t >= TD.move0 && t < TD.move1) {
        const u = (t - TD.move0) / (TD.move1 - TD.move0), env = Math.sin(Math.PI * Math.min(1, u * 1.15));
        S.mouseOff.x = 6 * env * Math.sin(2 * Math.PI * (t - TD.move0) / 850);
        S.mouseOff.y = 5 * env * Math.sin(2 * Math.PI * (t - TD.move0) / 560);
      }
      const down = t >= TD.down && t < TD.up;
      if (down !== S.mouseButtons.has(0)) {
        if (down) S.mouseButtons.add(0); else S.mouseButtons.delete(0);
        el.mouseBtn[0].classList.toggle('down', down);
      }
      S.tailTapAt = t >= TD.up ? now - (t - TD.up) : -1e9;
    }
    // 伸出进度（0 = 收在身后，1 = 搭在鼠标上）：演示时直接由时间轴算出
    function demoTailReach(t) {
      if (t < TD.move0) return 0;
      if (t < TD.off) return Math.min(1, (t - TD.move0) / TAIL_EXTEND_MS);
      return Math.max(0, 1 - (t - TD.off) / TAIL_RETRACT_MS);
    }

    function update(now) {
      demoTailStep(now);
      refreshState(now);
      const rm = reducedMotion();
      if (!rm && (S.state === STATES.AWAKE || S.state === STATES.DROWSY) && now > S.nextBlink) {
        S.blinkUntil = now + 140;
        S.nextBlink = now + 3000 + Math.random() * 3000;
      }
      if (!rm && S.state === STATES.AWAKE && now > S.nextTwitch) {
        S.twitch = { ear: Math.random() < 0.5 ? 'L' : 'R', start: now };
        S.nextTwitch = now + 5000 + Math.random() * 7000;
      }
    }

    function renderPaws(now, dt, P) {
      for (const paw of [paws.L, paws.R]) {
        const t = targetOf(paw, now);
        const goal = t.x !== undefined ? { x: t.x, y: t.y } : pointFor(t.id, paw);
        const tau = (t.tau || (t.pressing ? 14 : t.id === 'rest' ? 45 : 25)) * P.pawTau;
        paw.x = approach(paw.x, goal.x, dt, tau);
        paw.y = approach(paw.y, goal.y, dt, tau);
        const dist = Math.hypot(goal.x - paw.x, goal.y - paw.y);
        paw.press = approach(paw.press, t.pressing && dist < 6 ? 1 : 0, dt, 16);
        paw.lift = approach(paw.lift, dist > 10 ? 1 : 0, dt, 30);

        const sx = 1 + (0.13 + P.pressBoost) * paw.press + 0.06 * paw.lift;
        const sy = 1 - (0.17 + P.pressBoost) * paw.press + 0.06 * paw.lift;
        const py = paw.y - 4 * paw.lift;
        paw.els.paw.setAttribute('transform', `${turnTf(P)}translate(${f1(paw.x)} ${f1(py)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})`);

        // 手臂：肩部锚点 -> 爪背的二次曲线，距离越近弯得越多
        // 肩部锚点跟着身体的缩放走（身体以底部 400,410 为基准缩放）
        const sh = {
          x: 400 + (SHOULDER[paw.side].x - 400) * P.bodySX + P.bodyX,
          y: 410 + (SHOULDER[paw.side].y - 410) * P.bodySY + P.lift + P.bodyY,
        };
        const ex = paw.x, ey = py - 8;
        const vx = ex - sh.x, vy = ey - sh.y, len = Math.hypot(vx, vy) || 1;
        let nx = -vy / len, ny = vx / len;
        const outward = paw.side === 'L' ? 1 : -1; // 猫的左爪在观众右侧
        if (nx * outward < 0) { nx = -nx; ny = -ny; }
        const bend = clamp(70 - len * 0.25, 8, 45);
        const cx = sh.x + vx * 0.5 + nx * bend, cy = sh.y + vy * 0.5 + ny * bend;
        const d = `M ${f1(sh.x)} ${f1(sh.y)} Q ${f1(cx)} ${f1(cy)} ${f1(ex)} ${f1(ey)}`;
        paw.els.armOutline.setAttribute('d', d);
        paw.els.armFill.setAttribute('d', d);
      }
      const at = turnTf(P);
      el.armG.l.setAttribute('transform', at);
      el.armG.r.setAttribute('transform', at);
    }

    function renderHead(now, dt, rm, P) {
      const asleep = S.state === STATES.ASLEEP;
      let rotGoal = -4, xGoal = 0, yGoal = 0;
      if (asleep) { rotGoal -= 3; yGoal += 8; }
      if (S.pet) {
        rotGoal += S.pet.nx * 6 + (rm ? 0 : 2.5 * Math.sin(now / 90));
        xGoal += S.pet.nx * 7;
        yGoal += S.pet.ny * 2;
      }
      S.headBaseRot = approach(S.headBaseRot, rotGoal, dt, asleep ? 500 : 70);
      S.headBaseX = approach(S.headBaseX, xGoal, dt, 70);
      S.headBaseY = approach(S.headBaseY, yGoal, dt, asleep ? 500 : 70);

      let rot = S.headBaseRot + P.headRot, tx = S.headBaseX + P.headX, ty = S.headBaseY + P.headY + P.lift;
      const tn = now - S.nodStart;
      if (tn < 140) ty += 2 * Math.sin(Math.PI * tn / 140);
      const ts = now - S.shakeStart;
      if (ts >= 0 && ts < 420) rot += 6 * Math.sin(4 * Math.PI * ts / 420); // 甩两下 ±6°
      if (asleep && !rm) ty += 1.5 * P.breath * Math.sin(now * 2 * Math.PI / 3200);
      const hsx = P.headSX, hsy = P.headSY;
      S.headTf = { tx, ty, rot, sx: hsx, sy: hsy };
      // 鼓腮帮：改头部轮廓本身
      S.cheek = approach(S.cheek, P.cheek, dt, 90);
      if (Math.abs(S.cheek - S.cheekDrawn) > 0.05) {
        S.cheekDrawn = S.cheek;
        const d = headPathD(S.cheek);
        for (const n of el.headShape) n.setAttribute('d', d);
      }
      const hs = hsx !== 1 || hsy !== 1 ? ` translate(400 262) scale(${hsx.toFixed(4)} ${hsy.toFixed(4)}) translate(-400 -262)` : '';
      el.head.setAttribute('transform', `${turnTf(P)}translate(${f1(tx)} ${f1(ty)}) rotate(${rot.toFixed(2)} 400 262)${hs}`);
    }

    function renderEyes(now, dt, P) {
      const mode = S.state === STATES.ASLEEP || P.eyesClosed ? 'closed' : (S.state === STATES.PETTED || P.eyesHappy) ? 'happy' : 'open';
      if (mode !== S.eyeMode) {
        S.eyeMode = mode;
        for (const s of ['L', 'R']) {
          const e = el.eye[s];
          e.open.style.display = mode === 'open' ? '' : 'none';
          e.closed.style.display = mode === 'closed' ? '' : 'none';
          e.happy.style.display = mode === 'happy' ? '' : 'none';
        }
      }
      if (mode !== 'open') return;

      let lidGoal = S.state === STATES.DROWSY ? 0.55 : S.excited ? 0.04 : 0.18;
      lidGoal = Math.max(lidGoal, P.lidMin);
      if (now < S.blinkUntil) lidGoal = 1;
      S.lid = approach(S.lid, lidGoal, dt, now < S.blinkUntil ? 18 : 60);

      // 看向刚按的键，或者正在用的鼠标
      let lx = 0, ly = 1;
      if (now - S.lastKeyAt < 1200 && S.lookCode) {
        const p = keyPoint(S.lookCode, S.lookSide);
        lx = clamp((p.x - 400) / 220, -1, 1) * 5; ly = 4;
      } else if (now < S.mouseActiveUntil) {
        lx = clamp((mousePoint().x - 400) / 220, -1, 1) * 5; ly = 4;
      }
      S.pupilX = approach(S.pupilX, lx, dt, 60);
      S.pupilY = approach(S.pupilY, ly, dt, 60);
      S.pupilR = approach(S.pupilR, S.excited ? 18 : 13, dt, 80);
      if (P.look) {
        // 扩展模块按时间轴给出视线目标，转眼的过渡也由模块控制。
        S.pupilX = clamp((P.look.x - 400) / 300, -1, 1) * 8;
        S.pupilY = 1 + clamp((P.look.y - 178) / 520, -1, 1) * 8;
      }

      for (const s of ['L', 'R']) {
        const g = EYE[s], e = el.eye[s];
        const px = g.cx + S.pupilX, py = g.cy + S.pupilY;
        e.iris.setAttribute('cx', f1(g.cx + S.pupilX * 0.6));
        e.iris.setAttribute('cy', f1(g.cy + S.pupilY * 0.6));
        e.pupil.setAttribute('cx', f1(px));
        e.pupil.setAttribute('cy', f1(py));
        e.pupil.setAttribute('r', f1(S.pupilR));
        e.shine.setAttribute('cx', f1(px - S.pupilR * 0.42));
        e.shine.setAttribute('cy', f1(py - S.pupilR * 0.42));
        const h = S.lid * (g.r * 2 + 4);
        e.lid.setAttribute('height', f1(h));
        const ly2 = g.cy - g.r - 2 + h;
        e.lidLine.setAttribute('y1', f1(ly2));
        e.lidLine.setAttribute('y2', f1(ly2));
        e.lidLine.style.display = S.lid > 0.03 ? '' : 'none';
      }
    }

    function renderEars(now, P) {
      for (const s of ['L', 'R']) {
        let a = 0;
        if (S.twitch.ear === s) {
          const t = now - S.twitch.start;
          if (t < 260) a = 14 * Math.sin(2 * Math.PI * t / 130) * (1 - t / 260);
        }
        a += P.earDroop; // 耷拉：两只耳朵都往外侧倒
        if (s === 'L') a = -a;
        const pivot = s === 'L' ? '322 110' : '478 110';
        el.ear[s].setAttribute('transform', `rotate(${a.toFixed(2)} ${pivot})`);
      }
    }

    function renderTail(now, dt, rm, P) {
      // 平时的摆动（和原来一样）
      let amp = 9, speed = 0.003, base = 0, tau = 60;
      if (S.state === STATES.ASLEEP) { amp = 0; speed = 0; base = -22; tau = 500; }
      else if (S.excited) { amp = 16; speed = 0.014; }
      else if (rm) { amp = 0; speed = 0; }
      else if (S.state === STATES.DROWSY) { amp = 5; speed = 0.0015; }
      if (P.tailAmp !== null && S.state !== STATES.ASLEEP) { amp = P.tailAmp; speed = P.tailSpeed; }
      S.tailPhase += dt * speed;
      S.tailAngle = approach(S.tailAngle, base + amp * Math.sin(S.tailPhase), dt, tau);

      // 伸出 / 收回：匀速推进进度，画的时候再缓入缓出
      const want = tailWanted(now) && !P.mouseAbs && !P.mouseHidden && !P.hideCat;
      S.tailWant = want;
      if (S.tailReach === 0) S.tailSide = S.mouseSide; // 只在收好时换边，伸到一半换边不会跳
      if (demoTail && !demoTail.done) S.tailReach = demoTailReach(demoTailTime(now));
      else if (rm) S.tailReach = want ? 1 : 0;
      else S.tailReach = want ? Math.min(1, S.tailReach + dt / TAIL_EXTEND_MS) : Math.max(0, S.tailReach - dt / TAIL_RETRACT_MS);
      const r = S.tailReach;

      // 平时的中线：绕尾根转 tailAngle，再跟着身体平移
      const a = S.tailAngle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      const bx = P.bodyX, by = P.lift + P.bodyY;
      const idle = TAIL_IDLE.map((p) => {
        const vx = p.x - TAIL_PIVOT.x, vy = p.y - TAIL_PIVOT.y;
        return { x: TAIL_PIVOT.x + vx * ca - vy * sa + bx, y: TAIL_PIVOT.y + vx * sa + vy * ca + by };
      });

      // 尾尖按键：按下时压下去、挪到按的那颗键上并略微压扁；松开时弹一下
      const btn = S.mouseButtons.has(0) ? 0 : S.mouseButtons.has(2) ? 2 : null;
      S.tailPress = rm ? (btn !== null ? 1 : 0) : approach(S.tailPress, btn !== null ? 1 : 0, dt, 22);
      // 猫视角的左键在画面右边（鼠标朝向猫）
      S.tailPressX = approach(S.tailPressX, btn === 0 ? 9 : btn === 2 ? -9 : S.tailPressX, dt, 22);
      const tap = now - S.tailTapAt;
      const bounce = !rm && tap >= 0 && tap < 240 ? 6 * Math.sin(Math.PI * tap / 240) : 0;

      let pts = idle;
      if (r > 0) {
        const H = MOUSE_HOME[S.tailSide];
        const m = { x: H.x + S.mouseOff.x + P.mouseX, y: H.y + S.mouseOff.y + P.mouseY };
        // 尾巴中段比尾尖慢半拍跟上鼠标，曲线跟着鼠标的移动轻轻弯
        if (!S.tailLag || rm) S.tailLag = { x: m.x, y: m.y };
        else { S.tailLag.x = approach(S.tailLag.x, m.x, dt, 110); S.tailLag.y = approach(S.tailLag.y, m.y, dt, 110); }
        const g = S.tailLag;
        const d = H.x < 400 ? 1 : -1;             // 从鼠标指向身体的横向方向
        const X = (x) => (d > 0 ? x : 800 - x);    // 固定点按鼠标所在侧镜像
        const sway = rm ? 0 : 2.2 * Math.sin(now / 640);
        const ctrl = [
          { x: X(322) + bx, y: 370 + by },                                   // 尾根，藏在身体后面
          { x: X(290) + bx, y: 366 + by },                                   // 从身体侧面绕出来
          { x: X(240) + bx * 0.5, y: 352 + by * 0.5 + sway * 0.5 },          // 往外拱起一点
          { x: g.x + d * 84, y: g.y - 128 + sway },                          // 越过键盘左上角
          { x: g.x + d * 38, y: g.y - 94 + sway * 0.6 },
          { x: g.x + d * 12, y: g.y - 46 },                                  // 从掌托那头搭上鼠标
          { x: m.x + 2 + S.tailPressX * S.tailPress, y: m.y + 4 + 5 * S.tailPress - bounce }, // 尾尖落在两颗键中间
        ];
        const reach = resample(catmull(ctrl, 10), TAIL_N);
        // 逐点插值：伸出时尾根先动、尾尖最后到；收回时尾尖先离开鼠标。中间整体往上抬一段，像把尾巴甩过来
        pts = idle.map((p, i) => {
          const s = i / (TAIL_N - 1);
          const e0 = clamp(r * 1.35 - 0.35 * s, 0, 1), e = e0 < 0.5 ? 2 * e0 * e0 : 1 - 2 * (1 - e0) * (1 - e0);
          const q = reach[i];
          return { x: p.x + (q.x - p.x) * e, y: p.y + (q.y - p.y) * e - 42 * Math.sin(Math.PI * e) * s };
        });
        // 过渡中把中线抹顺几遍：平时的尾尖小弯钩和搭鼠标的走向插值时会挤出很急的弯，轮廓内侧会打结
        const k = 0.5 * Math.sin(Math.PI * Math.min(1, r));
        for (let it = 0; k > 0.01 && it < 4; it++) {
          const prev = pts.map((p) => ({ x: p.x, y: p.y }));
          for (let i = 1; i < TAIL_N - 1; i++) {
            pts[i].x += k * ((prev[i - 1].x + prev[i + 1].x) / 2 - prev[i].x);
            pts[i].y += k * ((prev[i - 1].y + prev[i + 1].y) / 2 - prev[i].y);
          }
          const n = TAIL_N - 1; // 尾尖顺着前两点的方向延伸
          pts[n].x += k * (2 * prev[n - 1].x - prev[n - 2].x - prev[n].x);
          pts[n].y += k * (2 * prev[n - 1].y - prev[n - 2].y - prev[n].y);
        }
      } else S.tailLag = null;

      const L = pathLen(pts);
      const bodyD = ribbonD(pts, 0, 1, 0, S.tailPress * r, false);
      const tipD = ribbonD(tipPts(pts, L), 1 - TAIL_TIP_LEN / L, 1, TAIL_INSET, S.tailPress * r, true);
      for (const n of el.tail.body) n.setAttribute('d', bodyD);
      for (const n of el.tail.tip) n.setAttribute('d', tipD);
      const tf = turnTf(P);
      el.tail.back.setAttribute('transform', tf);
      el.tail.front.setAttribute('transform', tf);
      // 前面那一份只在伸出来时画（不用半透明淡入：叠在键盘上会显出一块灰）。平时尾巴根部被键盘上沿挡住的那一小截，
      // 一开始甩就到了键盘上面，几帧之内整条就抬起来了
      const frontOn = r > 0 && !P.hideCat;
      if (frontOn !== S.tailFrontOn) { S.tailFrontOn = frontOn; el.tail.front.style.display = frontOn ? '' : 'none'; }
    }

    function renderBody(now, rm, P) {
      const b = S.state === STATES.ASLEEP && !rm ? Math.sin(now * 2 * Math.PI / 3200) * P.breath : 0;
      const tf = `translate(${f1(P.bodyX)} ${f1(P.bodyY + P.lift)}) rotate(${P.bodyRot.toFixed(2)} 400 410) ` +
        `translate(400 410) scale(${(P.bodySX * (1 + 0.012 * b)).toFixed(4)} ${(P.bodySY * (1 + 0.025 * b)).toFixed(4)}) translate(-400 -410)`;
      el.body.setAttribute('transform', turnTf(P) + tf);
      el.tail.mask.setAttribute('transform', tf); // 前面那份尾巴的遮罩跟着身体走（#tail-front 自己已带转身变换）
    }

    function renderZzz(now, P) {
      const on = S.state === STATES.ASLEEP;
      el.zzz.forEach((z, i) => {
        if (!on) { z.style.display = 'none'; return; }
        const t = now - S.sleepSince;
        const ph = ((t / 2600) + i / 3) % 1;
        const born = t > i * 860; // 依次出现
        z.style.display = born ? '' : 'none';
        const x = 520 + P.zzzDx + ph * 40 + Math.sin(ph * 6) * 4;
        const y = 92 + P.zzzDy - ph * 78;
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

    // 转身过渡：整只猫绕画面中线横向挤压
    const turnTf = (P) => (P.turnSX !== 1 ? `translate(400 0) scale(${Math.max(0.02, P.turnSX).toFixed(3)} 1) translate(-400 0) ` : '');

    // 每帧由扩展模块叠加的姿态（加法 / 乘法），默认值等于"什么都不改"
    function defaultPose() {
      return {
        headX: 0, headY: 0, headRot: 0, bodyX: 0, bodyY: 0, bodyRot: 0, lift: 0,
        earDroop: 0, breath: 1, lidMin: 0, tailAmp: null, tailSpeed: 0,
        pawTau: 1, pressBoost: 0, zzzDx: 0, zzzDy: 0, mouseX: 0, mouseY: 0, mouseRot: 0, hideCat: false,
        turnSX: 1, eyesClosed: false, eyesHappy: false, look: null, cheek: 0, mouseAbs: null, mouseHidden: false,
        headSX: 1, headSY: 1, bodySX: 1, bodySY: 1, // 乘法：头以 400,262、身体以 400,410 为基准缩放
      };
    }
    const catParts = ['cat-head', 'cat-body', 'tail', 'arm-l', 'arm-r', 'paw-l', 'paw-r'].map($);
    function setCatHidden(h) {
      if (h === S.catHidden) return;
      S.catHidden = h;
      for (const n of catParts) n.style.display = h ? 'none' : '';
    }

    let last = performance.now();
    function frame(now) {
      const dt = clamp(now - last, 0, 64);
      last = now;
      const rm = reducedMotion();
      update(now);
      const P = defaultPose();
      call('pose', now, dt, rm, P);   // 扩展模块叠加姿态
      setCatHidden(P.hideCat);
      renderMouse(dt, P);
      renderPaws(now, dt, P);
      renderHead(now, dt, rm, P);
      renderEyes(now, dt, P);
      renderEars(now, P);
      renderTail(now, dt, rm, P);
      renderBody(now, rm, P);
      renderZzz(now, P);
      call('render', now, dt, rm, P);
      fx.tick(now, rm);
      requestAnimationFrame(frame);
    }
    // ---------- 给扩展模块的上下文 ----------
    function headToScene(x, y) { // 头部局部坐标 -> 画面坐标（按当前头部变换）
      const { tx, ty, rot, sx, sy } = S.headTf;
      const a = rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      const vx = (x - 400) * sx, vy = (y - 262) * sy;
      return { x: 400 + vx * c - vy * s + tx, y: 262 + vx * s + vy * c + ty };
    }
    function sceneToHead(x, y) { // headToScene 的逆变换
      const H = S.headTf, a = -H.rot * Math.PI / 180, vx = x - H.tx - 400, vy = y - H.ty - 262;
      return { x: 400 + (vx * Math.cos(a) - vy * Math.sin(a)) / H.sx, y: 262 + (vx * Math.sin(a) + vy * Math.cos(a)) / H.sy };
    }
    function releaseAll() { // 发飙时松开所有键和鼠标（画面上）
      for (const code of S.pressed.keys()) kb.setDown(code, false);
      S.pressed.clear();
      for (const p of [paws.L, paws.R]) { p.held.length = 0; p.releaseAt = 0; }
      for (const b of S.mouseButtons) if (el.mouseBtn[b]) el.mouseBtn[b].classList.remove('down');
      S.mouseButtons.clear();
      S.mouseActiveUntil = 0;
    }
    const ctx = {
      S, STATES, el, kb, fx, paws, keycapText, keyPoint, mousePoint, mousePaw, mouseHome, restPoint, headToScene, sceneToHead,
      releaseAll, reducedMotion, clamp, approach, f1,
    };
    for (const make of modules) mods.push(make(ctx) || {});

    requestAnimationFrame(frame);

    // ---------- 只读调试信息 ----------
    const debugObj = {
      get state() { refreshState(performance.now()); return S.state; },
      get excited() { refreshState(performance.now()); return S.excited; },
      get paws() {
        const now = performance.now();
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
