// 实验预览页专用模块（experiments.html）：三个候选功能的可视化草稿——
// 蝴蝶入侵 / 小奶猫定居 / 猫毛吸尘器。正式采纳后再拆成独立模块进 index.html。
// 用真猫做预览：通过 pose 钩子驱动眼睛和耳朵，用 forcedPawTarget 驱动爪子（同 laser.js 的路子）。
(function () {
  'use strict';
  if (!/experiments\.html$/.test(location.pathname)) { // 只在预览页生效
    window.SillyExperiments = { create: () => null };
    return;
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

  window.SillyExperiments = {
    create(ctx) {
      const { S, STATES } = ctx;
      const $ = (id) => document.getElementById(id);
      const now0 = performance.now();

      // ---------- 场景元素 ----------
      $('fx-layer').insertAdjacentHTML('beforebegin', `
        <g id="exp-butterfly" style="opacity:0">
          <g id="exp-bf-body">
            <ellipse class="exp-bf-wing" cx="-7" cy="0" rx="9" ry="6" fill="#8fb8f5" opacity="0.92"/>
            <ellipse class="exp-bf-wing" cx="7" cy="0" rx="9" ry="6" fill="#8fb8f5" opacity="0.92"/>
            <ellipse rx="2.6" ry="7" fill="#4a3f66"/>
            <circle cx="0" cy="-8" r="2.6" fill="#4a3f66"/>
            <path d="M -1 -9 Q -4 -14 -7 -15 M 1 -9 Q 4 -14 7 -15" fill="none" stroke="#4a3f66" stroke-width="1"/>
          </g>
        </g>
        <g id="exp-kitten" style="display:none">
          <ellipse id="exp-kt-shadow" class="visitor-shadow" rx="34" ry="5.5"/>
          <g id="exp-kt-root">
            <path id="exp-kt-tail" class="visitor-tail" d="" fill="#e8a25b" stroke="#5c3a1e"/>
            <g id="exp-kt-body-wrap">
              <path class="visitor-body" d="M -36 -12 C -45 -24 -44 -42 -30 -51 C -16 -60 8 -60 22 -54 C 36 -48 44 -34 40 -20 C 37 -11 30 -6 18 -5 C 6 -4 -8 -4 -18 -5 C -26 -6 -32 -8 -36 -12 Z" fill="#e8a25b" stroke="#5c3a1e"/>
              <ellipse cx="0" cy="-22" rx="26" ry="14" fill="#b96f2a" opacity="0.28"/>
            </g>
            <g id="exp-kt-upper">
              <g id="exp-kt-head" transform="translate(30 -62)">
                <g id="exp-kt-ear-l"><path class="visitor-ear" d="M -20 -9 C -24 -17 -23 -26 -18 -31 C -12 -27 -7 -21 -5 -15 C -10 -13 -16 -11 -20 -9 Z" fill="#e8a25b" stroke="#5c3a1e"/><path d="M -17 -12 C -19 -17 -18 -22 -16 -25 C -13 -22 -10 -18 -9 -15 C -12 -14 -15 -13 -17 -12 Z" fill="#b96f2a" opacity="0.55"/></g>
                <g id="exp-kt-ear-r"><path class="visitor-ear" d="M 20 -9 C 24 -17 23 -26 18 -31 C 12 -27 7 -21 5 -15 C 10 -13 16 -11 20 -9 Z" fill="#e8a25b" stroke="#5c3a1e"/><path d="M 17 -12 C 19 -17 18 -22 16 -25 C 13 -22 10 -18 9 -15 C 12 -14 15 -13 17 -12 Z" fill="#b96f2a" opacity="0.55"/></g>
                <path class="visitor-head" d="M -21 4 C -23 -6 -19 -15 -10 -18 C -6 -19.5 6 -19.5 10 -18 C 19 -15 23 -6 21 4 C 19 12 10 16 0 16 C -10 16 -19 12 -21 4 Z" fill="#e8a25b" stroke="#5c3a1e"/>
                <ellipse cx="0" cy="-2" rx="16" ry="12" fill="#b96f2a" opacity="0.2"/>
                <circle class="visitor-iris" cx="-9" cy="-3" r="6.1" fill="#6fb3e0"/>
                <circle class="visitor-iris" cx="9" cy="-3" r="6.1" fill="#6fb3e0"/>
                <g id="exp-kt-pupils">
                  <circle class="visitor-eye-dot" cx="-9" cy="-2.6" r="3"/>
                  <circle class="visitor-eye-dot" cx="9" cy="-2.6" r="3"/>
                  <circle cx="-10.4" cy="-4.6" r="1.7" fill="#fff"/>
                  <circle cx="7.6" cy="-4.6" r="1.7" fill="#fff"/>
                </g>
                <path d="M -2.4 3.4 L 2.4 3.4 L 0 6.4 Z" fill="#e0828f"/>
                <path d="M -3 8.6 Q -1.5 10.4 0 8.9 Q 1.5 10.4 3 8.6" fill="none" stroke="#5c3a1e" stroke-width="1.4" stroke-linecap="round"/>
                <path d="M -21 1 q -7 -1 -10 -4 M -21 4 q -7 0 -11 -1 M 21 1 q 7 -1 10 -4 M 21 4 q 7 0 11 -1" fill="none" stroke="#5c3a1e" stroke-width="1.4" opacity="0.7" stroke-linecap="round"/>
              </g>
            </g>
          </g>
          <g id="exp-gift" style="opacity:0">
            <ellipse rx="9" ry="7" fill="#fdfaf3" stroke="#c9c2b2" stroke-width="1.5"/>
            <path d="M -4 -2 q 4 -3 8 0" fill="none" stroke="#c9c2b2" stroke-width="1.2"/>
          </g>
        </g>
        <g id="exp-fur" style="display:none"></g>`);

      const E = {
        bf: $('exp-butterfly'), bfBody: $('exp-bf-body'), wings: document.querySelectorAll('#exp-butterfly .exp-bf-wing'),
        kitten: $('exp-kitten'), ktRoot: $('exp-kt-root'), ktUpper: $('exp-kt-upper'), ktBody: $('exp-kt-body-wrap'),
        ktHead: $('exp-kt-head'), ktEarL: $('exp-kt-ear-l'), ktEarR: $('exp-kt-ear-r'), ktShadow: $('exp-kt-shadow'),
        ktTail: $('exp-kt-tail'),
        gift: $('exp-gift'), fur: $('exp-fur'),
      };

      // ---------- 工具栏 ----------
      const btns = { butterfly: $('exp-butterfly'), kitten: $('exp-kitten'), furballs: $('exp-furballs') };
      const W = {
        bf: { on: false, spawnAt: now0 + 1500, phase: null, start: 0, pos: null, from: null, path: null },
        kt: { on: false, giftAt: now0 + 8000, giftFly: null },
        fur: { on: false, balls: [], nextAt: now0 + 2000, sucking: false, suckAt: 0 },
      };
      const setBtn = (key, on) => btns[key].classList.toggle('on', on);
      btns.butterfly.addEventListener('click', () => { W.bf.on = !W.bf.on; setBtn('butterfly', W.bf.on); });
      btns.kitten.addEventListener('click', () => { W.kt.on = !W.kt.on; setBtn('kitten', W.kt.on); E.kitten.style.display = W.kt.on ? '' : 'none'; E.gift.style.opacity = 0; });
      btns.furballs.addEventListener('click', () => {
        if (W.fur.on && !W.fur.sucking) { // 再点一次：吸尘
          W.fur.sucking = true; W.fur.suckAt = performance.now();
          ctx.fx.spawn('呼——干净了！', 560, 620, '', performance.now());
        } else if (!W.fur.on) {
          W.fur.on = true; W.fur.balls = []; W.fur.nextAt = performance.now() + 800;
          ctx.fx.spawn('开始掉毛啦…', 560, 620, '', performance.now());
        }
        setBtn('furballs', W.fur.on);
      });

      // ---------- 蝴蝶 ----------
      const BF = { inMs: 900, hoverMs: 4200, pounceMs: 520, leaveMs: 700, gapMs: 5200 };
      function bfBirth() {
        const c = ctx.kb.center('KeyH') || { x: 400, y: 470 };
        const side = Math.random() < 0.5 ? -1 : 1;
        return { x0: 400 - side * 420, x1: c.x + rand(-40, 40), y0: 200, y1: c.y - rand(90, 130), amp: rand(24, 46), t0: 0, side };
      }
      function bfPoint(p, k) { // 入场曲线：从屏幕外飞到猫头顶，带正弦摆
        const kk = smooth(k);
        const x = lerp(p.x0, p.x1, kk), y = lerp(p.y0, p.y1, kk) + Math.sin(k * Math.PI * 2.2) * p.amp * (1 - kk * 0.6);
        return { x, y };
      }
      function bfSpawn(now) { W.bf.phase = 'fly'; W.bf.start = now; W.bf.path = bfBirth(); W.bf.clicked = false; }
      E.bf.addEventListener('click', () => {
        if (W.bf.phase !== 'hover' && W.bf.phase !== 'fly') return;
        W.bf.clicked = true;
        if (W.bf.phase === 'hover') { W.bf.phase = 'pounce'; W.bf.start = performance.now(); W.bf.from = { ...W.bf.pos }; }
      });

      function tickBf(now) {
        if (!W.bf.on) { W.bf.phase = null; E.bf.style.opacity = 0; return; }
        const B = W.bf;
        if (!B.phase && now >= B.spawnAt) bfSpawn(now);
        if (!B.phase) return;
        const t = now - B.start;
        if (B.phase === 'fly') {
          const k = t / BF.inMs;
          B.pos = bfPoint(B.path, k);
          if (k >= 1) { B.phase = 'hover'; B.start = now; }
        } else if (B.phase === 'hover') {
          const c = B.path;
          B.pos = { x: c.x1 + Math.sin(t / 260) * 26, y: c.y1 + Math.sin(t / 180) * 14 };
          if (t >= BF.hoverMs) { B.phase = 'leave'; B.start = now; B.leaveFrom = { ...B.pos }; }
        } else if (B.phase === 'pounce') {
          const k = smooth(t / BF.pounceMs);
          B.pos = { x: lerp(B.from.x, B.from.x + 130, k), y: B.from.y - Math.sin(k * Math.PI) * 60 };
          if (t >= BF.pounceMs) {
            ctx.fx.spawn('扑到啦！', B.pos.x, B.pos.y - 24, 'hot', now);
            if (window.SillySounds) window.SillySounds.play('meow');
            B.phase = 'leave'; B.start = now; B.leaveFrom = { ...B.pos };
          }
        } else if (B.phase === 'leave') {
          const k = smooth(t / BF.leaveMs);
          B.pos = { x: lerp(B.leaveFrom.x, B.leaveFrom.x + (B.path.side < 0 ? -1 : 1) * 420, k), y: B.leaveFrom.y - 130 * k };
          if (k >= 1) { B.phase = null; B.spawnAt = now + BF.gapMs; }
        }
        if (!B.pos) return;
        E.bf.style.opacity = 1;
        E.bf.setAttribute('transform', `translate(${B.pos.x.toFixed(1)} ${B.pos.y.toFixed(1)})`);
        const flap = Math.sin(now / 55) * 0.62; // 扑翼
        E.wings[0].setAttribute('transform', `scale(${(1 - flap).toFixed(2)} 1)`);
        E.wings[1].setAttribute('transform', `scale(${(1 + flap).toFixed(2)} 1)`);
        return B; // 给 pose 用
      }

      // ---------- 小奶猫定居 ----------
      const KT = { x: 274, giftFlyMs: 800 };
      function ktAnchor() { const c = ctx.kb.center('KeyE') || { x: 274, y: 470 }; return c; }
      function tickKitten(now) {
        if (!W.kt.on) return;
        const c = ktAnchor();
        const breath = Math.sin(now / 620) * 0.02;
        const bob = Math.sin(now / 900) * 1.2;
        E.ktRoot.setAttribute('transform', `translate(${c.x.toFixed(1)} ${(c.y + 30).toFixed(1)})`);
        E.ktUpper.setAttribute('transform', `translate(0 ${(-bob).toFixed(2)})`);
        E.ktBody.setAttribute('transform', `scale(1 ${(1 + breath).toFixed(3)})`);
        E.ktShadow.setAttribute('cx', c.x.toFixed(1)); E.ktShadow.setAttribute('cy', (c.y + 35).toFixed(1));
        const twitch = (now % 3600) < 150;
        E.ktEarL.setAttribute('transform', twitch ? 'rotate(-12 -18 -12)' : '');
        E.ktEarR.setAttribute('transform', twitch ? 'rotate(12 18 -12)' : '');
        const blink = (now % 2600) < 130;
        document.querySelectorAll('#exp-kt-head .visitor-iris').forEach((el) => { el.style.opacity = blink ? 0 : 1; });
        document.querySelectorAll('#exp-kt-head .visitor-eye-dot, #exp-kt-head circle[fill="#fff"]').forEach((el) => { el.style.opacity = blink ? 0 : 1; });
        // 尾巴：趴在键盘边轻轻摆（简单曲线 + 变宽近似）
        const sway = Math.sin(now / 700) * 9;
        const ex = c.x - 40, ey = c.y + 8, mx = c.x - 26 + sway * 0.4, my = c.y - 18;
        const px = (t) => { const u = 1 - t; return [u * u * (c.x - 34) + 2 * u * t * mx + t * t * ex, u * u * (c.y - 34) + 2 * u * t * my + t * t * ey]; };
        let d = '';
        for (let i = 0; i <= 8; i++) { const [x, y] = px(i / 8); d += (i ? ' L ' : 'M ') + x.toFixed(1) + ' ' + y.toFixed(1); }
        E.ktTail.setAttribute('d', d); // 预览版先画中线，绶带版采纳时再搬 visitor.js 的 ribbon
        // 叼纸团礼物
        if (!W.kt.giftFly && now >= W.kt.giftAt) {
          W.kt.giftFly = { start: now, from: { x: c.x + 44, y: c.y + 6 }, to: { x: clamp(c.x + rand(120, 170), 80, 700), y: c.y + 42 } };
          E.gift.style.opacity = 1;
        }
        if (W.kt.giftFly) {
          const k = smooth((now - W.kt.giftFly.start) / KT.giftFlyMs);
          const { from, to } = W.kt.giftFly;
          const x = lerp(from.x, to.x, k), y = lerp(from.y, to.y, k) - Math.sin(k * Math.PI) * 46;
          E.gift.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(k * 160).toFixed(0)})`);
          if (k >= 1) {
            ctx.fx.spawn('送你的纸团！', to.x, to.y - 20, '', now);
            W.kt.giftFly = null; W.kt.giftAt = now + rand(11000, 16000);
            setTimeout(() => { E.gift.style.opacity = 0; }, 2200);
          }
        }
      }

      // ---------- 猫毛吸尘器 ----------
      function tickFur(now) {
        if (!W.fur.on) { E.fur.style.display = 'none'; return; }
        E.fur.style.display = '';
        const full = ctx.kb.style === 'full';
        const gy = full ? 560 : 594;
        if (!W.fur.sucking && now >= W.fur.nextAt && W.fur.balls.length < 8) {
          const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          const r = rand(5, 9), x = rand(150, 650), y = gy + rand(6, 16);
          el.innerHTML = `<circle r="${r.toFixed(1)}" fill="#cfc8ba"/><circle cx="${(-r * 0.3).toFixed(1)}" cy="${(-r * 0.25).toFixed(1)}" r="${(r * 0.45).toFixed(1)}" fill="#e6e0d3"/>`;
          E.fur.appendChild(el);
          W.fur.balls.push({ el, x, y, born: now });
          W.fur.nextAt = now + rand(2200, 3200);
        }
        const suckK = W.fur.sucking ? smooth((now - W.fur.suckAt) / 700) : 0;
        for (const b of W.fur.balls) {
          const wob = Math.sin(now / 500 + b.x) * 1.5;
          const x = lerp(b.x, 810, suckK), y = lerp(b.y + wob, gy - 40, suckK);
          b.el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(1 - suckK * 0.85).toFixed(2)})`);
          b.el.style.opacity = 1 - suckK;
        }
        if (W.fur.sucking && suckK >= 1) {
          W.fur.balls.forEach((b) => b.el.remove());
          W.fur.balls = []; W.fur.sucking = false; W.fur.nextAt = now + 2500;
        }
      }

      // ---------- pose 钩子：蝴蝶时猫盯着看、扑击时伸爪 ----------
      function pose(now, dt, rm, P) {
        if (S.state !== STATES.AWAKE) return; // 睡着时不演
        const bf = tickBf(now);
        tickKitten(now);
        tickFur(now);
        if (bf && bf.pos && (bf.phase === 'fly' || bf.phase === 'hover')) {
          P.look = { x: bf.pos.x, y: bf.pos.y };
          P.earDroop -= 5;
          ctx.S.pupilR = 16;
          P.tailAmp = 12; P.tailSpeed = 0.022;
        }
        if (bf && bf.phase === 'pounce') {
          ctx.S.pupilR = 16.5;
          P.bodyY += 3;
        }
      }
      function forcedPawTarget(paw, now) {
        const B = W.bf;
        if (B.phase === 'pounce' && B.from) {
          const t = now - B.start;
          if (t >= BF.pounceMs - 60) return null;
          const k = smooth(t / BF.pounceMs);
          const jitter = paw.side === 'L' ? 12 : -12;
          return { id: 'exp-bf-pounce', x: lerp(B.from.x, B.from.x + 60, k) + jitter, y: B.from.y + 8, tau: 55, pressing: t > BF.pounceMs * 0.55 };
        }
        return null;
      }

      return { pose, forcedPawTarget };
    },
  };
})();
