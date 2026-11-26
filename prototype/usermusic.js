// 用户听歌模式：Rust 后台每 4 秒扫一遍进程，发现音乐软件在跑就发 silly:user-music，
// 猫戴上耳机陪着用户一起听。耳机一直戴到音乐软件退出——暂停不摘（进程还在）。
// 期间猫一切照常：打字、睡觉、玩彩蛋都正常，耳机只是个挂着的外观；
// 猫睡觉时也戴着（听着主人的歌睡着，合理）。
// 游戏模式优先：游戏耳机带麦克风，游戏进行中这边让路。
// 猫自己的空闲听歌（listenmusic）在用户听歌时不掺和——耳机已经戴着了，不用再演一遍。
// 网页版没有进程检测，这个模块不启用。
(function () {
  'use strict';

  function create(ctx) {
    const T = window.__TAURI__;
    if (!T || !window.SillyGameModeEgg) return {};
    const A = { on: false };

    // 耳机：复用游戏模式模板（去麦克风），和空闲听歌的耳机同款同位
    document.getElementById('cat-head').insertAdjacentHTML('beforeend',
      `<g transform="translate(400 100) scale(1.35) translate(-400 -100)">${
        window.SillyGameModeEgg.headphoneSVG('user-phones', false)}</g>`);
    const phones = document.getElementById('user-phones');
    if (!phones) return {};

    const gaming = () => !!(window.SillyGameMode && window.SillyGameMode.active && window.SillyGameMode.active());
    window.SillyUserMusic = { create, active: () => A.on };

    function pose() {
      phones.style.display = A.on && !gaming() ? '' : 'none';
    }

    // 初始状态问一次（猫启动前音乐软件可能已经在跑了），之后靠事件增量更新
    T.event.listen('silly:user-music', (ev) => { A.on = !!(ev.payload && ev.payload.active); });
    T.core.invoke('user_music_active').then((v) => { A.on = !!v; }).catch(() => {});

    return { pose, debugProps: { userMusic: () => (A.on ? 'on' : 'off') } };
  }

  window.SillyUserMusic = { create };
})();
