// 游戏模式（默认开启，没有开关）：Rust 侧每 2 秒看一眼前台窗口，发现全屏游戏就发
// 「silly:game-mode」事件——猫自动戴上耳机打盹，替你守着键盘；游戏退到后台（约 8 秒
// Alt-Tab 宽限）就伸懒腰醒来。
// 期间所有输入都被拦下（block 钩子）：猫爪不敲键、不出打字音、不会被吵醒；串门、
// 数据吐槽、推杯子这些「醒着才会干的事」也全部歇了。状态强制成睡着：入睡的姿态、
// 呼噜、ZZZ、流口水全是现成的睡眠系统，不会不伦不类。
// 网页版没有检测能力；演示用 ?demo=game&loop=1（每 6 秒切换）或 &at=毫秒 冻结戴耳机睡着
(function () {
  'use strict';

  // 耳机模板抽成共享构造器：听歌模式复用同款画法（可去掉麦克风、外面套 scale 放大）。
  // 猫的耳朵长在头顶两侧（耳根 y≈110），耳罩要罩在耳朵上，不是人耳的位置——整体比人类戴法高一截。
  // 颜色由外层（#scene 的 data-hp-color）给的 CSS 变量决定，见 style.css 的耳机配色表。
  const headphoneSVG = (id, withMic = true) => `
      <g id="${id}" style="display:none">
        <path class="gp-band-outline" d="M 303 86 C 310 24, 490 24, 497 86"/>
        <path class="gp-band" d="M 303 86 C 310 24, 490 24, 497 86"/>
        <path class="gp-band-in" d="M 311 90 C 319 40, 481 40, 489 90"/>
        <rect class="gp-cup" x="284" y="70" width="36" height="52" rx="15"/>
        <rect class="gp-cup-ring" x="291" y="79" width="22" height="34" rx="10"/>
        <rect class="gp-cup" x="480" y="70" width="36" height="52" rx="15"/>
        <rect class="gp-cup-ring" x="487" y="79" width="22" height="34" rx="10"/>
        ${withMic ? '<rect class="gp-mic" x="318" y="122" width="26" height="9" rx="4.5" transform="rotate(24 318 122)"/>' : ''}
      </g>`;

  function create(ctx, opts = {}) {
    const { S, STATES, fx } = ctx;
    const demo = opts.demo && opts.demo.name === 'game' ? opts.demo : null;
    const G = { on: false, name: null, nextAuto: 0 };

    // 给 visitor / quip 等模块查询「现在是不是在打游戏」
    window.SillyGameMode = { active: () => G.on, name: () => G.name };

    // 耳机画在头组里（跟着头的姿态 / 球面转头一起动）：头梁弧 + 两侧耳罩
    document.getElementById('cat-head').insertAdjacentHTML('beforeend',
      `<g transform="${phoneWrap(1)}">${headphoneSVG('game-phones')}</g>`);
    const phones = document.getElementById('game-phones');
    if (phones) window.addEventListener('silly:species', () => phones.parentElement?.setAttribute('transform', phoneWrap(1)));

    function announce(now) {
      if (G.on) fx.spawn(G.name ? `打着游戏呢？我先睡了～` : '你打游戏，我先睡了～', 400, 92, '', now);
      else { fx.spawn('喵！打完啦？', 400, 92, '', now); if (window.SillySounds) window.SillySounds.play('meow'); }
    }

    // 桌面版：监听 Rust 的检测结果（网页版没有 __TAURI__，用 demo 演出）
    const T = window.__TAURI__;
    if (T && T.event && !demo) {
      T.event.listen('silly:game-mode', (ev) => {
        const active = !!(ev.payload && ev.payload.active);
        if (active === G.on) return;
        G.on = active;
        G.name = (ev.payload && ev.payload.name) || null;
        announce(performance.now());
      });
    }
    if (demo) {
      G.on = true;
      G.name = '演示游戏';
      if (demo.loop) G.nextAuto = performance.now() + 6000;
    }

    // 游戏进行中强制睡着：真实睡眠系统接管（坐着睡 -> 打盹呼吸 -> 流口水 -> 趴到键盘上）
    function overrideState(now) {
      if (demo && demo.loop && now >= G.nextAuto) {
        G.on = !G.on;
        G.nextAuto = now + 6000;
        announce(now);
      }
      return G.on ? STATES.ASLEEP : null;
    }

    // 拦输入：松键放行（不然长按中的键把猫爪钉在键帽上），其他全拦——
    // 打字的爪子、点鼠标的尾巴、发飙的疲劳都不会被打游戏的人惊动
    function block(kind) {
      return G.on && kind !== 'keyUp';
    }

    function pose() {
      phones.style.display = G.on ? '' : 'none';
    }

    return {
      overrideState, block, pose,
      debugProps: { gameMode: () => (G.on ? (G.name || 'on') : null) },
    };
  }

  // 耳机整体套一层 transform 挂在头组里。狗头比猫头窄一圈、还往下挪了 12，所以狗要缩一点、压下来一点。
  const phoneWrap = (scale) => {
    const dog = window.SillySpecies?.current?.scene?.template === 'parts-dog';
    const k = dog ? 0.84 : 1, dy = dog ? 16 : 0;
    return `translate(400 ${100 + dy}) scale(${(scale * k).toFixed(3)}) translate(-400 -100)`;
  };

  window.SillyGameModeEgg = { create, headphoneSVG, phoneWrap };
})();
