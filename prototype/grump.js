// 起床气独立于疲劳。只在 onWake 记下唤醒，等睡眠模块的起身和甩头结束才开始计时。
(function () {
  'use strict';

  const MIN_SLEEP = 5000, SHAKE = 420, CALM = 2000;
  const PASSIVE_MS = 60000, PET_RATE = 0.25 / 1000, PET_MOVEMENT_MS = 140;
  const SMILE_AT = 0.3, FRONT = { x: 400, y: 178 };
  const EFFECT_ORIGIN = { x: 548, y: 121 };
  const DEMO_WAKE = 900, DEMO_PET = 2000, DEMO_PET_END = 6160;
  const NS = 'http://www.w3.org/2000/svg';

  function cooled(anger, from, to, pet) {
    const dt = to - from;
    if (!pet) return Math.max(0, anger - dt / PASSIVE_MS);
    const moving = Math.max(0, Math.min(to, pet.movedAt + PET_MOVEMENT_MS) - from);
    return Math.max(0, anger - PET_RATE * (moving + (dt - moving) / 3));
  }

  function create(ctx, opts = {}) {
    const { S, STATES, el, f1 } = ctx;
    const demo = ['grump', 'grump-pet'].includes(opts.demo?.name) ? opts.demo : null;
    const demoPets = demo?.name === 'grump-pet';
    const pinned = demo && Number.isFinite(demo.at);
    let demoStart = performance.now(), demoFrame = null, demoPet = null;
    let enabled = opts.enabled !== false;
    let anger = 0, last = -Infinity, wakeAt = Infinity, calmAt = -Infinity, paused = false;
    const busy = (now) => !!opts.fatigue?.statusInfo().phase ||
      !!(ctx.species?.push?.snatch && opts.isPushing?.(now));
    const strength = () => demoFrame ? demoFrame.anger : anger;
    const canShow = (now) => enabled && !busy(now) && S.state !== STATES.ASLEEP;

    const effect = document.createElementNS(NS, 'g');
    effect.setAttribute('id', 'grump-effect');
    effect.setAttribute('pointer-events', 'none');
    effect.setAttribute('aria-hidden', 'true');
    effect.setAttribute('transform', 'translate(548 121)');
    effect.style.display = 'none';
    effect.innerHTML = `
      <path d="M-14-4 Q-6-6-4-14 M4-14 Q6-6 14-4 M14 4 Q6 6 4 14 M-4 14 Q-6 6-14 4"
        fill="none" stroke="#e5534b" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M0 11 C-30-7-9-21 0-9 C9-21 30-7 0 11 Z"
        fill="#f18c9a" stroke="#a34e59" stroke-width="2"/>`;
    el.head.appendChild(effect);
    const mark = effect.firstElementChild, heart = effect.lastElementChild;

    function onWake(now) {
      if (enabled && !demoFrame && S.state === STATES.ASLEEP && now - S.sleepSince >= MIN_SLEEP) {
        wakeAt = Math.max(now, S.shakeStart) + SHAKE;
      }
    }

    function afterState(now) {
      if (!enabled || demoFrame) return;
      if (busy(now)) {
        paused = true;
        last = now;
        return;
      }
      if (now >= wakeAt) {
        anger = 1;
        last = paused ? now : wakeAt;
        wakeAt = Infinity;
        calmAt = -Infinity;
      } else if (paused) {
        last = now;
      }
      paused = false;
      if (anger <= 0 || now <= last) return;
      anger = cooled(anger, last, now, S.pet);
      last = now;
      if (anger <= 1e-9) { anger = 0; calmAt = now; }
    }

    function refresh(now) {
      if (!demo || !enabled) return;
      const duration = demoPets ? DEMO_PET_END + CALM : 4800;
      const elapsed = now - demoStart;
      const t = pinned ? demo.at : demo.loop ? elapsed % duration : elapsed;
      if (t >= duration) {
        if (demoPet && S.pet === demoPet) S.pet = null;
        demoFrame = demoPet = null;
        return;
      }

      const sleeping = t < DEMO_WAKE;
      const petting = demoPets && t >= DEMO_PET && t < DEMO_PET_END;
      if (petting) {
        demoPet ||= {};
        Object.assign(demoPet, { nx: 0.7 * Math.sin(t / 155), ny: 0.3 * Math.sin(t / 117), movedAt: now });
        S.pet = demoPet;
      } else if (S.pet === demoPet) {
        S.pet = demoPet = null;
      }
      S.state = sleeping ? STATES.ASLEEP : petting ? STATES.PETTED : STATES.AWAKE;
      S.lastInput = sleeping ? now - S.sleepMs : now;
      S.shakeStart = sleeping ? -Infinity : now - (t - DEMO_WAKE);
      const start = DEMO_WAKE + SHAKE;
      const passive = Math.max(0, (demoPets ? Math.min(t, DEMO_PET) : t) - start) / PASSIVE_MS;
      const petCooling = demoPets ? Math.max(0, Math.min(t, DEMO_PET_END) - DEMO_PET) * PET_RATE : 0;
      const calmTime = DEMO_PET + (1 - (DEMO_PET - start) / PASSIVE_MS) / PET_RATE;
      demoFrame = {
        anger: t < start ? 0 : Math.max(0, 1 - passive - petCooling),
        waking: t >= DEMO_WAKE && t < start,
        calmAge: demoPets && t >= calmTime ? t - calmTime : Infinity,
      };
    }

    function calmAge(now) { return demoFrame ? demoFrame.calmAge : now - calmAt; }

    function pose(now, dt, rm, P) {
      if (!canShow(now)) return;
      const value = strength();
      if (value > 0) {
        P.headY += 5 * value;
        P.earDroop += 38 * value;
        P.look = ctx.species?.grump?.look ?? FRONT;
        if (!S.pet || value >= SMILE_AT) {
          P.lidMin = Math.max(P.lidMin, 0.45);
          P.suppressPetSmile = true;
        }
        P.pressBoost += 0.14 * value;
        if (!rm) {
          P.tailAmp = 12 + 24 * value;
          P.tailSpeed = 0.012 + 0.026 * value;
        }
      } else if (calmAge(now) < CALM) {
        P.eyesHappy = true;
      }
    }

    function render(now, dt, rm, P) {
      const value = strength(), calm = calmAge(now);
      const visible = canShow(now) && !P.hideCat;
      const heartOn = visible && calm < 900, markOn = visible && value > 0;
      effect.style.display = markOn || heartOn ? '' : 'none';
      if (!markOn && !heartOn) return;
      mark.style.display = markOn ? '' : 'none';
      heart.style.display = heartOn ? '' : 'none';
      const time = pinned ? demo.at : now;
      const bounce = rm ? 0 : markOn ? Math.sin(time / 125) * 3 : -calm / 35;
      const origin = ctx.species?.grump?.effect ?? EFFECT_ORIGIN;
      effect.setAttribute('transform', `translate(${origin.x} ${f1(origin.y + bounce)})`);
      effect.setAttribute('opacity', f1(heartOn ? 1 - calm / 900 : 1));
    }

    return {
      onWake, refresh, afterState, pose, render,
      active: () => enabled && (strength() > 0 || wakeAt !== Infinity || !!demoFrame?.waking),
      anger: () => enabled && !busy(performance.now()) ? strength() : 0,
      canPurr: () => !enabled || (wakeAt === Infinity && !demoFrame?.waking && strength() < SMILE_AT),
      status(now) {
        if (!canShow(now)) return null;
        const value = strength();
        if (value > 0) return { kind: 'grump', progress: value };
        if (calmAge(now) < CALM) return { kind: 'grumpCalm', progress: 1 };
        return null;
      },
      restartDemo() { demoStart = performance.now(); },
      setEnabled(v) {
        enabled = !!v;
        if (enabled) return;
        if (demoPet && S.pet === demoPet) S.pet = null;
        demoFrame = demoPet = null;
        anger = 0; wakeAt = Infinity; calmAt = -Infinity; paused = false;
      },
      debugProps: { grumpAnger: () => strength() },
    };
  }

  window.SillyGrump = { create };
})();
