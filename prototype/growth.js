// 成长等级：跟着好感度解锁装扮。摸头攒好感（affection.js）,
// 攒到 30 解锁小红围巾，攒到 90 解锁小皇冠，戴上就不摘；
// 好感度被清零低于门槛时自动收起来，涨回去再戴。
// 调试：?demo=growth&loop=1 / &at=毫秒（冻结时两件都戴着冒提示）
(function () {
  'use strict';

  const SCARF_AT = 30; // 熟悉了就送围巾
  const CROWN_AT = 90; // 死忠粉才有皇冠

  function create(ctx, opts = {}) {
    const { fx } = ctx;
    const demo = opts.demo && opts.demo.name === 'growth' ? opts.demo : null;
    const G = { scarf: false, crown: false, seen: -1 };

    // 围巾：搭在肩上（挂在 #cat-body 里，跟着身体动）；皇冠：戴头上（挂在 #cat-head 里，跟着头动）
    document.getElementById('cat-body').insertAdjacentHTML('beforeend', `
      <g id="growth-scarf" style="display:none">
        <path class="growth-scarf-band" d="M 322 296 Q 400 274 478 296 Q 486 308 478 318 Q 400 296 322 318 Q 314 308 322 296 Z"/>
        <path class="growth-scarf-tail" d="M 424 314 Q 438 340 430 368 Q 418 376 406 370 Q 418 342 412 320 Z"/>
      </g>`);
    document.getElementById('cat-head').insertAdjacentHTML('beforeend', `
      <g id="growth-crown" style="display:none" transform="translate(400 58)">
        <path class="growth-crown-base" d="M -24 10 L -28 -12 L -13 -2 L 0 -18 L 13 -2 L 28 -12 L 24 10 Z"/>
        <circle class="growth-crown-jewel" cx="0" cy="0" r="3.2"/>
      </g>`);
    const E = { scarf: document.getElementById('growth-scarf'), crown: document.getElementById('growth-crown') };

    function apply(v) {
      const scarf = v >= SCARF_AT, crown = v >= CROWN_AT;
      if (scarf && !G.scarf) fx.spawn('好感度 ' + SCARF_AT + '！解锁小红围巾', 400, 88, 'hot', performance.now());
      if (crown && !G.crown) fx.spawn('好感度 ' + CROWN_AT + '！解锁小皇冠', 400, 88, 'hot', performance.now());
      if ((scarf && !G.scarf) || (crown && !G.crown)) {
        if (window.SillySounds) window.SillySounds.play('meow');
        G.seen = v;
      }
      G.scarf = scarf; G.crown = crown;
      E.scarf.style.display = scarf ? '' : 'none';
      E.crown.style.display = crown ? '' : 'none';
    }

    function pose(now, dt, rm, P) {
      const aff = window.SillyAffection;
      if (demo) {
        if (!G.demoInit) { G.demoInit = true; apply(CROWN_AT); fx.spawn('皇冠 + 围巾都戴上了', 400, 72, '', now); }
        return;
      }
      const v = aff ? aff.get().v : 0;
      // 好感度变化才动 DOM；低于门槛自动收起来
      if (v !== G.seen) { G.seen = v; apply(v); }
    }

    return {
      pose,
      debugProps: { growth: () => '好感 ' + G.seen + ' · 围巾=' + G.scarf + ' 皇冠=' + G.crown },
    };
  }

  window.SillyGrowth = { create };
})();
