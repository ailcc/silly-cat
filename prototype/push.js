// 推桌上的物件：猫的动作可以收回，已经脱手的物件按自己的时间轴走完。
(function () {
  'use strict';

  // 从开始盯人算起（毫秒）。2900 开始挥爪，3000 杯子脱手。
  const REACH = 600, TAP = 1000, STARE = 2200, SHOVE = 2900, RELEASE = 3000;
  const WATCH = 3200, FALL_END = 3800, SMUG = 4200, END = 5200; // 下落 800ms：从猫身旁的高度落出窗口底边
  const RETURN_MS = 60000, FADE_MS = 600, SETTLE_MS = 180;
  const TAP_MS = (STARE - TAP) / 3, TAP_STEP = 10, MAX_OFFSET = 30;
  const IDLE_MIN = 2500, IDLE_MAX = 20000;
  // 杯底中心：猫身旁、和猫坐的高度一样（身体底边 y≈412），在键盘右上角后面，爪子往旁边一伸就够得着
  const MUG = { x: 655, y: 410 };
  const FRONT = { x: 400, y: 178 };
  const DEMOS = ['push', 'push-back'];

  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;

  function create(ctx, opts = {}) {
    const { S, STATES, paws, mousePaw, restPoint, reducedMotion, clamp, f1 } = ctx;
    const demo = opts.demo && DEMOS.includes(opts.demo.name) ? opts.demo : null;
    const pinned = demo && Number.isFinite(demo.at);
    const t0 = performance.now();
    let enabled = opts.enabled !== false;
    const interval = (v) => Number.isFinite(v) ? clamp(v, 5, 36000) : 600;
    let everySec = interval(opts.everySeconds);
    const newDeadline = (now) => now + rand(0.5, 1.5) * everySec * 1000;
    let nextPush = newDeadline(t0);
    let run = null, offset = 0, settling = null, backAt = -Infinity;
    const cupDir = () => S.mouseSide === 'left' ? -1 : 1;
    let dir = cupDir();

    const $ = (id) => document.getElementById(id);
    // 画在键盘前面的那层之前：杯子在键盘后面（被键盘挡住），手臂和爪子仍盖在杯子上
    $('keyboard').insertAdjacentHTML('beforebegin', `
      <g id="mug" class="mug" style="display:none">
        <ellipse id="mug-shadow" class="shadow" cy="2" rx="26" ry="5"/>
        <g id="mug-cup">
          <path class="mug-handle" d="M 18 -38 H 24 C 43 -38 44 -15 24 -13 H 17 Z
            M 22 -30 H 25 C 33 -30 34 -24 24 -21 H 21 Z"/>
          <path class="mug-body" d="M -22 -44 L -17 -8 Q -16 -1 -9 0 Q 0 1 9 0 Q 16 -1 17 -8 L 22 -44 Z"/>
          <path class="mug-band" d="M -17 -30 Q 0 -25 17 -30 L 16 -21 Q 0 -16 -16 -21 Z"/>
          <ellipse class="mug-rim" cy="-44" rx="22" ry="8"/>
          <ellipse class="mug-coffee" cy="-43" rx="17.5" ry="4"/>
          <g id="mug-steam" class="mug-steam">
            <path id="mug-steam-a"/><path id="mug-steam-b"/>
          </g>
        </g>
      </g>`);
    const E = {
      mug: $('mug'), shadow: $('mug-shadow'), cup: $('mug-cup'),
      steam: $('mug-steam'), steamA: $('mug-steam-a'), steamB: $('mug-steam-b'),
    };

    const unit = (p) => clamp(p, 0, 1);
    const ease = (p) => { const u = unit(p); return u * u * (3 - 2 * u); };
    const blendPoint = (a, b, p) => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) });
    const cupX = (d, distance) => 400 + d * (MUG.x - 400 + distance);

    // 同一份采样用于正常播放、打断时保留位移，以及 demo 跳到指定帧。
    function sequence(t, from, d, acting) {
      const tap = (t - TAP) / TAP_MS;
      const finished = clamp(Math.floor(tap), 0, 3);
      const beat = tap - finished;
      const tapping = t >= TAP && t < STARE;
      const slide = tapping ? ease((beat - 0.43) / 0.28) : 0;
      const distance = Math.min(MAX_OFFSET, from + TAP_STEP * (finished + slide));
      const wobble = tapping && beat > 0.43 ? 4 * Math.sin(Math.PI * (beat - 0.43) / 0.57) * (finished % 2 ? -1 : 1) : 0;
      const phase = t < REACH ? 'look' : t < TAP ? 'reach' : t < STARE ? 'tap' : t < SHOVE ? 'stare'
        : t < RELEASE ? 'shove' : t < FALL_END ? 'fall' : t < SMUG ? 'watch' : t < END ? 'smug' : 'gone';
      return {
        t, dir: d, offset: distance, wobble, beat, phase, acting: acting && t < END,
        fall: Math.max(0, t - RELEASE), opacity: t < FALL_END ? 1 : 0,
      };
    }

    function resting(d, distance, wobble, opacity, visible) {
      return { dir: d, offset: distance, wobble, opacity, fall: 0, phase: visible ? 'idle' : 'gone', acting: false };
    }

    const demoPeriod = demo && demo.name === 'push-back' ? FADE_MS + 700 : END + FADE_MS + 500;
    function demoTime(now) {
      if (pinned) return demo.at;
      const elapsed = Math.max(0, now - t0);
      return demo.loop ? elapsed % demoPeriod : elapsed;
    }

    function view(now) {
      if (demo) {
        const t = demoTime(now);
        if (demo.name === 'push-back') return resting(dir, 0, 0, unit(t / FADE_MS), true);
        const returnTime = demo.loop ? END : FALL_END + RETURN_MS;
        return t < returnTime ? sequence(t, 0, dir, true) : resting(dir, 0, 0, unit((t - returnTime) / FADE_MS), true);
      }
      if (run) return sequence(now - run.start, run.from, run.dir, run.acting);
      const wobble = settling ? settling.angle * (1 - ease((now - settling.at) / SETTLE_MS)) : 0;
      return resting(dir, offset, wobble, unit((now - backAt) / FADE_MS), now >= backAt);
    }

    function cancel(now) {
      const frame = sequence(now - run.start, run.from, run.dir, false);
      offset = frame.offset;
      settling = { at: now, angle: frame.wobble };
      run = null;
      nextPush = now + rand(30, 90) * 1000;
    }

    function overrideState(now) {
      if (S.pet) return null;
      if (demo) return (pinned || demoTime(now) < (demo.name === 'push' ? END : FADE_MS)) ? STATES.AWAKE : null;
      return run && run.acting && now - run.start < END ? STATES.AWAKE : null;
    }

    function afterState(now) {
      const newDir = cupDir();
      if (demo) { dir = newDir; return; }
      if (run) {
        const t = now - run.start;
        if (S.state !== STATES.AWAKE || !enabled || reducedMotion() || newDir !== dir) {
          if (t < SHOVE) cancel(now);
          else run.acting = false;
        }
        if (run && t >= FALL_END && backAt < run.start) {
          const goneAt = run.start + FALL_END;
          backAt = goneAt + RETURN_MS;
          nextPush = Math.max(backAt, newDeadline(goneAt));
          offset = MAX_OFFSET;
        }
        if (t >= END) run = null;
      }
      if (dir !== newDir) {
        dir = newDir;
        offset = 0;
        settling = null;
      }
      if (now >= backAt && backAt !== -Infinity) {
        offset = 0;
        if (now >= backAt + FADE_MS) backAt = -Infinity;
      }
      if (settling && now - settling.at >= SETTLE_MS) settling = null;
      const sinceKey = now - S.lastKeyAt;
      if (enabled && !run && now >= nextPush && backAt === -Infinity && S.state === STATES.AWAKE &&
          !reducedMotion() && sinceKey >= IDLE_MIN && sinceKey <= IDLE_MAX &&
          now - S.lastInput >= IDLE_MIN && !S.pressed.size && !S.mouseButtons.size) {
        run = { start: now, from: offset, dir, acting: true };
      }
    }

    function afterKeyDown(code, now) {
      if (!run) return;
      if (now - run.start < SHOVE) cancel(now);
      else run.acting = false;
    }

    function pawTarget(frame, paw) {
      const { t, dir: d, offset: distance, beat } = frame;
      const hover = { x: cupX(d, distance) - 34 * d, y: MUG.y - 30 };
      if (t < TAP) {
        return { ...blendPoint(restPoint(paw.side), hover, ease((t - REACH) / 300)), pressing: false };
      }
      if (t < STARE) {
        // 回撤、拍到杯身、再收回来，每一拍最后回到悬停的位置。
        const windup = ease(beat / 0.20) * (1 - ease((beat - 0.20) / 0.23));
        const press = ease((beat - 0.20) / 0.23) * (1 - ease((beat - 0.70) / 0.30));
        return { x: hover.x + d * (5 * press - 16 * windup), y: hover.y + 5 * press - 8 * windup,
          pressing: beat >= 0.43 && beat < 0.70 };
      }
      if (t < SHOVE) return { ...hover, pressing: false };
      const sweep = ease((t - SHOVE) / 230);
      return { x: hover.x + d * 64 * sweep, y: hover.y + 7 * sweep, pressing: t < RELEASE + 70 };
    }

    function forcedPawTarget(paw, now) {
      if (paw === mousePaw()) return null;
      const frame = view(now);
      if (!frame.acting || frame.t < REACH || frame.t >= WATCH) return null;
      return { id: 'push', ...pawTarget(frame, paw), tau: frame.t >= SHOVE ? 9 : 16 };
    }

    function pose(now, dt, rm, P) {
      const frame = view(now);
      const { t, dir: d } = frame;
      if (frame.acting) {
        const cup = { x: cupX(d, frame.offset), y: MUG.y - 36 };
        if (t < REACH) P.look = FRONT;
        else if (t < STARE) P.look = blendPoint(FRONT, cup, ease((t - REACH) / 170));
        else if (t < SHOVE) {
          P.look = blendPoint(cup, FRONT, ease((t - STARE) / 140));
          P.lidMin = Math.max(P.lidMin, 0.47 * Math.sin(Math.PI * (t - STARE) / (SHOVE - STARE)));
        } else if (t < WATCH) P.look = blendPoint(FRONT, cup, ease((t - SHOVE) / 100));
        else P.look = blendPoint(cup, { x: 400 + 400 * d, y: 700 }, ease((t - WATCH) / 210));

        P.headRot += d * 3 * ease(t / 200) * (1 - ease((t - SHOVE) / 300));
        if (t >= WATCH && t < SMUG) P.headY += 6 * Math.sin(Math.PI * (t - WATCH) / (SMUG - WATCH));
        if (t >= SMUG) {
          P.eyesHappy = true;
          const proud = Math.sin(Math.PI * (t - SMUG) / (END - SMUG));
          P.headY -= 5 * proud;
          P.tailAmp = 9 + 5 * proud;
          P.tailSpeed = 0.015;
        }
      }
      if (pinned) freezePose(now, rm, P, frame);
    }

    function freezePose(now, rm, P, frame) {
      // 固定帧从时间轴直接摆爪、眼皮和尾巴，不依赖之前播放过的帧。
      S.blinkUntil = 0;
      S.twitch.ear = null;
      S.lid = Math.max(0.18, P.lidMin);
      if (S.eyeMode === 'happy' || !frame.acting) { S.pupilX = 0; S.pupilY = 1; }
      for (const paw of [paws.L, paws.R]) {
        let point = forcedPawTarget(paw, now) || restPoint(paw.side);
        if (frame.acting && frame.t >= WATCH && frame.t < WATCH + 230 && paw !== mousePaw()) {
          point = blendPoint(pawTarget({ ...frame, t: WATCH }, paw), point, ease((frame.t - WATCH) / 230));
        }
        paw.x = point.x; paw.y = point.y; paw.press = point.pressing ? 1 : 0; paw.lift = 0;
      }
      const t = demoTime(now);
      P.tailAmp = P.tailAmp ?? (rm ? 0 : 9);
      P.tailSpeed = 0;
      S.tailPhase = t * 0.003 + Math.max(0, Math.min(t, END) - SMUG) * 0.012;
      S.tailAngle = P.tailAmp * Math.sin(S.tailPhase);
    }

    function render(now, dt, rm) {
      const frame = view(now);
      if (run && run.acting && !run.counted && now - run.start >= SHOVE) {
        run.counted = true;
        if (window.SillyStats) window.SillyStats.addPush(); // 小账本：真把杯子推出去了 +1
      }
      const shown = (enabled || demo) && frame.opacity > 0;
      E.mug.style.display = shown ? '' : 'none';
      if (!shown) return;
      const { dir: d, offset: distance, fall } = frame;
      const x = cupX(d, distance);
      const rotation = fall ? 135 * fall / (FALL_END - RELEASE) : frame.wobble;
      // 水平惯性、重力和翻转只影响杯身，影子留在桌沿渐隐。
      E.mug.setAttribute('opacity', frame.opacity.toFixed(3));
      E.mug.setAttribute('transform', `translate(${x} ${MUG.y})`);
      E.shadow.style.display = fall < 180 ? '' : 'none';
      E.shadow.setAttribute('fill-opacity', f1(1 - unit(fall / 180)));
      E.cup.setAttribute('transform', `translate(${f1(d * 0.12 * fall)} ${f1(0.0006 * fall * fall - 0.06 * fall)}) scale(${d} 1) rotate(${f1(rotation)})`);
      const steamOn = distance === 0 && fall === 0;
      E.steam.style.display = steamOn ? '' : 'none';
      if (!steamOn) return;
      const t = demo ? demoTime(now) : now;
      const a = rm ? 0 : 4 * Math.sin(t / 470), b = rm ? 0 : 4 * Math.sin(t / 530 + 1.5);
      E.steamA.setAttribute('d', `M -7 -57 C ${f1(-15 + a)} -65 ${f1(1 + a)} -72 ${f1(-8 + a)} -82`);
      E.steamB.setAttribute('d', `M 7 -57 C ${f1(1 + b)} -66 ${f1(15 + b)} -74 ${f1(8 + b)} -87`);
    }

    return {
      overrideState, afterState, afterKeyDown, forcedPawTarget, pose, render,
      block() { return pinned; },
      setEnabled(v) { enabled = v; },
      setEverySeconds(v) {
        const seconds = interval(v);
        if (seconds === everySec) return;
        everySec = seconds;
        nextPush = Math.max(backAt, newDeadline(performance.now()));
      },
      debugProps: {
        pushPhase: () => view(performance.now()).phase,
        mugOffset: () => view(performance.now()).offset,
        nextPushIn: () => Math.round(Math.max(0, nextPush - performance.now()) / 100) / 10,
      },
    };
  }

  window.SillyPush = { create };
})();
