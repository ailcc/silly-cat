// 空闲听歌：电脑空闲到原本该睡着的时候掷硬币——一半概率不睡，戴上耳机听歌。
// 一旦开听就一直听，直到用户动键鼠才摘耳机（和睡觉一样持续，踩奶等其它演出都让路，
// 小奶猫串门不受影响）。听着听着睡着是概率事件：每轮听歌四成概率会在 45–105 秒后
// 闭眼睡过去——不点头、不晃、不打拍子、不冒音符，耳机还挂着；没掷中的这轮一直清醒。
// 动键鼠直接清醒摘耳机。
// 后脚跟着打拍子（hindpaws 会来问 bobbing()，睡着就不拍了）。
// 耳机复用游戏模式的画法：去麦克风、整体放大 1.4 倍。
// 游戏模式进行中不掺和（它自己有耳机）。调试：?demo=listen&loop=1 直接进入听歌。
(function () {
  'use strict';

  const NOTE_EVERY = 1600;  // ♪ 冒泡间隔
  const BOB_BEAT = 460;     // 点头节拍（hindpaws 的打拍子也用这个数）
  const DOZE_CHANCE = 0.4;  // 一轮听歌最后睡着的概率
  const DOZE_MIN = 45000;   // 听够这么久才可能睡着
  const DOZE_MAX = 105000;  // 睡着的上限
  const DOZE_DEMO = 8000;   // demo 模式固定 8 秒必睡，方便看效果

  function create(ctx, opts = {}) {
    const { S, STATES } = ctx;
    const demo = opts.demo && opts.demo.name === 'listen' ? opts.demo : null;
    const A = { enabled: true, on: false, decidedFor: -1, nextNote: 0, noteAlt: false, doze: false, willDoze: false, dozeAt: 0 };

    // 耳机：复用游戏模式模板（去麦克风），绕头顶放大 1.35 倍（头梁顶不超出画面）；狗狗按物种缩放
    document.getElementById('cat-head').insertAdjacentHTML('beforeend',
      `<g transform="${window.SillyGameModeEgg.phoneWrap(1.35)}">${
        window.SillyGameModeEgg.headphoneSVG('listen-phones', false)}</g>`);
    const phones = document.getElementById('listen-phones');
    if (!phones) return {}; // 插入失败就整个不启用
    const fitPhones = () => {
      const g = phones.parentElement;
      if (g) g.setAttribute('transform', window.SillyGameModeEgg.phoneWrap(1.35));
    };
    window.addEventListener('silly:species', fitPhones);

    const gaming = () => !!(window.SillyGameMode && window.SillyGameMode.active && window.SillyGameMode.active());
    // 用户自己在听歌（usermusic 模式）时猫已经戴着耳机了，猫自己的空闲听歌不掺和
    const userMusic = () => !!(window.SillyUserMusic && window.SillyUserMusic.active && window.SillyUserMusic.active());
    window.SillyListenMusic = { create, listening: () => A.on, bobbing: () => A.on && !A.doze };

    function pose(now, dt, rm, P) {
      const idleEnough = demo ? true : now - S.lastInput >= S.sleepMs;
      if (A.on && (!A.enabled || !idleEnough || gaming() || userMusic())) { A.on = false; A.doze = false; A.willDoze = false; }
      if (!A.on && A.enabled && !gaming() && !userMusic() && idleEnough && !S.pet) {
        // 每个空闲期只掷一次签（以 lastInput 为期号）；掷中一半概率听歌
        if (demo || A.decidedFor !== S.lastInput) {
          A.decidedFor = S.lastInput;
          if (demo || Math.random() < 0.5) {
            A.on = true;
            window.SillyHeadphoneColor?.onWear?.(); // 随机配色：戴上时才换色，戴着期间不变
            // 这轮听歌只有 DOZE_CHANCE 概率最后听着睡着（demo 必睡，8 秒）；
            // 没掷中的就一直清醒听到有输入
            A.doze = false;
            A.willDoze = demo || Math.random() < DOZE_CHANCE;
            A.dozeAt = now + (demo ? DOZE_DEMO : DOZE_MIN + Math.random() * (DOZE_MAX - DOZE_MIN));
          }
        }
      }
      phones.style.display = A.on ? '' : 'none';
      if (!A.on) return;

      // 这轮掷中了才睡：眼睛闭上，不再点头晃身、不再冒音符，后脚也不打拍子（bobbing=false）
      if (A.willDoze && now >= A.dozeAt) A.doze = true;
      if (A.doze) { P.lidMin = 1; return; }

      // 听歌姿态：跟着节拍点头 + 身子轻晃 + 半眯眼享受 + 尾巴加大摆幅
      const beat = Math.sin((now % BOB_BEAT) / BOB_BEAT * Math.PI * 2);
      P.headY += 3 * beat;
      P.headRot += 2.2 * beat;
      P.bodyRot += 1.5 * Math.sin(now / (BOB_BEAT * 2) * Math.PI * 2);
      P.lidMin = Math.max(P.lidMin, 0.35);
      P.tailAmp = (P.tailAmp ?? 9) + 5;
      P.tailSpeed += 0.008;

      // 头顶两边轮流冒音符
      if (now >= A.nextNote) {
        A.noteAlt = !A.noteAlt;
        ctx.fx.spawn(A.noteAlt ? '♪' : '♫', A.noteAlt ? 502 : 298, 148, '', now);
        A.nextNote = now + NOTE_EVERY;
      }
    }

    // 听歌时不许睡着：把睡眠状态压回清醒（睡着的话呼吸/ZZZ/趴键盘就全来了）
    function overrideState(now) {
      if (A.on && !S.pet) return STATES.AWAKE;
      return null;
    }

    function setEnabled(on) { A.enabled = !!on; if (!on) A.on = false; }

    return {
      pose, overrideState, setEnabled,
      debugProps: { listen: () => (A.on ? 'on' : 'off') },
    };
  }

  window.SillyListenMusic = { create };
})();
