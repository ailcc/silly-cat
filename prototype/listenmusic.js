// 空闲听歌：电脑空闲到原本该睡着的时候掷硬币——一半概率不睡，戴上耳机听歌。
// 听歌期间不睡觉：头跟着节拍点头、身子轻晃、眯眼享受，头顶时不时冒 ♪ ♫，
// 后脚也跟着打拍子（hindpaws 会来问 listening()）。任何输入就摘耳机恢复清醒，
// 下一次空闲重新掷。耳机复用游戏模式的画法：去麦克风、整体放大 1.4 倍。
// 游戏模式进行中不掺和（它自己有耳机）。调试：?demo=listen&loop=1 直接进入听歌。
(function () {
  'use strict';

  const NOTE_EVERY = 1600; // ♪ 冒泡间隔
  const BOB_BEAT = 460;    // 点头节拍（hindpaws 的打拍子也用这个数）

  function create(ctx, opts = {}) {
    const { S, STATES } = ctx;
    const demo = opts.demo && opts.demo.name === 'listen' ? opts.demo : null;
    const A = { enabled: true, on: false, decidedFor: -1, nextNote: 0, noteAlt: false };

    // 耳机：复用游戏模式模板（去麦克风），绕头顶放大 1.35 倍（头梁顶不超出画面）
    document.getElementById('cat-head').insertAdjacentHTML('beforeend',
      `<g transform="translate(400 100) scale(1.35) translate(-400 -100)">${
        window.SillyGameModeEgg.headphoneSVG('listen-phones', false)}</g>`);
    const phones = document.getElementById('listen-phones');
    if (!phones) return {}; // 插入失败就整个不启用

    const gaming = () => !!(window.SillyGameMode && window.SillyGameMode.active && window.SillyGameMode.active());
    window.SillyListenMusic = { create, listening: () => A.on };

    function pose(now, dt, rm, P) {
      const idleEnough = demo ? true : now - S.lastInput >= S.sleepMs;
      if (A.on && (!A.enabled || !idleEnough || gaming())) { A.on = false; }
      if (!A.on && A.enabled && !gaming() && idleEnough && !S.pet) {
        // 每个空闲期只掷一次签（以 lastInput 为期号）；掷中一半概率听歌
        if (demo || A.decidedFor !== S.lastInput) {
          A.decidedFor = S.lastInput;
          if (demo || Math.random() < 0.5) A.on = true;
        }
      }
      phones.style.display = A.on ? '' : 'none';
      if (!A.on) return;

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
