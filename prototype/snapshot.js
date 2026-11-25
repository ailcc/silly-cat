// 截猫：快速连按两下 P（350ms 内，中间没混别的键），把猫此刻的样子连键盘
// 一起截成透明底 PNG：优先写进剪贴板（网页版直接粘贴发群），写不进去就落成
// sillycat.png 下载。摆什么姿势截什么——先让它做个表情再按。
// 调试：?demo=snapshot&loop=1（冒提示气泡）
(function () {
  'use strict';

  const GAP = 350, COOLDOWN = 3000;

  function create(ctx, opts = {}) {
    const { fx } = ctx;
    const demo = opts.demo && opts.demo.name === 'snapshot' ? opts.demo : null;
    const S2 = { lastP: -1, otherKey: false, until: -1e9 };

    function fail(msg) {
      fx.spawn(msg || '截猫失败了', 400, 84, 'angry', performance.now());
    }

    // 把场景 SVG 连同外部 CSS 的计算样式一起内联，再画到画布上导 PNG
    function capture() {
      const svg = document.getElementById('scene');
      const clone = svg.cloneNode(true);
      const src = svg.querySelectorAll('*'), dst = clone.querySelectorAll('*');
      const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
        'opacity', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor', 'display', 'visibility'];
      for (let i = 0; i < src.length; i++) {
        const cs = getComputedStyle(src[i]);
        for (const p of PROPS) {
          const v = cs.getPropertyValue(p);
          if (v) dst[i].style.setProperty(p, v);
        }
      }
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = 800; cv.height = 620;
        cv.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        cv.toBlob(async (blob) => {
          if (!blob) return fail();
          try {
            if (typeof ClipboardItem === 'undefined') throw new Error('no ClipboardItem');
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            fx.spawn('表情包已复制！', 400, 84, 'hot', performance.now());
          } catch {
            const a = document.createElement('a');
            a.download = 'sillycat.png';
            a.href = URL.createObjectURL(blob);
            a.click();
            URL.revokeObjectURL(a.href);
            fx.spawn('表情包已保存！', 400, 84, 'hot', performance.now());
          }
        }, 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); fail(); };
      img.src = url;
    }

    function afterKeyDown(code, now) {
      if (demo) return;
      if (code !== 'KeyP') { if (S2.lastP > 0) S2.otherKey = true; return; }
      // 双击 P：两下之间没混别的键，且过了冷却（防止打「pp」误触）
      if (S2.lastP > 0 && !S2.otherKey && now - S2.lastP <= GAP && now - S2.lastP > 25 && now >= S2.until) {
        S2.lastP = -1; S2.otherKey = false;
        S2.until = now + COOLDOWN;
        capture();
      } else {
        S2.lastP = now; S2.otherKey = false;
      }
    }

    function pose(now) {
      if (demo && !Number.isFinite(demo.at) && now >= (S2.next || 0)) {
        fx.spawn('连按两下 P 截猫！', 400, 84, 'hot', now);
        S2.next = now + 3500;
      }
    }

    return {
      afterKeyDown, pose,
      debugProps: { snapshot: () => (performance.now() < S2.until ? '刚截过' : null) },
    };
  }

  window.SillySnapshot = { create };
})();
