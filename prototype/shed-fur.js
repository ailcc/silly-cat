// 趴睡掉毛：趴在键盘上睡久了，键盘上会留下一撮撮猫毛；醒来后猫身上还粘着几撮，
// 抖一抖、打打字才慢慢掉干净。毛的生成 / 消失都不影响别的系统。
// 调试：?demo=shed&loop=1&at=毫秒（at 之前是掉毛中，之后是醒来粘毛）
(function () {
  'use strict';

  const FUR_EVERY = 3800;      // 趴睡时每隔多久掉一撮
  const MAX_KB = 14, MAX_BODY = 5;
  const STICKY_MS = 22000;     // 醒来后身上粘毛多久才掉光
  const KB_FADE_MS = 20000;    // 醒来后键盘上的毛多久淡掉

  const KB_SPOTS = [ // 身体上会粘毛的地方（身体组内的局部坐标）
    { x: 342, y: 296, r: 15 }, { x: 468, y: 318, r: -10 }, { x: 372, y: 356, r: 40 },
    { x: 436, y: 288, r: 75 }, { x: 396, y: 342, r: -35 },
  ];
  const FUR_D = 'm0 0q2.5 -4 5 0q2.5 4 5 0m1.5 -4.5q2 -3.5 4 0';

  function create(ctx, opts = {}) {
    const { S, STATES, kb, clamp } = ctx;
    const $ = (id) => document.getElementById(id);
    const sleepMod = opts.sleep;
    const demo = opts.demo && opts.demo.name === 'shed' ? opts.demo : null;
    const B = kb.bounds; // 键盘底盘 { x, y, w, h }

    // 键盘上的毛画在键盘组里；身上的毛挂在身体组里跟着身体动
    const kbLayer = $('keyboard'), bodyLayer = $('cat-body');
    const F = { slump: null, nextAdd: 0, stickyUntil: 0, nextAdd2: 0, kb: [], body: [] };

    function furAt() { // 键盘上随机撒，避开正中间猫头趴的位置
      for (let i = 0; i < 12; i++) {
        const x = B.x + 14 + Math.random() * (B.w - 28);
        const y = B.y + 12 + Math.random() * (B.h - 24);
        if (Math.abs(x - 400) > 90 || y > B.y + 60) return { x, y };
      }
      return { x: B.x + 30, y: B.y + B.h - 20 };
    }
    function addKbFur(now) {
      const p = furAt();
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      g.setAttribute('class', 'shed-fur');
      g.setAttribute('d', FUR_D);
      g.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${Math.round(Math.random() * 180)}) scale(${(1.3 + Math.random() * 0.6).toFixed(2)})`);
      kbLayer.appendChild(g);
      F.kb.push({ g, dieAt: 0 });
    }
    function addBodyFur() {
      const used = F.body.map((f) => f.spot);
      const free = KB_SPOTS.filter((s) => !used.includes(s));
      if (!free.length || F.body.length >= MAX_BODY) return;
      const spot = free[Math.floor(Math.random() * free.length)];
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      g.setAttribute('class', 'shed-fur');
      g.setAttribute('d', FUR_D);
      g.setAttribute('transform', `translate(${spot.x} ${spot.y}) rotate(${spot.r}) scale(1.7)`);
      bodyLayer.appendChild(g);
      F.body.push({ g, spot });
    }

    function afterState(now) {
      if (demo && Number.isFinite(demo.at)) {
        // 冻结调试：at 之前是掉毛中（每 400ms 一撮），之后算"醒了"粘一身上；毛都不淡出，方便截图
        const n = Math.min(Math.floor(demo.at / 400), 10);
        while (F.kb.length < n) addKbFur(now);
        if (demo.at >= 4000) while (F.body.length < 4) addBodyFur();
        return;
      }
      if (demo) { // demo：前 4 秒疯狂掉毛，之后算"醒了"粘一身上
        if (now < 4000) {
          if (now >= F.nextAdd && F.kb.length < 10) { addKbFur(now); F.nextAdd = now + 400; }
        } else {
          F.stickyUntil = now + STICKY_MS;
          while (F.body.length < 4) addBodyFur();
          if (!F.kb.some((f) => f.dieAt)) F.kb.forEach((f) => { f.dieAt = now; });
        }
        return;
      }
      const stage = sleepMod && sleepMod.sleepStage ? sleepMod.sleepStage() : null;
      if (stage === 'slumped') { // 趴着睡：定时掉毛
        F.slump = true;
        if (now >= F.nextAdd && F.kb.length < MAX_KB) { addKbFur(now); F.nextAdd = now + FUR_EVERY; }
      } else if (F.slump) {
        // 刚离开趴睡：醒了就把毛粘到身上，键盘上的开始倒计时淡掉
        F.slump = false;
        if (stage === null) {
          F.stickyUntil = now + STICKY_MS;
          const n = Math.min(F.kb.length, 4);
          while (F.body.length < Math.min(n, MAX_BODY)) addBodyFur();
          F.kb.forEach((f) => { if (!f.dieAt) f.dieAt = now + KB_FADE_MS; });
        }
      }
    }

    // 打字时键帽一弹一弹，震掉身上一撮毛
    function afterKeyDown(code, now) {
      if (!F.body.length) return;
      if (Math.random() < 0.4) F.body.pop().g.remove();
    }

    function render(now, dt, rm) {
      for (let i = F.kb.length - 1; i >= 0; i--) {
        const f = F.kb[i];
        if (!f.dieAt) continue;
        const left = f.dieAt - now;
        if (left <= 0) { f.g.remove(); F.kb.splice(i, 1); continue; }
        if (left < 3000) f.g.setAttribute('opacity', (left / 3000).toFixed(2));
      }
      if (F.stickyUntil && now >= F.stickyUntil) {
        F.body.forEach((f) => f.g.remove());
        F.body.length = 0;
        F.stickyUntil = 0;
      }
    }

    if (demo) F.nextAdd = performance.now() + 600;

    return {
      afterState, afterKeyDown, render,
      debugProps: {
        shed: () => F.kb.length + '+' + F.body.length,
      },
    };
  }

  window.SillyShed = { create };
})();
