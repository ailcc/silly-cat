// 猫的五官和眼睛各自跟随指针；狗用同一套慢响应转动整个头部。
(function () {
  'use strict';

  function direction(point, origin = { x: 400, y: 178 }) {
    const dx = point.x - origin.x, dy = point.y - origin.y;
    const distance = Math.max(160, Math.hypot(dx, dy));
    return { x: dx / distance, y: dy / distance };
  }

  function turn(P, x, y) {
    P.headX += 8 * x;
    P.headY += 4 * y;
    P.headRot += 6 * x;
  }

  function create(ctx) {
    const { S, STATES, el, approach, f1, followsPointer, pointerInScene } = ctx;
    const features = el.head.querySelectorAll('.gaze-features');
    let eyes, x = 0, y = 0, drawn = '';
    return {
      pose(now, dt, rm, P) {
        if (eyes !== ctx.rig?.eyes) {
          eyes = ctx.rig?.eyes;
          x = y = 0;
        }
        if (S.pet || P.look || P.hideCat || P.eyesClosed || P.eyesHappy || P.dogPoseTime != null ||
            (S.state !== STATES.AWAKE && S.state !== STATES.DROWSY)) {
          x = y = 0;
        } else {
          const point = followsPointer(now, P) ? pointerInScene() : null;
          const centers = eyes?.centers;
          const origin = centers && { x: (centers.L.x + centers.R.x) / 2, y: (centers.L.y + centers.R.y) / 2 };
          const target = point ? direction(point, origin) : { x: 0, y: 0 };
          const drowsy = S.state === STATES.DROWSY;
          const amount = drowsy ? 0.5 : 1;
          const tau = drowsy ? 420 : 220;
          x = approach(x, target.x * amount, dt, tau);
          y = approach(y, target.y * amount, dt, tau);
          turn(P, x, y);
        }
        const parallax = eyes?.gaze.pointerParallax !== false;
        const dx = f1(parallax ? 5 * x : 0), dy = f1(parallax ? 5 * y : 0);
        const transform = dx === '0' && dy === '0' ? '' : `translate(${dx} ${dy})`;
        if (transform === drawn) return;
        drawn = transform;
        for (const feature of features) feature.setAttribute('transform', transform);
      },
    };
  }

  window.SillyHeadFollow = { create, direction, turn };
})();
