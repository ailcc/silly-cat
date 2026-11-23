// 花纹坐标沿用正面 SVG；同名 CSS 配色由根元素的 data-cat 选择。
(function () {
  'use strict';

  const muzzle = '<path class="coat-light" d="M 400 204 C 380 196 356 213 358 235 Q 360 261 370 282 H 430 Q 440 261 442 235 C 444 213 420 196 400 204 Z"/>';
  const bib = '<ellipse class="coat-light" cx="400" cy="335" rx="44" ry="62"/>';
  const mirrorStripe = (d, width) => `
    <path class="coat-stripe" stroke-width="${width}" d="${d}"/>
    <path class="coat-stripe" stroke-width="${width}" transform="translate(800 0) scale(-1 1)" d="${d}"/>`;
  const cheeks = 'M 300 190 Q 288 191 270 185 M 302 204 Q 289 207 271 209';
  // 一头粗一头尖的实心条纹：粗端在 (x1,y1)、宽 w，经控制点 (cx,cy) 收成尖到 (x2,y2)
  const taper = (x1, y1, cx, cy, x2, y2, w) => {
    const l = Math.hypot(cx - x1, cy - y1) || 1;
    const nx = -(cy - y1) / l * w / 2, ny = (cx - x1) / l * w / 2;
    const n = (v) => Math.round(v * 10) / 10;
    return `M ${n(x1 + nx)} ${n(y1 + ny)} Q ${n(cx + nx / 2)} ${n(cy + ny / 2)} ${x2} ${y2}`
      + ` Q ${n(cx - nx / 2)} ${n(cy - ny / 2)} ${n(x1 - nx)} ${n(y1 - ny)} A ${w / 2} ${w / 2} 0 0 0 ${n(x1 + nx)} ${n(y1 + ny)} Z`;
  };
  const mirrorFill = (d) => `
    <path class="coat-solid-stripe" d="${d}"/>
    <path class="coat-solid-stripe" transform="translate(800 0) scale(-1 1)" d="${d}"/>`;

  const coats = [
    { id: 'cow', name: '奶牛猫' },
    {
      id: 'orange', name: '橘猫',
      head: `
        ${muzzle}
        <path class="coat-solid-stripe" d="M 395.5 78 Q 400 74 404.5 78 Q 405 105 400 128 Q 395 112 395.5 78 Z
          M 367.5 82 Q 371 77 376.5 82 C 376 102 385 112 380 132 C 377 115 366 100 367.5 82 Z
          M 432.5 82 Q 429 77 423.5 82 C 424 102 415 112 420 132 C 423 115 434 100 432.5 82 Z"/>
        ${mirrorStripe('M 324 123 Q 335 112 346 108', 6)}
        ${mirrorStripe(cheeks, 6)}`,
      body: `
        ${bib}
        ${mirrorStripe('M 312 298 Q 328 317 347 320 M 300 337 Q 317 353 339 357 M 290 374 Q 310 389 334 393', 9)}`,
      tail: { rings: [[0.30, 0.38], [0.50, 0.58], [0.70, 0.78]], tip: [0.88, 1] },
    },
    {
      id: 'lihua', name: '狸花猫',
      defs: `<linearGradient id="coat-lihua-ear" x2="0%" y2="100%">
        <stop offset="33%" class="coat-stop-stripe"/>
        <stop offset="33%" class="coat-stop-base"/>
      </linearGradient>`,
      // 狸花：黄褐底、近黑的粗条纹；额头几道往眉心收拢的纹成 M，眼眶一圈浅色、眼角黑线扫向脸颊；
      // 白色只留在嘴和下巴，胸口是稍浅的底色加项圈纹，手臂有横纹（style.css 的 .arm-stripes）
      head: `
        ${muzzle}
        <path class="coat-solid-stripe" d="${taper(400, 60, 400, 98, 400, 124, 12)}"/>
        ${mirrorFill([
          taper(368, 104, 366, 124, 370, 141, 10),
          taper(368, 104, 386, 113, 399, 127, 8),
          taper(362, 68, 364, 88, 368, 106, 10),
          taper(384, 62, 385, 84, 387, 104, 8),
          taper(326, 80, 332, 98, 343, 114, 9),
          taper(266, 168, 290, 172, 311, 181, 9),
          taper(266, 192, 284, 194, 302, 196, 8),
          taper(268, 212, 282, 212, 294, 209, 6),
          taper(268, 140, 280, 141, 292, 138, 7),
        ].join(' '))}`,
      // 眼眶浅圈放进睁眼那组里：闭眼、眯眼笑时跟着眼睛一起隐藏，不会留下两个白圈
      eye: (cx) => `<circle class="coat-rim" cx="${cx}" cy="178" r="34"/>`,
      body: `
        <ellipse class="coat-belly" cx="400" cy="348" rx="52" ry="74"/>
        <path class="coat-stripe" stroke-width="8" d="M 346 290 Q 400 318 454 290 M 338 316 Q 400 348 462 316"/>
        ${mirrorFill([
          taper(296, 290, 312, 296, 330, 300, 10),
          taper(292, 314, 308, 320, 326, 326, 10),
          taper(290, 340, 306, 346, 324, 352, 9),
          taper(290, 366, 306, 372, 322, 378, 9),
        ].join(' '))}`,
      tail: { rings: [[0.23, 0.30], [0.39, 0.46], [0.55, 0.62], [0.71, 0.78]], tip: [0.88, 1] },
    },
    {
      id: 'siamese', name: '暹罗猫',
      defs: `<radialGradient id="coat-siamese-mask">
        <stop offset="38%" class="coat-stop-point"/>
        <stop offset="68%" class="coat-stop-transition"/>
        <stop offset="100%" class="coat-stop-base" stop-opacity="0"/>
      </radialGradient>`,
      head: '<ellipse fill="url(#coat-siamese-mask)" cx="400" cy="200" rx="96" ry="84"/>',
    },
  ];

  const root = document.documentElement;
  let selected = coats[0];
  let initialized = false;

  function apply(id) {
    if (!initialized) {
      const defs = document.querySelector('#scene defs');
      const head = document.getElementById('coat-head-patterns');
      const body = document.getElementById('coat-body-patterns');
      for (const coat of coats) {
        if (coat.defs) defs.insertAdjacentHTML('beforeend', coat.defs);
        if (coat.head) head.insertAdjacentHTML('beforeend', `<g data-coat-pattern="${coat.id}">${coat.head}</g>`);
        if (coat.body) body.insertAdjacentHTML('beforeend', `<g data-coat-pattern="${coat.id}">${coat.body}</g>`);
        if (coat.eye) {
          for (const [side, cx] of [['l', 345], ['r', 455]]) {
            document.getElementById('eye-' + side + '-open')
              .insertAdjacentHTML('afterbegin', `<g data-coat-pattern="${coat.id}">${coat.eye(cx)}</g>`);
          }
        }
      }
      initialized = true;
    }
    const next = coats.find((coat) => coat.id === id) || coats[0];
    if (root.dataset.cat !== next.id) {
      document.getElementById('scene').setAttribute('aria-label', '坐在键盘后面的' + next.name);
      root.dataset.cat = next.id;
    }
    selected = next;
    return selected;
  }

  window.SillyCoats = {
    list: () => coats.map(({ id, name }) => ({ id, name })),
    apply,
    current: () => selected,
  };
})();
