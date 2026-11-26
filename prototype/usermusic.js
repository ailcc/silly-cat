// 用户听歌模式：Rust 后台每秒问一次系统「现在有没有软件真的在出声」（只看电平，
// 不录音、不读内容），持续出声 3 秒猫就戴上耳机陪着；静音或暂停 8 秒才摘下来。
// 通话、会议、语音软件的声音不算（两端都排除了），所以开语音不会戴耳机。
// 期间猫一切照常：打字、睡觉、玩彩蛋都正常，耳机只是个挂着的外观；
// 猫睡觉时也戴着（听着主人的歌睡着，合理）。
// 游戏模式优先：游戏耳机带麦克风，游戏进行中这边让路。
// 猫自己的空闲听歌（listenmusic）在用户听歌时不掺和——耳机已经戴着了，不用再演一遍。
// 网页版没有音频检测，这个模块不启用。
(function () {
  'use strict';

  function create(ctx) {
    const T = window.__TAURI__;
    if (!T || !window.SillyGameModeEgg) return {};
    const A = { on: false, enabled: true };

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
    window.SillyUserMusic = { create, active: () => A.on };

    function pose() {
      const on = A.on && A.enabled && !gaming();
      phones.style.display = on ? '' : 'none';
      if (on) fitPhones(); // 同物种换毛色（切皮肤）也重摆一次耳机
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
