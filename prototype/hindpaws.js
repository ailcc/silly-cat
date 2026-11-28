// 露后脚：两只后脚垫在键盘后面、身体两侧正下方，只从键盘下沿露出脚尖，坐姿更完整。
// 设置里有开关（默认开），关掉就是原来的样子。
// 小联动：平时随呼吸轻轻起伏；打字时后脚跟交替点地打拍子；踩奶时和前爪对角同步蹬。
// 后脚走 coat-paw-l / coat-paw-r 配色，10 个品种、毛绒 / 线条画风自动适配。
// 调试：?demo=hindpaws&loop=1 假装打字看点地；踩奶联动用 ?demo=knead&loop=1 看
(function () {
  'use strict';

  function create(ctx, opts = {}) {
    const { S, STATES, clamp } = ctx;
    const demo = opts.demo && opts.demo.name === 'hindpaws' ? opts.demo : null;
    const A = { enabled: true };
    // 后脚在猫局部坐标里的位置：身体两侧正下方，键盘下沿再往下一点——
    // 后脚垫在键盘后面（z 序在键盘之前），只从键盘下沿露出脚尖，不压在键盘上面
    // （上面已经有两只前腿在按键，再叠后脚就挤了）
    const LOCAL = { dx: 82, y: 588 };
    // 大腿根锚点：身体下边缘（y 412 正好是身体轮廓的底部，腿从身体底下长出来，
    // 而不是从肚子上），猫挪动时腿从这里画到脚
    const HIP = { dx: 58, y: 412 };

    // 插到 #cat-body 前面：整组后腿垫在猫身后面——腿根藏在身体轮廓后面，从身体底边缘
    // 「钻出来」，不会压在肚子上；脚掌照旧在键盘下沿露出
    document.getElementById('cat-body').insertAdjacentHTML('beforebegin', `
      <g id="hindpaws" style="display:none">
        <g id="hind-leg-l"><path class="arm-outline" d=""/><path class="arm-fill-l" d=""/><path class="arm-stripes" d=""/></g>
        <g id="hind-leg-r"><path class="arm-outline" d=""/><path class="arm-fill-r" d=""/><path class="arm-stripes" d=""/></g>
        <g id="hind-foot-l"><ellipse class="coat-paw-l ink" rx="18" ry="12"/><path class="toe-l" d="M -6 3 L -6 9 M 6 3 L 6 9"/></g>
        <g id="hind-foot-r"><ellipse class="coat-paw-r ink" rx="18" ry="12"/><path class="toe-r" d="M -6 3 L -6 9 M 6 3 L 6 9"/></g>
      </g>`);
    const el = {
      root: document.getElementById('hindpaws'),
      l: document.getElementById('hind-foot-l'),
      r: document.getElementById('hind-foot-r'),
      legL: document.getElementById('hind-leg-l'),
      legR: document.getElementById('hind-leg-r'),
    };
    if (!el.root || !el.l || !el.r) return {}; // 插入失败就整个不启用，不影响主画面

    const show = (on) => { if (el.root.style.display !== (on ? '' : 'none')) el.root.style.display = on ? '' : 'none'; };

    function pose(now, dt, rm, P) {
      // 猫被藏起来（老板键 / 罢工背影）或趴到键盘上睡时，后脚跟着收起来
      const slumped = window.__cat && window.__cat.sleepStage === 'slumped';
      if (!A.enabled || P.hideCat || slumped) { show(false); return; }
      show(true);

      // 跟身体同变换（顺序和 cat.js 的身体一致：先绕 400,410 缩放、再旋转、最后平移）——
      // 变胖（bodySX）、踩奶趴下（bodyRot）、起身跳跃（lift）后脚都贴着身子走
      const a = P.bodyRot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      const bodyPt = (lx, ly) => {
        const ox = (lx - 400) * P.bodySX, oy = (ly - 410) * P.bodySY;
        return { x: 400 + P.bodyX + ox * ca - oy * sa, y: 410 + P.bodyY + P.lift + ox * sa + oy * ca };
      };
      const fl = bodyPt(400 - LOCAL.dx, LOCAL.y), fr = bodyPt(400 + LOCAL.dx, LOCAL.y);
      const hl = bodyPt(400 - HIP.dx, HIP.y), hr = bodyPt(400 + HIP.dx, HIP.y);

      let dl = 0, dr = 0;
      const kneadT = window.SillyAffection && window.SillyAffection.kneadT ? window.SillyAffection.kneadT(now) : -1;
      if (kneadT >= 0) {
        // 踩奶：和前爪对角同步（前左按下去时后右蹬），同一 500ms 节拍
        const beat = Math.floor(kneadT / 500) % 2 === 0;
        const lDown = beat !== true; // 前左 = beat，后左对角 = 反相
        dl = lDown ? 3 : -2;
        dr = lDown ? -2 : 3;
      } else if ((window.SillyListenMusic && window.SillyListenMusic.bobbing && window.SillyListenMusic.bobbing()) ||
                 (window.SillyUserMusic && window.SillyUserMusic.bobbing && window.SillyUserMusic.bobbing())) {
        // 听歌：跟着点头节拍（两模式都是 460）后脚跟打拍子（听睡着后就不拍了）
        const tap = Math.floor(now / 460) % 2 === 0;
        dl = tap ? 2.5 : -1;
        dr = tap ? -1 : 2.5;
      } else if (demo || now - S.lastInput < 350) {
        // 打字（或演示）：后脚跟左右交替轻轻点地打拍子
        const tap = Math.floor(now / 180) % 2 === 0;
        dl = tap ? 2.5 : -1;
        dr = tap ? -1 : 2.5;
      } else if (!rm) {
        // 平时：随呼吸轻轻起伏
        const bob = Math.sin(now / 900) * 0.8;
        dl = bob; dr = bob;
      }
      dl = clamp(dl, -3, 3); dr = clamp(dr, -3, 3);
      el.l.setAttribute('transform', `translate(${fl.x.toFixed(1)} ${(fl.y + dl).toFixed(1)})`);
      el.r.setAttribute('transform', `translate(${fr.x.toFixed(1)} ${(fr.y + dr).toFixed(1)})`);
      // 后腿：大腿根 → 后脚（外扩一点像腿的自然弧线），猫挪动时腿跟着画
      const legPath = (h, f, dy, side) => {
        const cx = (h.x + f.x) / 2 + (side === 'l' ? -7 : 7);
        const cy = (h.y + f.y) / 2 + 6;
        return `M ${h.x.toFixed(1)} ${h.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${f.x.toFixed(1)} ${(f.y + dy).toFixed(1)}`;
      };
      const dAttr = (g, d) => { for (const p of g.children) p.setAttribute('d', d); };
      dAttr(el.legL, legPath(hl, fl, dl, 'l'));
      dAttr(el.legR, legPath(hr, fr, dr, 'r'));
    }

    function setEnabled(on) { A.enabled = !!on; if (!on) show(false); }

    return {
      pose, setEnabled,
      debugProps: { hindPaws: () => (A.enabled && el.root.style.display !== 'none' ? 'on' : 'off') },
    };
  }

  window.SillyHindPaws = { create };
})();
