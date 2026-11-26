// 成长等级：跟着好感度解锁装扮。摸头攒好感（affection.js）,
// 攒到 30 解锁小红围巾，攒到 90 解锁小皇冠，攒到 160 解锁铃铛项圈，戴上就不摘；
// 好感度被清零低于门槛时自动收起来，涨回去再戴。
// 调试：?demo=growth&loop=1 / &at=毫秒（冻结时三件都戴着冒提示）
(function () {
  'use strict';

  const SCARF_AT = 30;  // 熟悉了就送围巾
  const CROWN_AT = 90;  // 死忠粉才有皇冠
  const COLLAR_AT = 160; // 命中注定送铃铛项圈（走路叮当响那种，视觉版）

  function create(ctx, opts = {}) {
    const { fx } = ctx;
    const demo = opts.demo && opts.demo.name === 'growth' ? opts.demo : null;
    const G = { scarf: false, crown: false, collar: false, seen: -1 };

    // 围巾：搭在肩上（挂在 #cat-body 里，跟着身体动）；皇冠：戴头上（挂在 #cat-head 里，跟着头动）
    document.getElementById('cat-body').insertAdjacentHTML('beforeend', `
      <g id="growth-scarf" style="display:none">
        <!-- 垂摆画在带子前面：顶部伸到带子底下，由后画的带子压住接缝，看起来是从带子下垂出来的 -->
        <path id="growth-scarf-tail" class="growth-scarf-tail" d=""/>
        <path id="growth-scarf-band" class="growth-scarf-band" d=""/>
      </g>
      <g id="love-collar" style="display:none">
        <!-- 项圈在围巾带子下面一点，铃铛挂在正中垂下来，盖住围巾垂摆的左边缘 -->
        <path id="love-collar-band" class="love-collar-band" d=""/>
        <circle id="love-collar-bell" class="love-collar-bell" cx="400" r="10"/>
        <path id="love-collar-bell-line" class="love-collar-bell-line" d=""/>
        <circle id="love-collar-dot" class="love-collar-dot" cx="400" r="2.4"/>
      </g>`);
    document.getElementById('cat-head').insertAdjacentHTML('beforeend', `
      <g id="growth-crown" style="display:none" transform="translate(400 58)">
        <path class="growth-crown-base" d="M -24 10 L -28 -12 L -13 -2 L 0 -18 L 13 -2 L 28 -12 L 24 10 Z"/>
        <circle class="growth-crown-jewel" cx="0" cy="0" r="3.2"/>
      </g>`);
    const E = {
      scarf: document.getElementById('growth-scarf'),
      scarfBand: document.getElementById('growth-scarf-band'),
      scarfTail: document.getElementById('growth-scarf-tail'),
      crown: document.getElementById('growth-crown'),
      collar: document.getElementById('love-collar'),
      collarBand: document.getElementById('love-collar-band'),
      bell: document.getElementById('love-collar-bell'),
      bellLine: document.getElementById('love-collar-bell-line'),
      dot: document.getElementById('love-collar-dot'),
    };
    // 装扮的摆放参数按皮肤存放在 decor-fit.js（每个毛色一套 x/y/宽高/缩放），微调改那个文件。
    // 这里只放参考几何：围巾带/垂摆是归一化路径（0,0 起笔），由每皮肤的参考框摆到身上；
    // 项圈粉带不单独开放调整（只在没戴围巾时露出），按物种写死。
    // 铃铛挂点跟着「上面那条带子」走：戴了围巾就挂围巾下（项圈粉带藏起来，免得红粉两条带子叠着），
    // 没戴围巾才挂项圈带下。
    const COLLAR_BAND = {
      cat: 'M 336 326 Q 400 306 464 326 Q 470 338 464 349 Q 400 329 336 349 Q 330 338 336 326 Z',
      dog: 'M 330 344 Q 400 320 470 344 Q 477 356 470 367 Q 400 343 330 367 Q 323 356 330 344 Z',
    };
    const BAND_D = 'M 8 0 Q 102 42 196 0 Q 204 12 196 22 Q 102 64 8 22 Q 0 12 8 0 Z';
    const BAND_BOX = { w: 204, h: 64 };
    const TAIL_D = 'M 18 0 Q 31 30 24 50 Q 12 56 0 50 Q 12 32 6 4 Z';
    const TAIL_BOX = { w: 31, h: 56 };
    const fit = (item) => (window.SillyDecorFit && window.SillyDecorFit.get && window.SillyDecorFit.get(item)) || null;
    // 围巾是否「看得见」：国庆披风会用 visibility 把围巾临时藏起来（holidays.js），那时铃铛挂点也别跟着围巾走
    const scarfVisible = () => G.scarf && E.scarf.style.visibility !== 'hidden';
    let decorKey = '';
    function refreshDecor() {
      const band = fit('scarfBand'), tail = fit('scarfTail'), crown = fit('crown'), bell = fit('bell');
      const sp = window.SillySpecies?.current?.id ?? 'cat';
      if (band) {
        E.scarfBand.setAttribute('d', BAND_D);
        E.scarfBand.setAttribute('transform', `translate(${band.x} ${band.y}) scale(${(band.w / BAND_BOX.w).toFixed(4)} ${(band.h / BAND_BOX.h).toFixed(4)})`);
      }
      if (tail) {
        E.scarfTail.setAttribute('d', TAIL_D);
        E.scarfTail.setAttribute('transform', `translate(${tail.x} ${tail.y}) scale(${(tail.w / TAIL_BOX.w).toFixed(4)} ${(tail.h / TAIL_BOX.h).toFixed(4)})`);
      }
      if (crown) E.crown.setAttribute('transform', `translate(${crown.x} ${crown.y}) scale(${crown.scale})`);
      E.collarBand.setAttribute('d', COLLAR_BAND[sp] ?? COLLAR_BAND.cat);
      // 项圈带子只在没戴围巾时显示；铃铛挂点来自 decor-fit.js
      E.collarBand.style.display = scarfVisible() ? 'none' : '';
      if (bell) {
        E.bell.setAttribute('cx', bell.x);
        E.bell.setAttribute('cy', bell.y);
        E.bell.setAttribute('r', bell.size);
        E.bellLine.setAttribute('d', `M ${bell.x - 8} ${bell.y + 4} Q ${bell.x} ${bell.y + 9} ${bell.x + 8} ${bell.y + 4}`);
        E.dot.setAttribute('cx', bell.x);
        E.dot.setAttribute('cy', bell.y - 4);
      }
    }
    function syncDecor() {
      // 皮肤切换（coats.apply 不发事件，用毛色 id 进 key 轮询去重）也要重摆装饰
      const coatId = window.SillyCoats?.current?.()?.id;
      const key = coatId + '|' + window.SillySpecies?.current?.id + '|' + scarfVisible();
      if (key === decorKey) return;
      decorKey = key;
      refreshDecor();
    }
    refreshDecor();
    window.addEventListener('silly:species', syncDecor);

    function apply(v) {
      const scarf = v >= SCARF_AT, crown = v >= CROWN_AT, collar = v >= COLLAR_AT;
      if (scarf && !G.scarf) fx.spawn('好感度 ' + SCARF_AT + '！解锁小红围巾', 400, 88, 'hot', performance.now());
      if (crown && !G.crown) fx.spawn('好感度 ' + CROWN_AT + '！解锁小皇冠', 400, 88, 'hot', performance.now());
      if (collar && !G.collar) fx.spawn('好感度 ' + COLLAR_AT + '！解锁铃铛项圈', 400, 88, 'hot', performance.now());
      if ((scarf && !G.scarf) || (crown && !G.crown) || (collar && !G.collar)) {
        if (window.SillySounds) window.SillySounds.play('meow');
        G.seen = v;
      }
      G.scarf = scarf; G.crown = crown; G.collar = collar;
      E.scarf.style.display = scarf ? '' : 'none';
      E.crown.style.display = crown ? '' : 'none';
      E.collar.style.display = collar ? '' : 'none';
      syncDecor(); // 围巾戴上/摘下会改项圈带子和铃铛挂点
    }

    function pose(now, dt, rm, P) {
      syncDecor(); // 国庆披风藏围巾（visibility）时也要跟着挪铃铛挂点；内部按 key 去重，开销可忽略
      const aff = window.SillyAffection;
      if (demo) {
        if (!G.demoInit) { G.demoInit = true; apply(COLLAR_AT); fx.spawn('三件装扮都戴上了', 400, 72, '', now); }
        return;
      }
      const v = aff ? aff.get().v : 0;
      // 好感度变化才动 DOM；低于门槛自动收起来
      if (v !== G.seen) { G.seen = v; apply(v); }
    }

    return {
      pose,
      debugProps: { growth: () => '好感 ' + G.seen + ' · 围巾=' + G.scarf + ' 皇冠=' + G.crown + ' 项圈=' + G.collar },
    };
  }

  window.SillyGrowth = { create };
})();
