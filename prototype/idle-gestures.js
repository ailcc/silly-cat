// 闲置小动作：醒着又没人理的时候，猫会随机伸个懒腰、打个哈欠，或者舔爪子洗把脸。
// 纯姿态表演：pose 里叠加 P 字段，伸懒腰 / 舔爪用 softPawTarget 摆爪子；一有输入就立刻收住。
// 调试：?demo=stretch|yawn|groom&loop=1&at=毫秒
(function () {
  'use strict';

  const DUR = { stretch: 1500, yawn: 1700, groom: 2800 }; // 每个小动作的时长（毫秒）
  const IDLE_MIN = 5000;        // 至少闲了这么久才开始表演
  const EVERY = [9000, 22000];  // 两场表演之间隔多久（随机）
  const DEMOS = Object.keys(DUR);

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const rand = (a, b) => a + Math.random() * (b - a);

  function create(ctx, opts = {}) {
    const { S, STATES, clamp } = ctx;
    const $ = (id) => document.getElementById(id);
    const demo = opts.demo && DEMOS.includes(opts.demo.name) ? opts.demo : null;
    // 狗不舔爪子洗脸（那是猫的仪式感），只能伸懒腰和打哈欠；demo 参数照常可单独看某个动作
    const dog = () => ctx.species.id === 'dog';
    const pool = () => (dog() ? DEMOS.filter((name) => name !== 'groom') : DEMOS);

    // 嘴上的小道具：挂在头部组里跟着头一起动。哈欠张大嘴，舔毛吐舌头。
    $('cat-head').insertAdjacentHTML('beforeend', `
      <g id="ig-mouth" style="display:none">
        <ellipse id="ig-yawn-hole" class="ig-yawn-hole" cx="400" cy="236" rx="12" ry="0"/>
        <path id="ig-tongue" class="ig-tongue" style="display:none" d="M 393 233 Q 400 252 407 233 Z"/>
      </g>`);
    const E = { mouth: $('ig-mouth'), hole: $('ig-yawn-hole'), tongue: $('ig-tongue') };

    const G = { next: performance.now() + (demo ? 800 : 2500), act: null };
    const pick = () => (demo ? demo.name : pool()[Math.floor(Math.random() * pool().length)]);
    const schedule = (now, gap) => { G.next = now + (gap ?? rand(EVERY[0], EVERY[1])); };

    function hideMouth() {
      E.mouth.style.display = 'none';
      E.tongue.style.display = 'none';
    }
    function cancel(now) {
      if (!G.act) return;
      G.act = null;
      hideMouth();
      schedule(now);
    }

    // ---------- 爪子：伸懒腰时两只前爪往前伸到键盘下缘；舔爪洗脸时左爪去嘴边和两颊 ----------
    function softPawTarget(paw, now) {
      if (!G.act) return null;
      const t = now - G.act.start;
      if (G.act.name === 'stretch') {
        if (t < 180 || t > 1150) return null;
        const c = ctx.kb.center(paw.side === 'L' ? 'KeyV' : 'KeyN');
        return c ? { id: 'ig-stretch', x: c.x, y: c.y - 10, tau: 130 } : null;
      }
      if (G.act.name !== 'groom' || paw.side !== 'L') return null;
      if (t < 950) { // 舔爪：爪子抵在嘴边，吐舌头
        const m = ctx.headToScene(400, 246);
        return { id: 'ig-groom', x: m.x, y: m.y, tau: 26, pressing: t > 380 };
      }
      // 洗脸：左右脸颊来回抹
      const k = Math.floor((t - 950) / 460);
      const c = ctx.headToScene(k % 2 ? 326 : 474, k % 2 ? 246 : 240);
      return { id: 'ig-groom', x: c.x, y: c.y, tau: 30, pressing: true };
    }

    // ---------- 姿态 ----------
    function pose(now, dt, rm, P) {
      if (rm) { cancel(now); return; }
      const awake = S.state === STATES.AWAKE && !S.pet && !S.excited;
      const busy = !demo && (now - S.lastInput < 900 || S.tailReach > 0.05); // 刚打完字 / 尾巴还在操作鼠标就别表演
      if (demo) S.lastInput = now; // demo 期间一直醒着，别走到犯困去
      if (demo && G.act && Number.isFinite(demo.at)) G.act.start = now - demo.at; // 冻结在时间轴上

      if (G.act && (!awake || busy)) { cancel(now); return; }
      if (!G.act) {
        // demo 模式不等闲置计时，到点就演
        if (awake && !busy && now >= G.next && (demo || now - S.lastInput >= IDLE_MIN)) {
          G.act = { name: pick(), start: now };
        }
        return;
      }
      const t = now - G.act.start, d = DUR[G.act.name];
      if (t >= d) { G.act = null; hideMouth(); schedule(now, demo ? 1300 : undefined); return; }

      if (G.act.name === 'stretch') {
        // 伸懒腰：头往前下探向键盘，身子拉长、屁股微微抬起，前爪往前滑
        const env = Math.sin(Math.PI * clamp(t / d, 0, 1));
        P.headY += 24 * env;
        P.headRot += 9 * env;
        P.bodyY -= 5 * env;
        P.bodySY = 1 + 0.035 * env;
        P.eyesClosed = true;
        P.tailAmp = 18; P.tailSpeed = 0.012;
      } else if (G.act.name === 'yawn') {
        // 打哈欠：头往后仰，嘴越张越大再合上
        const env = Math.sin(Math.PI * clamp(t / d, 0, 1));
        P.headY -= 9 * env;
        P.headRot -= 7 * env;
        P.bodySY = 1 + 0.02 * env;
        P.eyesClosed = env > 0.1;
        const open = Math.sin(Math.PI * clamp((t - 150) / (d - 350), 0, 1));
        E.mouth.style.display = '';
        E.hole.setAttribute('ry', (14 * open).toFixed(2));
        E.hole.setAttribute('rx', (12 - 2.5 * open).toFixed(2));
      } else { // groom
        // 舔爪洗脸：舔的时候闭眼吐舌头，洗脸时眯成开心的弧线，头往爪子那边偏一点
        const env = Math.sin(Math.PI * clamp(t / d, 0, 1));
        P.headRot += 4 * env;
        const licking = t < 950;
        P.eyesClosed = licking;
        P.eyesHappy = !licking;
        E.mouth.style.display = '';
        E.hole.setAttribute('ry', '0');
        E.tongue.style.display = licking ? '' : 'none';
        if (licking) E.tongue.setAttribute('transform', `rotate(${(4 * Math.sin(now / 80)).toFixed(1)} 400 236)`);
      }
    }

    // ---------- 一有按键立刻收住（别演到一半还愣着） ----------
    function afterKeyDown(code, now) { cancel(now); }

    return {
      pose, softPawTarget, afterKeyDown,
      debugProps: { gesture: () => (G.act ? G.act.name : null) },
    };
  }

  window.SillyIdleGestures = { create };
})();
