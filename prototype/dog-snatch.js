// 狗叼走的是桌面原有的 SVG 鼠标，叼住后随嘴移动，再藏到身后。
(function () {
  'use strict';

  const DIP = 540, GRIP = 1250, WAG = 1900, TURN = 2500, TUCK = 2640;
  const BACK = 2780, FRONT = 3130, END = 3400;
  const RETURN_RATE = 2;
  const BITE_Y = 244, MOUSE_TOP = 38;
  const lerp = (a, b, t) => a + (b - a) * t;
  const segment = (t, from, to) => {
    const p = Math.max(0, Math.min(1, (t - from) / (to - from)));
    return p * p * (3 - 2 * p);
  };
  const rotate = (x, y, angle) => {
    const r = angle * Math.PI / 180;
    return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
  };

  function deskMouse(t, dir, home) {
    // 狗不伸爪拨弄鼠标（猫才用爪子），鼠标原地不动，狗低头一口叼住
    return { x: home.x, y: home.y };
  }

  function pawTarget(ctx, frame, paw) {
    // 纯嘴叼：不给爪子任何目标，前爪留在键盘上
    return null;
  }

  function sample(t, dir, home) {
    const phase = t < DIP ? 'look' : t < GRIP ? 'dip' : t < WAG ? 'lift'
      : t < TURN ? 'wag' : t < END ? 'turn' : 'gone';
    return { t, dir, home, phase, acting: t < END, held: t >= GRIP && t < BACK, hidden: t >= BACK };
  }

  function returning(age, from, dir, home) {
    if (age < 0) return { phase: 'gone', hidden: true };
    const t = from - age * RETURN_RATE;
    if (t < 0) return { phase: 'idle' };
    return { ...sample(t, dir, home), acting: true, phase: 'return' };
  }

  function create(ctx) {
    const { el, S, headToScene, f1 } = ctx;
    const mouse = el.mouse;
    const scene = document.getElementById('scene');
    const shadow = mouse.querySelector('.shadow');
    const mouseNext = mouse.nextElementSibling;
    el.head.insertAdjacentHTML('afterend', `
      <g id="snatch-back" style="display:none" pointer-events="none">
        <use href="#strike-tail" id="snatch-back-tail"/>
        <use href="#strike-body"/>
        <use href="#strike-head-shape"/>
      </g>`);
    const back = document.getElementById('snatch-back');
    const backTail = document.getElementById('snatch-back-tail');
    let tucked = false, carried = false, rearVisible = false;
    const turnScale = (t) => {
      const width = t < BACK ? 1 - segment(t, TURN, BACK)
        : t < FRONT ? Math.sin(Math.PI * segment(t, BACK, FRONT)) : segment(t, FRONT, END);
      return lerp(0.13, 1, width);
    };

    function pose(frame, P, at) {
      const { t, dir, home } = frame;
      if (frame.hidden) P.mouseHidden = true;
      if (Number.isFinite(at)) P.dogPoseTime = t ?? at;
      if (!frame.acting) return;
      // 不让随机歪头改变嘴和鼠标交接时的锚点。
      S.tiltAngle = 0;

      const dip = segment(t, DIP, GRIP);
      const lift = segment(t, GRIP, WAG);
      const lean = dip * (1 - lift * 0.83);
      const recover = 1 - segment(t, TURN, BACK);
      const focus = segment(t, 0, 260) * (1 - segment(t, GRIP, WAG));
      const peek = 1 - segment(t, DIP, GRIP);
      const mouse = deskMouse(t, dir, home);
      P.look = { x: lerp(400, mouse.x, focus), y: lerp(182, mouse.y, focus) };
      P.headRot += dir * (8 * focus * peek + 20 * lean) * recover;
      P.headX += dir * 13 * focus * peek * recover;

      // 从嘴角的局部坐标反推低头位置，最后一帧正好够到鼠标上端。
      const pivot = ctx.rig.head.pivot;
      const biteAtGrip = rotate(400 + dir * 20 - pivot.x, BITE_Y - pivot.y, dir * 20);
      P.headX += (home.x - pivot.x - biteAtGrip.x) * lean * recover;
      P.headY += ((home.y - MOUSE_TOP - pivot.y - biteAtGrip.y) * lean - 32 * lift) * recover;
      P.bodyX += dir * 57 * lean * recover;
      P.bodyY += 20 * lean * recover;
      P.bodyRot += dir * 23 * lean * recover;
      P.bodySY *= 1 - 0.12 * lean * recover;
      if (lean && recover) {
        const { body, tail } = ctx.rig;
        const vx = tail.pivot.x - body.pivot.x, vy = tail.pivot.y - body.pivot.y;
        const tailRoot = rotate(vx + 52 * lean * recover, vy * P.bodySY, P.bodyRot);
        P.dogTailOffset = { x: P.bodyX + tailRoot.x - vx, y: P.bodyY + tailRoot.y - vy };
      }
      P.dogGrip = frame.held;
      P.eyesHappy = frame.phase !== 'return' && t >= WAG && t < TURN;
      if (t < GRIP && !P.mouseAbs && !P.mouseHidden) P.mouseAbs = mouse;

      const wag = segment(t, GRIP, WAG) * (1 - segment(t, FRONT, END)) * (frame.phase === 'return' ? 0.35 : 1);
      const idle = ctx.rig.tail.wag.awake;
      P.tailAmp = lerp(idle.amp, 22, wag);
      P.tailSpeed = lerp(idle.speed, 0.035, wag);
      if (t >= TURN) P.turnSX = turnScale(t);
      if (t >= BACK && t < FRONT) P.hideCat = true;
    }

    function render(frame, P) {
      const rear = !!(frame?.acting && frame.t >= BACK && frame.t < FRONT);
      if (rear !== rearVisible) {
        rearVisible = rear;
        back.style.display = rear ? '' : 'none';
      }
      if (rear) {
        back.setAttribute('transform', `translate(400 0) scale(${Math.max(0.02, P.turnSX)} 1) translate(-400 0)`);
        backTail.setAttribute('transform', `rotate(${f1(15 * Math.sin(frame.t * 0.034))} 489 376)`);
      }
      const behind = frame?.held && frame.t >= TUCK;
      if (!!behind !== tucked) {
        tucked = !!behind;
        scene.insertBefore(mouse, tucked ? el.body : mouseNext);
      }
      if (!!frame?.held !== carried) {
        carried = !!frame?.held;
        shadow.style.display = carried ? 'none' : '';
      }
      if (!carried) return;

      const { t, dir } = frame;
      const angle = dir * 63 * segment(t, GRIP, WAG);
      const grip = headToScene(400 + dir * 20, BITE_Y);
      const toCenter = rotate(0, MOUSE_TOP, angle);
      const tuck = segment(t, TUCK, BACK);
      const scale = 1 - 0.55 * tuck;
      const center = ctx.rig.turnX;
      const biteX = center + (grip.x - center) * Math.max(0.02, P.turnSX);
      const x = lerp(biteX + toCenter.x, center, tuck);
      const y = lerp(grip.y + toCenter.y, 333, tuck);
      mouse.setAttribute('transform', `translate(${f1(x)} ${f1(y)}) rotate(${f1(angle)}) scale(${scale.toFixed(3)})`);
    }

    return { pose, render };
  }

  window.SillyDogSnatch = { create, sample, returning, pawTarget, GRIP, END, RETURN_DURATION: END / RETURN_RATE };
})();
