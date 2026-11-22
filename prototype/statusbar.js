// 状态条：键盘下方一条细进度条，只在「快睡着 / 快发飙 / 正在消气」时出现。
// 作为 cat.js 的扩展模块：只读状态机里的真实数值（cat.js 的 S、fatigue.js 的 statusInfo），不另起计时。
//   sleepy  困了：犯困（drowsy）期间，进度 = 犯困以来的无输入时长 / 入睡时间的后一半，满了就睡着
//   annoyed 烦躁：疲劳值 ≥ 0.5 时（不在发飙、罢工、修理中），进度 = 疲劳值本身，满了就发飙
//   calming 消气中：罢工期间，进度 = 已累计休息时长 / 需要休息的时长，满了就转回来修键盘
// 同一时刻只显示一条：calming > annoyed > sleepy。出现、消失、换种类都淡入淡出（prefers-reduced-motion 下直接切）。
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const KINDS = {
    sleepy: { label: '困了', cls: 'sb-sleepy' },
    annoyed: { label: '烦躁', cls: 'sb-annoyed' },
    calming: { label: '消气中', cls: 'sb-calming' },
  };
  // 画面坐标：键盘底边（含下沿）在 y≈590，网页版 viewBox 底边是 620，桌面版是 640
  const BOX = { x: 300, y: 596, w: 200, h: 20 };
  const TRACK = { x: 357, y: 602, w: 132, h: 8 };
  const FADE_MS = 200;      // 淡入 / 淡出各 200ms
  const RISE = 4;           // 淡入时从下方 4px 浮上来

  function create(ctx, opts = {}) {
    const { S, STATES, clamp, f1 } = ctx;
    const fatigue = opts.fatigue || null;
    let enabled = opts.enabled !== false;

    // ---------- 节点 ----------
    const scene = document.getElementById('scene');
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('id', 'status-bar');
    g.setAttribute('pointer-events', 'none');
    g.setAttribute('aria-hidden', 'true');
    g.style.display = 'none';
    g.innerHTML =
      `<rect class="sb-box" x="${BOX.x}" y="${BOX.y}" width="${BOX.w}" height="${BOX.h}" rx="${BOX.h / 2}"/>` +
      `<text class="sb-label" x="${BOX.x + 11}" y="${BOX.y + 14.2}"></text>` +
      `<rect class="sb-track" x="${TRACK.x}" y="${TRACK.y}" width="${TRACK.w}" height="${TRACK.h}" rx="${TRACK.h / 2}"/>` +
      `<rect class="sb-fill" x="${TRACK.x}" y="${TRACK.y}" width="0" height="${TRACK.h}" rx="${TRACK.h / 2}"/>`;
    // 画在散落的键帽、"哼"气泡之上，浮起的键名之下
    const fxLayer = document.getElementById('fx-layer');
    scene.insertBefore(g, fxLayer);
    const label = g.querySelector('.sb-label');
    const fill = g.querySelector('.sb-fill');

    // ---------- 取值：此刻应该显示哪一条、进度多少 ----------
    const info = () => (fatigue && fatigue.statusInfo ? fatigue.statusInfo() : { fatigue: 0, phase: null, rest: null });
    function current(now) {
      if (!enabled) return { kind: 'none', progress: 0 };
      const I = info();
      if (I.phase === 'strike') return { kind: 'calming', progress: I.rest };
      if (!I.phase && I.fatigue >= 0.5) return { kind: 'annoyed', progress: I.fatigue };
      // 再核对一次无输入时长：修理结束那一帧 fatigue.js 刚把 lastInput 重置，S.state 还留着重置前算出的 drowsy
      if (S.state === STATES.DROWSY && now - S.lastInput >= S.sleepMs / 2) return { kind: 'sleepy', progress: valueOf('sleepy', now) };
      return { kind: 'none', progress: 0 };
    }
    // 某一种条自己的数值（不管此刻轮不轮到它显示），淡出途中条跟着它走：
    // 犯困时被按键打断 -> 无输入时长归零，条在淡出时清空；睡着了 / 发飙了 / 消气了 -> 停在满格淡出
    function valueOf(kind, now) {
      if (kind === 'sleepy') {
        if (S.state === STATES.ASLEEP) return 1;
        if (S.state !== STATES.DROWSY) return 0;
        const half = S.sleepMs / 2;
        return clamp((now - S.lastInput - half) / half, 0, 1);
      }
      const I = info();
      if (kind === 'annoyed') return I.fatigue;
      if (kind === 'calming') return I.rest === null ? 1 : I.rest;
      return 0;
    }

    // ---------- 渲染 ----------
    const R = { shown: 'none', op: 0, p: 0, drawnOp: -1, drawnP: -1, drawnKind: null, display: false, last: null };
    function render(now, frameDt, rm) {
      // 淡入淡出按真实经过的时间推进（cat.js 给的 dt 每帧最多 64ms，后台被节流时会拖得很慢）
      const wall = performance.now();
      const dt = R.last === null ? frameDt : clamp(wall - R.last, 0, 1000);
      R.last = wall;
      const want = current(now);
      // 种类变了：先淡出旧的，淡出完再换成新的淡入；已经看不见时直接换
      if (want.kind !== R.shown && (R.op <= 0 || rm)) {
        R.shown = want.kind;
        R.p = want.progress;
      }
      const target = want.kind === R.shown && R.shown !== 'none' ? 1 : 0;
      if (rm) R.op = target;
      else R.op = target > R.op ? Math.min(target, R.op + dt / FADE_MS) : Math.max(target, R.op - dt / FADE_MS);
      if (R.shown !== 'none') {
        const v = R.shown === want.kind ? want.progress : valueOf(R.shown, now);
        R.p = rm ? v : ctx.approach(R.p, v, dt, 60);
      }

      const visible = R.op > 0 && R.shown !== 'none';
      if (visible !== R.display) { R.display = visible; g.style.display = visible ? '' : 'none'; }
      if (!visible) return;
      if (R.shown !== R.drawnKind) {
        R.drawnKind = R.shown;
        const K = KINDS[R.shown];
        g.setAttribute('class', 'status-bar ' + K.cls);
        label.textContent = K.label;
      }
      const p = clamp(R.p, 0, 1);
      if (Math.abs(p - R.drawnP) > 0.001) {
        R.drawnP = p;
        // 进度很小时也露出一个圆点，避免宽度小于圆角时画歪
        const w = p <= 0 ? 0 : Math.max(TRACK.h, TRACK.w * p);
        fill.setAttribute('width', f1(w));
      }
      if (R.op !== R.drawnOp) {
        R.drawnOp = R.op;
        const e = R.op * R.op * (3 - 2 * R.op); // smoothstep
        g.setAttribute('opacity', e.toFixed(3));
        g.setAttribute('transform', rm ? '' : `translate(0 ${f1(RISE * (1 - e))})`);
      }
    }

    return {
      render,
      setEnabled(v) { enabled = v !== false; },
      debugProps: {
        // kind：此刻逻辑上应显示的种类（none / sleepy / annoyed / calming）；progress：0–1 的真实数值；
        // opacity：画面上实际的不透明度（按渲染帧推进，后台标签页里会落后）
        statusBar: () => {
          const c = current(performance.now());
          return Object.freeze({
            kind: c.kind, progress: Math.round(c.progress * 1000) / 1000, enabled,
            shown: R.display ? R.shown : 'none', opacity: Math.round(R.op * 1000) / 1000,
          });
        },
      },
    };
  }

  window.SillyStatusBar = { create };
})();
