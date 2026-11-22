// 疲劳与情绪：打字太久 -> 累了 -> 生气 -> 发飙砸键盘鼠标 -> 罢工 -> 休息够了消气。
// 作为 cat.js 的扩展模块：通过钩子拦截输入（只影响画面，不碰真实的浏览器事件）。
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const RAGE_MS = 2800;
  const TYPING_WINDOW = 3000;      // 距上一次按键不超过 3 秒算"正在打字"
  const IMPACTS = [780, 1180, 1580]; // 三次砸键盘落下的时刻
  const MOUSE_HIT = 2150;
  const RECOVER_MS = 600, BANDAGE_MS = 60000;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const rand = (a, b) => a + Math.random() * (b - a);

  function create(ctx, opts = {}) {
    const { S, STATES, kb, paws, clamp, f1 } = ctx;
    const $ = (id) => document.getElementById(id);
    let workSec = opts.workSeconds || 90;
    let restSec = opts.restSeconds || 20;

    // 在键盘和鼠标里补上"砸烂"和"创可贴"的图层
    $('keyboard').insertAdjacentHTML('beforeend', `
      <g id="kb-crack" style="display:none">
        <path class="crack-gap" d="M 392 378 L 404 402 L 396 424 L 414 448 L 404 476 L 420 506 L 410 540"/>
        <path class="crack" d="M 392 378 L 404 402 L 396 424 L 414 448 L 404 476 L 420 506 L 410 540
          M 404 402 L 440 412 L 452 436 M 414 448 L 372 466 L 356 492 M 420 506 L 470 520 L 486 546
          M 250 388 L 262 404 L 254 418 M 560 540 L 548 556 L 556 572"/>
      </g>
      <g id="kb-bandage" style="display:none" transform="translate(556 397) rotate(16)">
        <rect class="bandage" x="-28" y="-9" width="56" height="18" rx="9"/>
        <rect class="bandage-pad" x="-9" y="-7" width="18" height="14" rx="3"/>
        <circle class="bandage-dot" cx="-19" cy="-3" r="1.4"/><circle class="bandage-dot" cx="-19" cy="3" r="1.4"/>
        <circle class="bandage-dot" cx="19" cy="-3" r="1.4"/><circle class="bandage-dot" cx="19" cy="3" r="1.4"/>
      </g>`);
    $('mouse-shell').insertAdjacentHTML('beforeend', `
      <path id="mouse-crack" class="crack" style="display:none" d="M -24 14 L -10 6 L -14 -6 L 2 -14 L -2 -30 M -10 6 L 8 12 L 20 4 M 2 -14 L 14 -22"/>`);

    const E = {
      scene: $('scene'), keyboard: $('keyboard'), crack: $('kb-crack'), bandage: $('kb-bandage'),
      mouseCrack: $('mouse-crack'), wheel: $('mouse-wheel'),
      brows: $('brows'), sweat: $('sweat'), anger: $('anger'), puffs: $('puffs'), sigh: $('sigh'),
      strike: $('cat-strike'), strikeTail: $('strike-tail'), strikeEar: { l: $('strike-ear-l'), r: $('strike-ear-r') },
      debris: $('debris-layer'), bubbles: $('bubble-layer'),
      hint: $('rest-hint'), bar: $('fatigue-bar'),
    };

    const F = {
      v: 0, lastT: performance.now(),
      rage: null, strike: null, recover: null,
      broken: false, mouseBroken: false, impactsDone: 0, bandageUntil: 0,
      kbShakeStart: -1e9, shakeUntil: 0, shakeAmp: 0,
      nextSigh: performance.now() + 2500, sighStart: -1e9, earFlick: -1e9, earSide: 'l',
      debris: [], debrisFade: -1, bubbles: [], shown: {},
    };

    const moodOf = (v) => (v < 0.6 ? 'fine' : v < 0.85 ? 'tired' : 'angry');
    const mood = () => (F.rage || F.strike ? 'angry' : moodOf(F.v));

    // ---------- 状态推进（读取调试信息时也会调用，保证后台节流时也准） ----------
    function refresh(now) {
      let t = F.lastT;
      if (now <= t) return;
      F.lastT = now;
      if (!F.rage && !F.strike) {
        const W = workSec * 1000, dt = now - t;
        const typing = clamp(Math.min(now, S.lastKeyAt + TYPING_WINDOW) - t, 0, dt);
        const idle = dt - typing;
        if (typing > 0) {
          const need = (1 - F.v) * W;
          if (typing >= need) { F.v = 1; t += need; startRage(t); }
          else F.v += typing / W;
        }
        if (!F.rage) {
          F.v -= idle * 3 / W;                 // 没在打字：3 倍速回落
          if (S.pet) F.v -= dt * 0.0001;       // 摸头：额外每秒 0.1
          F.v = clamp(F.v, 0, 1);
          return;
        }
      }
      if (F.rage) {
        const end = F.rage.start + RAGE_MS;
        if (now < end) return;
        enterStrike(end);
        t = end;
      }
      if (F.strike) {
        F.strike.restMs += (now - Math.max(t, F.strike.start)) * (S.pet ? 2 : 1); // 摸头：休息快一倍
        if (F.strike.restMs >= restSec * 1000) endStrike(now);
      }
    }

    function startRage(t) {
      F.rage = { start: t };
      F.impactsDone = 0;
      ctx.releaseAll();
      S.excited = false;
      if (ctx.reducedMotion()) { F.broken = true; breakMouse(t, true); F.impactsDone = IMPACTS.length; }
    }
    function enterStrike(t) {
      F.rage = null;
      F.broken = true;
      F.strike = { start: t, restMs: 0, count: 0, hmphAt: 5 + Math.floor(Math.random() * 5) };
    }
    function endStrike(now) {
      F.strike = null;
      F.v = 0;
      F.recover = { start: now };
      F.broken = false;
      F.mouseBroken = false;
      F.bandageUntil = now + RECOVER_MS + BANDAGE_MS;
      F.debrisFade = now;
      for (const c of kb.codes()) kb.setGone(c, false);
      S.lastInput = now; // 之后的无输入计时从这里重新走向犯困和睡觉
    }

    function overrideState() {
      if (F.rage) return STATES.RAGE;
      if (F.strike) return STATES.STRIKE;
      return null;
    }

    // ---------- 输入拦截：只是猫不理人，真实输入照常 ----------
    function block(kind, arg, now) {
      if (F.rage) return !(kind === 'petEnd' || kind === 'keyUp' || kind === 'pointerUp');
      if (F.strike) {
        if (kind === 'petStart' || kind === 'petMove' || kind === 'petEnd') return false; // 摸头不算输入
        F.strike.restMs = 0;
        if (kind === 'keyDown') {
          F.earFlick = now; F.earSide = Math.random() < 0.5 ? 'l' : 'r';
          if (++F.strike.count >= F.strike.hmphAt) {
            F.strike.count = 0; F.strike.hmphAt = 5 + Math.floor(Math.random() * 5);
            spawnHmph(now);
          }
        }
        return true;
      }
      return false;
    }

    function keycapStyle() { return mood() === 'angry' ? 'angry' : null; }
    function afterKeyDown(code, now) { if (mood() === 'angry') F.kbShakeStart = now; }

    // ---------- 爪子 ----------
    function forcedPawTarget(paw, now) {
      if (F.strike) { const r = ctx.restPoint(paw.side); return { id: 'crossed', x: r.x, y: r.y - 40, tau: 200 }; }
      if (!F.rage || ctx.reducedMotion()) return null;
      const t = now - F.rage.start;
      const sx = paw.side === 'L' ? 1 : -1; // 猫的左爪在观众右侧
      if (t < 500) return { id: 'rage', x: 400 + sx * 100, y: 118, tau: 70 };
      if (t < 1700) {
        const c = ((t - 500) % 400) / 400, up = c < 0.6;
        return up ? { id: 'rage', x: 400 + sx * 100, y: 118, tau: 45 }
          : { id: 'rage', x: 400 + sx * 66, y: 440, tau: 12, pressing: true };
      }
      if (t < 2300) {
        if (paw === ctx.mousePaw()) {
          const m = ctx.mousePoint(), tt = t - 1700;
          return tt < 400 ? { id: 'rage', x: m.x, y: m.y - 120, tau: 50 }
            : { id: 'rage', x: m.x, y: m.y - 12, tau: 12, pressing: true };
        }
        return { id: 'rage', x: 400 + sx * 60, y: 430, tau: 80 };
      }
      return null;
    }

    // ---------- 特效对象 ----------
    function addSvg(parent, html) {
      parent.insertAdjacentHTML('beforeend', html);
      return parent.lastElementChild;
    }
    function spawnDebris(i, now) {
      const pool = kb.codes().filter((c) => !kb.isGone(c));
      const n = i === IMPACTS.length - 1 ? 6 + Math.floor(Math.random() * 3) : 6;
      for (let k = 0; k < n && pool.length; k++) {
        const code = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        const c = kb.center(code);
        kb.setGone(code, true);
        const text = ctx.keycapText(code, null);
        const g = addSvg(E.debris, `<g class="debris-cap"><rect x="-13" y="-12" width="26" height="24" rx="5"/><text x="0" y="4"></text></g>`);
        g.querySelector('text').textContent = text;
        F.debris.push({
          g, x: c.x, y: c.y, vx: rand(-0.35, 0.35) + (c.x - 400) * 0.0009, vy: rand(-1.0, -0.55),
          r: rand(-30, 30), vr: rand(-0.7, 0.7), floor: rand(588, 610), rest: false,
        });
      }
    }
    function breakMouse(now, quiet) {
      F.mouseBroken = true;
      if (quiet) return;
      const m = ctx.mousePoint();
      const g = addSvg(E.debris, `<g class="debris-wheel"><rect x="-4" y="-7.5" width="8" height="15" rx="4"/></g>`);
      F.debris.push({ g, x: m.x, y: m.y, vx: rand(-0.25, 0.25), vy: -0.9, r: 0, vr: rand(-0.9, 0.9), floor: m.y + 46, rest: false });
      shake(now, 150, 5);
    }
    function shake(now, ms, amp) { F.shakeUntil = now + ms; F.shakeAmp = amp; }
    function spawnHmph(now) {
      const g = addSvg(E.bubbles, `<g class="hmph"><path class="hmph-bubble" d="M -26 -14 Q -26 -30 0 -30 Q 26 -30 26 -14 Q 26 2 4 2 L -6 12 L -4 2 Q -26 2 -26 -14 Z"/><text x="0" y="-8">哼</text></g>`);
      F.bubbles.push({ g, start: now, x: 470 + rand(-10, 20), y: 112 });
    }

    // ---------- 姿态 ----------
    function pose(now, dt, rm, P) {
      const m = mood();
      if (!F.rage && !F.strike) {
        if (m === 'tired') { P.lidMin = Math.max(P.lidMin, 0.45); P.pawTau *= 1.9; P.pressBoost += 0.08; }
        else if (m === 'angry') { P.lidMin = Math.max(P.lidMin, 0.32); P.pawTau *= 1.3; P.tailAmp = 22; P.tailSpeed = 0.024; }
      }
      if (F.rage) {
        const t = now - F.rage.start;
        P.lidMin = Math.max(P.lidMin, 0.3);
        P.tailAmp = 26; P.tailSpeed = 0.03;
        if (!rm) P.lift = t < 300 ? -30 * easeOut(t / 300) : t < 2300 ? -30 : -30 * (1 - (t - 2300) / 500);
      }
      if (F.strike) P.hideCat = true;
      if (F.mouseBroken) { P.mouseRot += 14; P.mouseY += 4; }
      if (F.recover) {
        const t = now - F.recover.start;
        if (t < RECOVER_MS) P.mouseY += 300 * (1 - easeOut(t / RECOVER_MS));
      }
    }

    // ---------- 渲染 ----------
    function show(node, key, on) {
      if (F.shown[key] === on) return;
      F.shown[key] = on;
      node.style.display = on ? '' : 'none';
    }

    function render(now, dt, rm) {
      const m = mood();
      const raging = !!F.rage;
      show(E.brows, 'brows', m !== 'fine');
      show(E.sweat, 'sweat', m === 'tired' && !raging);
      show(E.anger, 'anger', m === 'angry');
      show(E.puffs, 'puffs', m === 'angry');
      if (m === 'angry') {
        const s = rm ? 1 : 1 + 0.12 * Math.sin(now / 90);
        E.anger.setAttribute('transform', `translate(478 96) scale(${s.toFixed(3)})`);
      }

      // 叹气：嘴边一小团气
      if (m === 'tired' && !raging && !rm && now >= F.nextSigh) { F.sighStart = now; F.nextSigh = now + rand(3500, 6500); }
      const ts = now - F.sighStart;
      if (ts >= 0 && ts < 900) {
        show(E.sigh, 'sigh', true);
        const p = ts / 900;
        E.sigh.setAttribute('transform', `translate(${f1(18 * p)} ${f1(6 * p)}) scale(${(0.6 + 0.6 * p).toFixed(3)})`);
        E.sigh.setAttribute('opacity', (1 - p).toFixed(3));
      } else show(E.sigh, 'sigh', false);

      // 发飙：三次砸键盘 + 砸鼠标
      if (raging && !rm) {
        const t = now - F.rage.start;
        while (F.impactsDone < IMPACTS.length && t >= IMPACTS[F.impactsDone]) {
          F.broken = true;
          spawnDebris(F.impactsDone, now);
          shake(now, 180, 7);
          F.impactsDone++;
        }
        if (t >= MOUSE_HIT && !F.mouseBroken) breakMouse(now, false);
      }
      if (F.strike && F.impactsDone < IMPACTS.length) { // 后台被节流时补上没来得及砸的
        while (F.impactsDone < IMPACTS.length) { if (!rm) spawnDebris(F.impactsDone, now); F.impactsDone++; }
        F.mouseBroken = true;
      }

      // 罢工的猫：背对观众、抱胸、尾巴拍地
      show(E.strike, 'strike', !!F.strike);
      if (F.strike) {
        const t = now - F.strike.start;
        let a = 0;
        if (!rm) { const p = (t % 1100) / 1100; a = p < 0.75 ? -24 * easeOut(p / 0.75) : -24 * (1 - (p - 0.75) / 0.25); }
        E.strikeTail.setAttribute('transform', `rotate(${a.toFixed(2)} 482 370)`);
        const te = now - F.earFlick;
        for (const s of ['l', 'r']) {
          let ea = 0;
          if (s === F.earSide && te >= 0 && te < 240) ea = 16 * Math.sin(2 * Math.PI * te / 120) * (1 - te / 240);
          E.strikeEar[s].setAttribute('transform', `rotate(${(s === 'l' ? -ea : ea).toFixed(2)} ${s === 'l' ? '322 110' : '478 110'})`);
        }
      }

      // 键盘：砸烂歪斜 / 生气时按键震动 / 新键盘滑入
      let kx = 0, ky = 0, kr = 0;
      if (F.broken) { kr = -5; ky = 6; }
      if (!rm && now - F.kbShakeStart < 140) { kx += rand(-1.5, 1.5); ky += rand(-1.5, 1.5); }
      if (F.recover) {
        const t = now - F.recover.start;
        if (t < RECOVER_MS) ky += 300 * (1 - easeOut(t / RECOVER_MS));
        else F.recover = null;
      }
      E.keyboard.setAttribute('transform', `translate(${f1(kx)} ${f1(ky)}) rotate(${kr} 400 477)`);
      show(E.crack, 'crack', F.broken);
      show(E.mouseCrack, 'mcrack', F.mouseBroken);
      show(E.wheel, 'wheel', !F.mouseBroken);
      const bLeft = F.bandageUntil - now;
      show(E.bandage, 'bandage', bLeft > 0 && !F.broken);
      if (bLeft > 0) E.bandage.setAttribute('opacity', clamp(bLeft / 1000, 0, 1).toFixed(3));

      // 画面短促震动
      if (!rm && now < F.shakeUntil) {
        E.scene.style.transform = `translate(${f1(rand(-1, 1) * F.shakeAmp * 0.5)}px, ${f1(rand(-1, 1) * F.shakeAmp * 0.5)}px)`;
      } else if (E.scene.style.transform) E.scene.style.transform = '';

      // 飞散的键帽：重力、旋转、弹跳，落在桌面上
      const fading = F.debrisFade >= 0 ? clamp(1 - (now - F.debrisFade) / RECOVER_MS, 0, 1) : 1;
      if (fading <= 0) F.debrisFade = -1;
      for (let i = F.debris.length - 1; i >= 0; i--) {
        const d = F.debris[i];
        if (fading <= 0) { d.g.remove(); F.debris.splice(i, 1); continue; }
        if (!d.rest) {
          d.vy += 0.0024 * dt;
          d.x += d.vx * dt; d.y += d.vy * dt; d.r += d.vr * dt;
          if (d.x < 20 || d.x > 780) { d.vx = -d.vx * 0.6; d.x = clamp(d.x, 20, 780); }
          if (d.y >= d.floor) {
            d.y = d.floor;
            if (d.vy < 0.12) { d.rest = true; d.vy = 0; d.vr = 0; }
            else { d.vy = -d.vy * 0.38; d.vx *= 0.7; d.vr *= 0.5; }
          }
        }
        d.g.setAttribute('transform', `translate(${f1(d.x)} ${f1(d.y)}) rotate(${d.r.toFixed(1)})`);
        d.g.setAttribute('opacity', fading.toFixed(3));
      }

      // "哼"气泡
      for (let i = F.bubbles.length - 1; i >= 0; i--) {
        const b = F.bubbles[i], p = (now - b.start) / 1100;
        if (p >= 1 || !F.strike) { b.g.remove(); F.bubbles.splice(i, 1); continue; }
        const dy = rm ? 0 : -24 * easeOut(p);
        b.g.setAttribute('transform', `translate(${f1(b.x)} ${f1(b.y + dy)})`);
        b.g.setAttribute('opacity', (p < 0.15 ? p / 0.15 : p > 0.7 ? (1 - p) / 0.3 : 1).toFixed(3));
      }

      // 页面上的疲劳条和消气倒计时
      if (E.bar) {
        E.bar.style.width = (F.v * 100).toFixed(1) + '%';
        E.bar.dataset.mood = m;
      }
      if (E.hint) {
        if (F.strike) {
          const left = Math.max(0, Math.ceil(restSec - F.strike.restMs / 1000));
          E.hint.textContent = `让它歇 ${left} 秒就消气`;
          E.hint.style.display = '';
        } else if (E.hint.style.display !== 'none') E.hint.style.display = 'none';
      }
    }

    return {
      refresh, overrideState, block, keycapStyle, afterKeyDown, forcedPawTarget, pose, render,
      setWorkSeconds(v) { workSec = clamp(+v || 90, 1, 36000); },
      setRestSeconds(v) { restSec = clamp(+v || 20, 1, 36000); },
      debugProps: {
        mood: () => mood(),
        fatigue: () => F.v,
        strikeRestLeft: () => (F.strike ? Math.max(0, restSec - F.strike.restMs / 1000) : null),
        workSeconds: () => workSec,
        restSeconds: () => restSec,
      },
    };
  }

  window.SillyFatigue = { create };
})();
