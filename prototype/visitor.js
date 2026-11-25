// 小奶猫串门：你发呆一阵后（12 秒没键鼠），一只毛色随机的小奶猫从画面左边
// 爬进来，在大猫旁边坐下互相打招呼蹭一蹭，待一会儿再原路爬走。
// 大猫会盯着它看、耳朵放松，还短暂打呼噜。冷却 45–90 分钟，一次一只。
// 调试：?demo=visitor&loop=1（自动演：进 1.2 秒坐 2.5 秒出 1.2 秒）或 &at=毫秒 冻结在打招呼瞬间
(function () {
  'use strict';

  const ENTER = 2600, SIT = 6500, LEAVE = 2600;
  const X_IN = 300, Y = 588;   // 坐下做客的位置（键盘正前方的桌沿，不挡键帽）
  const COAT = [               // 小奶猫毛色：橘 / 灰 / 黑
    { fur: '#e8a25b', line: '#5c3a1e' },
    { fur: '#9aa0a6', line: '#3d4045' },
    { fur: '#3a3a3a', line: '#111' },
  ];

  function create(ctx, opts = {}) {
    const { S, STATES, fx, clamp } = ctx;
    const demo = opts.demo && opts.demo.name === 'visitor' ? opts.demo : null;
    const V = { phase: null, start: -1e9, next: 20e3, greet2: -1e9, coat: 0, purrTimer: null };

    const rand = (a, b) => a + Math.random() * (b - a);
    const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));

    document.getElementById('fx-layer').insertAdjacentHTML('beforebegin', `
      <g id="visitor-layer" style="display:none">
        <ellipse class="visitor-shadow" cx="0" cy="22" rx="40" ry="7"/>
        <path id="visitor-tail" class="visitor-tail" d=""/>
        <path id="visitor-body" class="visitor-body" d="M -34 16 Q -36 -8 -16 -14 Q 0 -19 16 -14 Q 36 -8 34 16 Z"/>
        <g id="visitor-head">
          <path class="visitor-ear" d="M -20 -18 L -16 -34 L -4 -24 Z"/>
          <path class="visitor-ear" d="M 20 -18 L 16 -34 L 4 -24 Z"/>
          <circle class="visitor-head" cx="0" cy="-10" r="23"/>
          <path id="visitor-eye-l" class="visitor-eye" d="M -14 -12 Q -10 -8 -6 -12"/>
          <path id="visitor-eye-r" class="visitor-eye" d="M 6 -12 Q 10 -8 14 -12"/>
        </g>
      </g>`);
    const E = {
      layer: document.getElementById('visitor-layer'),
      tail: document.getElementById('visitor-tail'),
      head: document.getElementById('visitor-head'),
      body: document.getElementById('visitor-body'),
      eyeL: document.getElementById('visitor-eye-l'),
      eyeR: document.getElementById('visitor-eye-r'),
      shadow: E_shadow(),
    };
    function E_shadow() { return document.querySelector('#visitor-layer .visitor-shadow'); }

    function coatEls() {
      const els = [E.head.querySelector('.visitor-head'), ...E.head.querySelectorAll('.visitor-ear'), E.body];
      els.forEach((el) => { el.style.fill = COAT[V.coat].fur; el.style.stroke = COAT[V.coat].line; });
    }

    function startVisit(now) {
      V.phase = 'enter'; V.start = now;
      V.coat = Math.floor(Math.random() * COAT.length);
      coatEls();
      E.layer.style.display = '';
      V.greet2 = -1e9;
    }
    function endVisit(now) {
      V.phase = null;
      E.layer.style.display = 'none';
      V.next = now + rand(45, 90) * 60000;
      if (V.purrTimer) { clearTimeout(V.purrTimer); V.purrTimer = null; }
      if (window.SillySounds) window.SillySounds.stopPurr();
    }

    function afterState(now) {
      if (demo || V.phase) return;
      if (S.state !== STATES.AWAKE || S.pet) return;
      if (now < V.next) return;
      const idle = (now - (S.lastKeyAt || 0) > 12000) && (now - (S.lastInputAt || 0) > 12000);
      if (idle) startVisit(now);
    }

    function pose(now, dt, rm, P) {
      if (demo) {
        if (Number.isFinite(demo.at)) {
          if (!V.frozenInit) { V.frozenInit = true; V.phase = 'sit'; V.start = now - ENTER - 600; V.coat = 0; coatEls(); E.layer.style.display = ''; }
        } else {
          if (!V.phase && now >= (V.demoNext || 0)) startVisit(now);
        }
      }
      if (!V.phase) return;
      const t = now - V.start;

      // 各阶段：走进来 → 坐下打招呼 → 爬走
      if (t < ENTER) {
        V.mode = 'walk'; V.x = -70 + (X_IN + 70) * ease(t / ENTER); V.flip = false;
      } else if (t < ENTER + SIT) {
        if (V.phase === 'enter') { // 刚坐下：互相打招呼
          V.phase = 'sit';
          fx.spawn('喵呜~ 小家伙', 430, 240, '', now);
          V.greet2 = now + 700;
          if (window.SillySounds) { window.SillySounds.startPurr(); V.purrTimer = setTimeout(() => window.SillySounds.stopPurr(), 1800); }
        }
        if (V.greet2 > 0 && now >= V.greet2) { fx.spawn('喵！', X_IN, Y - 50, '', now); V.greet2 = -1e9; }
        V.mode = 'sit'; V.x = X_IN; V.flip = false;
      } else if (t < ENTER + SIT + LEAVE) {
        if (V.phase !== 'leave') V.phase = 'leave';
        V.mode = 'walk'; V.x = X_IN - (X_IN + 70) * ease((t - ENTER - SIT) / LEAVE); V.flip = true;
      } else {
        endVisit(now);
        return;
      }

      // 走路上下颠、坐着尾巴摇、开心眯眼
      const bob = V.mode === 'walk' ? Math.abs(Math.sin(t / 110)) * 2.4 : 0;
      const wag = V.mode === 'sit' ? Math.sin(now / 180) * 16 : Math.sin(now / 90) * 6;
      E.body.setAttribute('transform', `translate(${V.x.toFixed(1)} ${(Y + bob).toFixed(1)})${V.flip ? ' scale(-1 1)' : ''}`);
      E.head.setAttribute('transform', `translate(${V.x.toFixed(1)} ${(Y + bob + (V.mode === 'sit' ? Math.sin(now / 400) * 1.5 : 0)).toFixed(1)})${V.flip ? ' scale(-1 1)' : ''}`);
      // 影子始终垫在脚下
      E.shadow.setAttribute('cx', V.x.toFixed(1));
      E.shadow.setAttribute('cy', (Y + bob + 20).toFixed(1));
      // 尾巴在身后：脸朝右（走进来）时尾巴拖在左边，脸朝左（爬走）时拖在右边
      const rearX = V.flip ? V.x + 30 : V.x - 30;
      const dir = V.flip ? 1 : -1;
      E.tail.setAttribute('d', `M ${rearX.toFixed(1)} ${(Y + bob - 4).toFixed(1)} Q ${(rearX + dir * 24).toFixed(1)} ${(Y + bob - 12 - wag * 0.6).toFixed(1)} ${(rearX + dir * 18).toFixed(1)} ${(Y + bob - 28 - wag).toFixed(1)}`);
      const happy = V.mode === 'sit';
      E.eyeL.style.display = E.eyeR.style.display = happy ? '' : 'none';

      // 大猫的反应：盯着小家伙看，耳朵放松；做客期间算「有事发生」别让它睡着
      P.look = { x: V.x, y: Y - 30 };
      P.earDroop -= 3;
      S.lastInput = now;
    }

    return {
      afterState, pose,
      debugProps: { visitor: () => (V.phase ? V.phase + '@' + Math.round(V.x) : null) },
    };
  }

  window.SillyVisitor = { create };
})();
