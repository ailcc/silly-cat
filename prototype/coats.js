// 花纹坐标沿用正面 SVG；同名 CSS 配色由根元素的 data-cat 选择。
(function () {
  'use strict';

  const muzzle = '<path class="coat-light" d="M 400 204 C 380 196 356 213 358 235 Q 360 261 370 282 H 430 Q 440 261 442 235 C 444 213 420 196 400 204 Z"/>';
  const bib = '<ellipse class="coat-light" cx="400" cy="335" rx="44" ry="62"/>';
  const mirrorStripe = (d, width) => `
    <path class="coat-stripe" stroke-width="${width}" d="${d}"/>
    <path class="coat-stripe" stroke-width="${width}" transform="translate(800 0) scale(-1 1)" d="${d}"/>`;
  const cheeks = 'M 300 190 Q 288 191 270 185 M 302 204 Q 289 207 271 209';

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
      head: `
        ${muzzle}
        <path class="coat-stripe" stroke-width="7" d="M 352 128 L 366 96 L 384 122 L 400 92 L 416 122 L 434 96 L 448 128"/>
        <path class="coat-stripe" stroke-width="5" d="M 380 74 Q 380 84 382 94 M 400 72 V 92 M 420 74 Q 420 84 418 94"/>
        ${mirrorStripe('M 316 184 Q 300 183 288 176 ' + cheeks, 5)}`,
      body: `
        ${bib}
        <path class="coat-stripe" stroke-width="6" d="M 368 295 Q 400 314 432 295 M 359 316 Q 400 337 441 316"/>
        ${mirrorStripe('M 325 289 Q 338 305 347 312 M 307 307 Q 316 330 336 343 M 295 334 Q 300 356 324 371 M 291 366 Q 297 385 316 397', 7)}`,
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
