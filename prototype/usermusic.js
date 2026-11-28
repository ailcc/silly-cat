// 用户听歌模式：Rust 后台每秒问一次系统「现在有没有音乐软件真的在播放」（只看电平，
// 不录音、不读内容），持续放歌 3 秒猫就戴上耳机陪着；静音或暂停 8 秒才摘下来。
// 2026-11-28 起是音乐软件白名单：只有网易云/QQ音乐/Spotify 等在播放才算，
// 浏览器、IDE 等其它软件出声不算（白名单在 media_mac.rs / media_win.rs）。
// 期间猫一切照常：打字、睡觉、玩彩蛋都正常，耳机只是个挂着的外观；
// 猫睡觉时也戴着（听着主人的歌睡着，合理）。醒着时跟着节拍摇头晃脑
// （点头 + 身子轻晃 + 后脚打拍子），音符从耳机两侧冒：每 2–6 拍一个、
// 偶尔冒一对（像副歌重音）——不匀速狂漂；睡着时不摇也不冒（睡着的
// 语言是 ZZZ）。音符出生点跟着各皮肤的耳机锚点走，猫狗皮肤都适配。
// 游戏模式优先：游戏耳机带麦克风，游戏进行中这边让路。
// 猫自己的空闲听歌（listenmusic）在用户听歌时不掺和——耳机已经戴着了，不用再演一遍。
// 网页版没有音频检测，这个模块不启用。
(function () {
  'use strict';

  function create(ctx) {
    const T = window.__TAURI__;
    if (!T || !window.SillyGameModeEgg) return {};
    const { S, STATES, fx } = ctx;
    const A = { on: false, enabled: true, nextNote: 0, noteAlt: false };
    const BEAT = 460;         // 点头节拍，和空闲听歌一致（hindpaws 打拍子也用这个数）

    // 耳机摆放参数（每皮肤一套：锚点 + 缩放）来自 decor-fit.js；缺席时回退猫基准（1.35 倍）
    const phoneFit = () => {
      const p = (window.SillyDecorFit && window.SillyDecorFit.get && window.SillyDecorFit.get('headphone')) ||
        { x: 400, y: 100, scale: 1.35 };
      return `translate(${p.x} ${p.y}) scale(${p.scale}) translate(-400 -100)`;
    };
    // 耳机：复用游戏模式模板（去麦克风），和空闲听歌的耳机同款同位
    document.getElementById('cat-head').insertAdjacentHTML('beforeend',
      `<g transform="${phoneFit()}">${
        window.SillyGameModeEgg.headphoneSVG('user-phones', false)}</g>`);
    const phones = document.getElementById('user-phones');
    if (!phones) return {};
    const fitPhones = () => {
      const g = phones.parentElement;
      if (g) g.setAttribute('transform', phoneFit());
    };
    window.addEventListener('silly:species', fitPhones);

    const gaming = () => !!(window.SillyGameMode && window.SillyGameMode.active && window.SillyGameMode.active());
    // 醒着且真的在放歌才算「跟着音乐摇摆」：后脚打拍子（hindpaws）和点头共用这个开关
    const bobbing = () => A.on && A.enabled && !gaming() && S.state === STATES.AWAKE;
    window.SillyUserMusic = { create, active: () => A.on, bobbing };

    // 音符出生点：耳机两侧上方（各皮肤锚点/缩放来自 decor-fit，猫基准 1.35 倍时
    // 就是老位置 298/502, y≈148），保证猫狗各皮肤都冒在头旁边而不是固定坐标
    function noteSpot(side) {
      const p = (window.SillyDecorFit && window.SillyDecorFit.get && window.SillyDecorFit.get('headphone')) ||
        { x: 400, y: 100, scale: 1.35 };
      const k = p.scale / 1.35;
      return { x: p.x + side * 102 * k, y: p.y + 48 * k };
    }

    function pose(now, dt, rm, P) {
      const on = A.on && A.enabled && !gaming();
      phones.style.display = on ? '' : 'none';
      if (on) fitPhones(); // 同物种换毛色（切皮肤）也重摆一次耳机
      // 睡着时不摇摆也不冒音符（ZZZ 才是睡着的语言）；中断时清掉计时，恢复后第一帧就接上
      if (!bobbing()) { A.nextNote = 0; return; }

      // 跟着节拍摇头晃脑：点头 + 身子轻晃 + 半眯眼享受 + 尾巴加大摆幅（与空闲听歌同款手感）
      const beat = Math.sin((now % BEAT) / BEAT * Math.PI * 2);
      P.headY += 3 * beat;
      P.headRot += 2.2 * beat;
      P.bodyRot += 1.5 * Math.sin(now / (BEAT * 2) * Math.PI * 2);
      P.lidMin = Math.max(P.lidMin, 0.35);
      P.tailAmp = (P.tailAmp ?? 9) + 5;
      P.tailSpeed += 0.008;

      // 每 2–6 拍冒一个音符，四分之一概率成对冒（像一句重音）
      if (now >= A.nextNote) {
        A.noteAlt = !A.noteAlt;
        const spot = noteSpot(A.noteAlt ? -1 : 1);
        const jitter = (n) => n + Math.random() * 36 - 18;
        fx.spawn(A.noteAlt ? '♪' : '♫', jitter(spot.x), jitter(spot.y), '', now);
        if (Math.random() < 0.25) {
          const other = noteSpot(A.noteAlt ? 1 : -1);
          fx.spawn(A.noteAlt ? '♫' : '♪', jitter(other.x), jitter(other.y), '', now);
        }
        A.nextNote = now + BEAT * (2 + Math.floor(Math.random() * 5));
      }
    }

    // 设置里「电脑出声时戴耳机」的开关：关掉后 Rust 停止采样，耳机也不再冒出来
    function setEnabled(on) {
      A.enabled = !!on;
      if (!A.enabled) A.on = false;
      T.core.invoke('set_user_music_enabled', { enabled: A.enabled }).catch(() => {});
    }

    // 初始状态问一次（猫启动前电脑可能已经在放歌），之后靠事件增量更新；
    // 从「没戴」变「戴上」的那一刻掷随机配色（戴着期间不变）
    T.event.listen('silly:user-music', (ev) => {
      const next = !!(ev.payload && ev.payload.active);
      if (next && !A.on) window.SillyHeadphoneColor?.onWear?.();
      A.on = next;
    });
    T.core.invoke('user_music_active').then((v) => {
      if (v && !A.on) window.SillyHeadphoneColor?.onWear?.();
      A.on = !!v;
    }).catch(() => {});

    return { pose, setEnabled, debugProps: { userMusic: () => (A.on ? 'on' : 'off') } };
  }

  window.SillyUserMusic = { create };
})();
