// 玩桌面快捷方式：桌子右下角摆着三张图标卡片（浏览器、文件夹、回收站），
// 你发呆时猫会伸爪拍它们——拍两下让它转圈，偶尔直接推下桌沿，一分钟后悄悄回来。
// 期间你一动它就收手，卡片停在哪里就先摆在哪里。
// 调试：?demo=icons&loop=1&at=毫秒（拍文件夹并推下桌）
(function () {
  'use strict';

  // 时间轴（毫秒）：伸手 → 第一拍 → 第二拍（爱玩才转圈）→ 想推的先盯着 → 推出脱手 → 下落 → 得意 → 收场
  const REACH = 520, B1 = 1050, B2 = 1600, SHOVE = 2100, RELEASE = 2200,
    FALL_END = 3000, SMUG = 3400, END = 3800, DONE = 2600; // 不推时 DONE 就收场
  const BAT_MS = 400;        // 一拍的时长
  const RETURN_MS = 60000, FADE_MS = 600;
  const IDLE_MIN = 6000;
  const SHOVE_P = 0.4, SPIN_P = 0.5; // 推下桌、转圈的概率

  // 卡片：底边中点是原点。x 排在键盘右侧、饭碗前面那一排
  const CARDS = [
    { x: 660, y: 544, glyph: 'globe' },
    { x: 712, y: 548, glyph: 'folder' },
    { x: 764, y: 544, glyph: 'trash' },
  ];
  const FALL_MS = FALL_END - RELEASE;

  const rand = (a, b) => a + Math.random() * (b - a);
  const unit = (v) => Math.max(0, Math.min(1, v));
  const ease = (v) => { const u = unit(v); return u * u * (3 - 2 * u); };

  // 卡片字形：底边中点是原点，往上画
  const GLYPHS = {
    globe: `
      <circle cx="0" cy="-28" r="11" style="fill:#a9d3ec;stroke:var(--ink);stroke-width:2.6"/>
      <ellipse cx="0" cy="-28" rx="11" ry="4.6" style="fill:none;stroke:var(--ink);stroke-width:1.6"/>
      <ellipse cx="0" cy="-28" rx="4.6" ry="11" style="fill:none;stroke:var(--ink);stroke-width:1.6"/>`,
    folder: `
      <path d="M -12 -39 h 9 l 3.5 4 h 11.5 v 16 h -24 Z" style="fill:#f0c05a;stroke:var(--ink);stroke-width:2.6"/>
      <path d="M -12 -29 h 24" style="fill:none;stroke:var(--ink);stroke-width:1.4"/>`,
    trash: `
      <path d="M -8.5 -38 H 8.5 L 6.5 -19 H -6.5 Z" style="fill:#c8d2d8;stroke:var(--ink);stroke-width:2.6"/>
      <path d="M -12 -38 H 12 M -4 -41 h 8" style="fill:none;stroke:var(--ink);stroke-width:2.6"/>
      <path d="M -3.5 -34 V -23 M 3.5 -34 V -23" style="fill:none;stroke:var(--ink);stroke-width:1.4"/>`,
  };

  function create(ctx, opts = {}) {
    const { S, STATES, paws, mousePaw, restPoint, reducedMotion, clamp, f1, fx } = ctx;
    const demo = opts.demo && opts.demo.name === 'icons' ? opts.demo : null;
    const pinned = demo && Number.isFinite(demo.at);
    const t0 = performance.now();
    let nextIcon = t0 + rand(6000, 12000);
    let run = null;
    // 每张卡片：被推的位移/倾斜残留、是否在场、回来时间、淡入进度
    const state = CARDS.map(() => ({ offset: 0, wob: 0, wobAt: -1e9, backAt: -1e9 }));

    const $ = (id) => document.getElementById(id);
    // 画在键盘那层之前：卡片和键盘不重叠，但爪子要盖在卡片上
    $('keyboard').insertAdjacentHTML('beforebegin', `
      <g id="icon-cards">
        ${CARDS.map((c, i) => `
        <g id="icon-${i}">
          <ellipse class="icon-shadow" cy="1.5" rx="21" ry="5"/>
          <g class="icon-tilt">
            <rect x="-18" y="-46" width="36" height="44" rx="6" style="fill:var(--cream);stroke:var(--ink);stroke-width:3"/>
            ${GLYPHS[c.glyph]}
            <rect x="-11" y="-11" width="22" height="4.5" rx="2.25" style="fill:var(--cream-dark)"/>
          </g>
        </g>`).join('')}
      </g>`);
    const E = CARDS.map((_, i) => ({
      card: $('icon-' + i), tilt: document.querySelector(`#icon-${i} .icon-tilt`),
      shadow: document.querySelector(`#icon-${i} .icon-shadow`),
    }));

    // ---------- 卡片怎么摆 ----------
    // 返回每张卡此刻的 { rot, dx, dy, opacity, shown }
    function cardView(i, now) {
      const st = state[i];
      const v = { rot: 0, dx: 0, dy: 0, opacity: 1, shown: true };
      if (st.backAt !== -1e9) {
        if (now < st.backAt) { v.shown = false; return v; }
        v.opacity = unit((now - st.backAt) / FADE_MS);
        if (now >= st.backAt + FADE_MS) st.backAt = -1e9;
      }
      if (run && run.card === i && run.acting) {
        const t = now - run.start;
        const wob = (k) => { // 第 k 拍（k=1,2）落下之后的晃动，阻尼正弦；拍击落点约在每拍 45% 处
          const at = (k === 1 ? B1 : B2) + BAT_MS * 0.45;
          const dt = t - at;
          return dt > 0 && dt < 700 ? Math.sign(k % 2 ? 1 : -1) * 13 * Math.sin(dt / 90) * Math.exp(-dt / 240) : 0;
        };
        v.rot += wob(1) + (run.spin ? wob(2) : 0);
        if (run.spin && t >= B2 + BAT_MS && t < B2 + BAT_MS + 620) v.rot += 360 * ease((t - B2 - BAT_MS) / 620);
        if (run.shove && t >= RELEASE) {
          const f = t - RELEASE;
          v.dx = 42 * unit(f / 260); v.dy = 0.0006 * f * f - 0.1 * f;
          v.rot = 150 * unit(f / FALL_MS);
        }
        return v;
      }
      // 收手后的残留：位移保留，晃动在 SETTLE_MS 里衰减
      v.dx = st.offset;
      if (st.wobAt > -1e9) {
        const dt = now - st.wobAt;
        if (dt < 600) v.rot = st.wob * Math.exp(-dt / 200) * Math.cos(dt / 60);
        else st.wobAt = -1e9;
      }
      return v;
    }

    function view(now) {
      if (!run) return null;
      const t = now - run.start;
      const phase = t < REACH ? 'reach' : t < B1 ? 'bat1' : t < B2 ? 'pause'
        : run.spin ? 'bat2' : t < SHOVE ? 'pause' : t < RELEASE ? 'shove'
        : t < FALL_END ? 'fall' : t < SMUG ? 'watch' : t < END ? 'smug' : 'gone';
      return { t, phase, acting: t < (run.shove ? END : DONE) };
    }

    function startRun(now, card, shove, spin) {
      run = { start: now, card, shove, spin, acting: true, tapped: {} };
    }

    function cancel(now) {
      if (!run) return;
      const t = now - run.start;
      const st = state[run.card];
      st.offset = run.shove && t >= RELEASE ? 42 : 0;
      st.wob = 8 * (run.card % 2 ? 1 : -1);
      st.wobAt = now;
      run = null;
      nextIcon = now + rand(30, 70) * 1000;
    }

    // 别的模块正演着（扑鼠标/推杯子/偷咖啡/敲碗/跑酷）就先不凑热闹
    function othersBusy() {
      const d = window.__cat && window.__cat.debug;
      if (!d) return false;
      if (typeof d.pounce === 'number') return true;
      if (typeof d.zoomies === 'number') return true;
      if (typeof d.meal === 'number') return true;
      if (d.coffee) return true;
      return d.pushPhase && d.pushPhase !== 'idle';
    }

    const idleOK = (now) => !S.pressed.size && !S.mouseButtons.size &&
      now - S.lastInput >= IDLE_MIN && !reducedMotion();

    function overrideState(now) {
      if (S.pet) return null;
      if (demo) return (pinned || (run && now - run.start < END)) ? STATES.AWAKE : null;
      return run && run.acting && now - run.start < (run.shove ? END : DONE) ? STATES.AWAKE : null;
    }

    function afterState(now) {
      if (demo) {
        if (!run && (pinned || now >= nextIcon)) { startRun(now, 1, true, true); nextIcon = now + 4000; }
        if (pinned && run) run.start = now - demo.at; // 冻结：时间轴每帧锁死在 demo.at
        return;
      }
      if (run) {
        const t = now - run.start;
        const scare = S.pet || S.state === STATES.ASLEEP || now - S.lastInput < 150;
        if (scare) {
          if (t < (run.shove ? RELEASE : DONE)) cancel(now);
          else run.acting = false;
        }
        if (run && run.shove && t >= FALL_END && state[run.card].backAt === -1e9) {
          state[run.card].backAt = run.start + FALL_END + RETURN_MS;
          nextIcon = Math.max(state[run.card].backAt, now + rand(25, 55) * 1000);
        }
        if (run && t >= (run.shove ? END : DONE)) run = null;
      }
      const visible = state.some((_, i) => cardView(i, now).shown);
      if (!run && visible && now >= nextIcon && S.state === STATES.AWAKE && !S.pet &&
          idleOK(now) && !othersBusy()) {
        const live = CARDS.map((_, i) => i).filter((i) => cardView(i, now).shown);
        const card = live[Math.floor(Math.random() * live.length)];
        startRun(now, card, Math.random() < SHOVE_P, Math.random() < SPIN_P);
      }
    }

    function afterKeyDown(code, now) {
      if (demo || !run) return;
      const t = now - run.start;
      if (t < (run.shove ? RELEASE : DONE)) cancel(now);
      else run.acting = false;
    }

    // ---------- 爪子：用离卡片近的那只（被鼠标占着就换另一只） ----------
    function myPaw() {
      const near = paws.L; // 卡片在观众右侧，猫的左爪近
      return mousePaw() === near ? paws.R : near;
    }

    function pawTarget(frame, now) {
      const { t } = frame;
      const c = CARDS[run.card];
      const hover = { x: c.x - 24, y: c.y - 30 };
      const bat = (k) => { // 一拍：压腕 → 拍出去 → 收回悬停位
        const b = (t - k * BAT_MS) / BAT_MS;
        if (b < 0 || b >= 1) return null;
        const windup = ease(b / 0.22) * (1 - ease((b - 0.22) / 0.2));
        const press = ease((b - 0.22) / 0.22) * (1 - ease((b - 0.62) / 0.38));
        return { x: hover.x + 14 * press - 13 * windup, y: hover.y + 4 * press - 9 * windup,
          pressing: b >= 0.35 && b < 0.62 };
      };
      if (t < REACH) {
        const p = ease(t / 300);
        return { x: hover.x * p + (1 - p) * 640, y: hover.y * p + (1 - p) * 430, pressing: false };
      }
      const k = t < B1 ? 1 : run.spin ? 2 : null;
      if (k) {
        const b = bat(k);
        if (b) return { ...b, tau: 15 };
        return { ...hover, pressing: false };
      }
      if (!run.shove) {
        if (t < DONE) { const p = ease((t - B2 - 200) / 300); // 收手
          return { x: hover.x + (640 - hover.x) * p, y: hover.y + (430 - hover.y) * p, pressing: false }; }
        return null;
      }
      if (t < SHOVE) return { ...hover, pressing: false };
      if (t < RELEASE + 120) {
        const sweep = ease((t - SHOVE) / 180);
        return { x: hover.x + 30 * sweep, y: hover.y + 8 * sweep, pressing: t < RELEASE + 40 };
      }
      return null;
    }

    function forcedPawTarget(paw, now) {
      if (paw !== myPaw()) return null;
      const frame = view(now);
      if (!frame || !frame.acting) return null;
      const target = pawTarget(frame, now);
      if (!target) return null;
      return { x: target.x, y: target.y, tau: target.tau ?? 16, pressing: target.pressing };
    }

    function pose(now, dt, rm, P) {
      const frame = view(now);
      if (!frame || !frame.acting) return;
      const { t } = frame;
      const c = CARDS[run.card];
      const look = { x: c.x + 6, y: c.y - 34 };
      if (t < REACH) P.look = { x: 400, y: 190 };
      else P.look = look;
      P.headRot += 3 * ease((t - REACH) / 250) * (1 - ease((t - (run.shove ? SHOVE : DONE - 400)) / 300));
      if (run.shove && t >= RELEASE && t < SMUG) P.look = { x: c.x + 60, y: c.y + 60 };
      if (t >= (run.shove ? SMUG : DONE - 500) && t < (run.shove ? END : DONE)) {
        P.eyesHappy = true;
        const from = run.shove ? SMUG : DONE - 500, to = run.shove ? END : DONE;
        P.headY -= 5 * Math.sin(Math.PI * (t - from) / (to - from));
        P.tailAmp = 9 + 5 * Math.sin(Math.PI * (t - from) / (to - from));
        P.tailSpeed = 0.015;
      }
      if (pinned) freezePose(now, rm, P, frame);
    }

    function freezePose(now, rm, P, frame) {
      // 冻结调试：从时间轴直接摆爪、眼皮和尾巴
      S.blinkUntil = 0;
      S.twitch.ear = null;
      S.lid = Math.max(0.18, P.lidMin);
      if (S.eyeMode === 'happy' || !frame.acting) { S.pupilX = 0; S.pupilY = 1; }
      for (const paw of [paws.L, paws.R]) {
        const target = (paw === myPaw() && pawTarget(frame, now)) || restPoint(paw.side);
        paw.x = target.x; paw.y = target.y; paw.press = target.pressing ? 1 : 0; paw.lift = 0;
      }
      P.tailAmp = P.tailAmp ?? (rm ? 0 : 9);
      P.tailSpeed = 0;
      S.tailPhase = now * 0.003;
      S.tailAngle = P.tailAmp * Math.sin(S.tailPhase);
    }

    function render(now, dt, rm) {
      for (let i = 0; i < CARDS.length; i++) {
        const v = cardView(i, now);
        E[i].card.style.display = v.shown ? '' : 'none';
        if (!v.shown) continue;
        E[i].card.setAttribute('opacity', v.opacity.toFixed(3));
        E[i].card.setAttribute('transform', `translate(${f1(CARDS[i].x + v.dx)} ${f1(CARDS[i].y + v.dy)})`);
        E[i].tilt.setAttribute('transform', `rotate(${f1(v.rot)})`);
        // 脱手下落时影子留在原地渐隐
        const falling = run && run.card === i && run.acting && run.shove && now - run.start >= RELEASE;
        E[i].shadow.style.display = falling ? 'none' : '';
      }
      // 音效和飘字：拍下去、脱手各来一次（边缘检测）
      if (run && run.acting) {
        const t = now - run.start;
        const mark = (k) => {
          if (!run.tapped[k] && t >= k * BAT_MS + BAT_MS * 0.35) {
            run.tapped[k] = true;
            if (window.SillySounds) window.SillySounds.play('tap');
          }
        };
        mark(1);
        if (run.spin) mark(2);
        if (run.shove && !run.tapped.smash && t >= RELEASE) {
          run.tapped.smash = true;
          if (window.SillySounds) window.SillySounds.play('smash');
          const c = CARDS[run.card];
          fx.spawn('啪', c.x + 40, c.y - 46, '', now);
        }
      }
    }

    if (demo) nextIcon = t0 + 800;

    return {
      overrideState, afterState, afterKeyDown, forcedPawTarget, pose, render,
      debugProps: {
        icons: () => (run ? view(performance.now()).phase : null),
        nextIconIn: () => Math.round(Math.max(0, nextIcon - performance.now()) / 100) / 10,
      },
    };
  }

  window.SillyIcons = { create };
})();
