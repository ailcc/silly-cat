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

  function art(id, opts = {}) {
    const head = { cx: 400, cy: 176, width: 300, ...opts.head };
    return {
      base: `art/${id}/`,
      head,
      backHead: { ...head, ...opts.backHead },
      headPath: opts.headPath,
      imprint: { dx: 0, dy: 0, ...opts.imprint },
      ear: { x: 278, y: 24, width: 110, ...opts.ear },
      body: { cx: 400, y: 246, width: 240 },
      paw: { cx: 0, cy: -2, width: 66, ...opts.paw },
      arm: { width: 54, top: 18, bottom: 12, segments: 8, ...opts.arm },
      tail: { fringe: 6, segments: 16, scale: 1, ...opts.tail },
    };
  }

  const tabby = {
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
    backHead: `
      <path class="coat-solid-stripe" d="${taper(400, 60, 400, 160, 400, 262, 13)}"/>
      ${mirrorFill([
        taper(381, 62, 385, 156, 393, 252, 10),
        taper(361, 68, 369, 150, 386, 242, 10),
        taper(340, 80, 352, 144, 378, 228, 8),
        taper(266, 150, 284, 152, 300, 149, 7),
        taper(264, 178, 290, 181, 314, 180, 9),
        taper(266, 202, 288, 205, 310, 204, 8),
        taper(274, 226, 290, 228, 304, 227, 6),
      ].join(' '))}`,
    backBody: `
      <path class="coat-stripe" stroke-width="12" d="M 400 260 V 406"/>
      ${mirrorFill([276, 298, 320, 342, 364, 386].map((y) => taper(400, y, 356, y + 4, 300, y + 24, 10)).join(' '))}`,
    tail: { rings: [[0.23, 0.30], [0.39, 0.46], [0.55, 0.62], [0.71, 0.78]], tip: [0.88, 1] },
  };

  const coats = [
    { id: 'cow', name: '奶牛猫', art: art('cow') },
    {
      id: 'orange', name: '橘猫', art: art('orange'),
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
      // 罢工背影：后脑勺几道纵纹一路往下、在后颈收拢接上脊线，两侧横纹；背上一条脊线，肋纹从脊线往两侧斜着下去
      backHead: `
        <path class="coat-solid-stripe" d="${taper(400, 62, 400, 160, 400, 256, 13)}"/>
        ${mirrorFill([
          taper(372, 68, 377, 150, 391, 246, 10),
          taper(344, 82, 353, 140, 377, 228, 8),
          taper(266, 188, 290, 191, 314, 189, 8),
          taper(270, 212, 292, 215, 312, 214, 7),
        ].join(' '))}`,
      backBody: `
        <path class="coat-stripe" stroke-width="10" d="M 400 260 V 406"/>
        ${mirrorFill([282, 310, 338, 366].map((y) => taper(400, y, 358, y + 4, 302, y + 26, 11)).join(' '))}`,
      tail: { rings: [[0.30, 0.38], [0.50, 0.58], [0.70, 0.78]], tip: [0.88, 1] },
      shape: { bodySX: 1.24, bodySY: 0.95, headSX: 1.08 }, // 十个橘猫九个胖：身体宽一圈、稍矮，脸也圆一点
    },
    {
      id: 'lihua', name: '狸花猫', art: art('lihua'),
      defs: `<linearGradient id="coat-lihua-ear" x2="0%" y2="100%">
        <stop offset="33%" class="coat-stop-stripe"/>
        <stop offset="33%" class="coat-stop-base"/>
      </linearGradient>`,
      ...tabby,
    },
    {
      id: 'siamese', name: '暹罗猫', art: art('siamese', {
        head: { cx: 400.1, cy: 168.9, width: 241.3 }, backHead: { cx: 400.3, cy: 169, width: 240.5 }, ear: { x: 272, y: 22, width: 110, rotate: 12 },
        arm: { width: 46 }, paw: { width: 58 }, tail: { scale: 0.8 },
        headPath: 'M 518.0 172.0 L 517.8 179.2 L 517.3 185.0 L 516.5 190.4 L 515.4 195.4 L 514.1 200.3 L 512.6 204.9 L 510.8 209.4 L 508.8 213.7 L 506.7 217.9 L 504.3 222.0 L 501.8 225.9 L 499.2 229.7 L 496.3 233.3 L 493.3 236.8 L 490.2 240.2 L 487.0 243.4 L 483.6 246.5 L 480.2 249.4 L 476.6 252.2 L 472.9 254.9 L 469.2 257.4 L 465.4 259.8 L 461.5 262.0 L 457.5 264.0 L 453.4 265.9 L 449.3 267.6 L 445.1 269.2 L 440.8 270.6 L 436.4 271.9 L 432.0 273.0 L 427.4 273.9 L 422.6 274.7 L 417.7 275.2 L 412.5 275.7 L 407.0 275.9 L 400.0 276.0 L 393.0 275.9 L 387.5 275.7 L 382.3 275.2 L 377.4 274.7 L 372.6 273.9 L 368.0 273.0 L 363.6 271.9 L 359.2 270.6 L 354.9 269.2 L 350.7 267.6 L 346.6 265.9 L 342.5 264.0 L 338.5 262.0 L 334.6 259.8 L 330.8 257.4 L 327.1 254.9 L 323.4 252.2 L 319.8 249.4 L 316.4 246.5 L 313.0 243.4 L 309.8 240.2 L 306.7 236.8 L 303.7 233.3 L 300.8 229.7 L 298.2 225.9 L 295.7 222.0 L 293.3 217.9 L 291.2 213.7 L 289.2 209.4 L 287.4 204.9 L 285.9 200.3 L 284.6 195.4 L 283.5 190.4 L 282.7 185.0 L 282.2 179.2 L 282.0 172.0 L 282.1 164.3 L 282.4 158.2 L 282.9 152.6 L 283.5 147.2 L 284.4 142.1 L 285.4 137.2 L 286.7 132.4 L 288.1 127.9 L 289.7 123.4 L 291.5 119.1 L 293.4 115.0 L 295.6 111.0 L 297.9 107.2 L 300.4 103.5 L 303.1 99.9 L 305.9 96.5 L 309.0 93.2 L 312.1 90.1 L 315.5 87.1 L 319.0 84.3 L 322.7 81.7 L 326.5 79.2 L 330.5 76.8 L 334.6 74.7 L 338.9 72.7 L 343.3 70.8 L 347.9 69.2 L 352.6 67.7 L 357.6 66.3 L 362.6 65.2 L 367.9 64.2 L 373.4 63.4 L 379.1 62.8 L 385.2 62.4 L 391.8 62.1 L 400.0 62.0 L 408.2 62.1 L 414.8 62.4 L 420.9 62.8 L 426.6 63.4 L 432.1 64.2 L 437.4 65.2 L 442.4 66.3 L 447.4 67.7 L 452.1 69.2 L 456.7 70.8 L 461.1 72.7 L 465.4 74.7 L 469.5 76.8 L 473.5 79.2 L 477.3 81.7 L 481.0 84.3 L 484.5 87.1 L 487.9 90.1 L 491.0 93.2 L 494.1 96.5 L 496.9 99.9 L 499.6 103.5 L 502.1 107.2 L 504.4 111.0 L 506.6 115.0 L 508.5 119.1 L 510.3 123.4 L 511.9 127.9 L 513.3 132.4 L 514.6 137.2 L 515.6 142.1 L 516.5 147.2 L 517.1 152.6 L 517.6 158.2 L 517.9 164.3 Z',
        imprint: { dx: 36, dy: -14 },
      }),
      defs: `<radialGradient id="coat-siamese-mask">
        <stop offset="38%" class="coat-stop-point"/>
        <stop offset="68%" class="coat-stop-transition"/>
        <stop offset="100%" class="coat-stop-base" stop-opacity="0"/>
      </radialGradient>`,
      head: '<ellipse fill="url(#coat-siamese-mask)" cx="400" cy="200" rx="96" ry="84"/>',
      shape: { bodySX: 0.86, headSX: 1, ear: 1 }, // 身材细长、脸窄一点、耳朵大
    },
    { id: 'black', name: '黑猫', art: art('black') },
    { id: 'calico', name: '三花猫', art: art('calico', {
      head: { cx: 400, cy: 173.1, width: 266 }, backHead: { cx: 400.1, cy: 173.3, width: 264.3 },
    }),
      head: `
        <path class="coat-calico-dark" d="M 250 54 C 299 43 357 42 391 62 C 388 88 394 107 388 134 C 385 156 386 175 374 193 C 360 216 335 220 311 216 C 284 212 263 199 248 181 Z"/>
        <path class="coat-calico-orange" d="M 409 62 C 450 43 512 45 552 58 L 550 187 C 532 205 507 217 482 219 C 458 221 432 209 420 190 C 406 169 414 157 410 135 C 404 107 412 84 409 62 Z"/>`,
      body: `
        <path class="coat-calico-dark" d="M 284 282 C 302 270 332 272 347 290 C 361 307 353 329 340 341 C 327 354 330 376 309 386 C 293 395 281 383 276 367 Z"/>
        <path class="coat-calico-orange" d="M 515 286 C 491 268 465 277 454 300 C 443 324 461 337 464 355 C 468 377 487 395 510 384 C 534 373 532 314 515 286 Z"/>`,
      backHead: `
        <path class="coat-calico-orange" d="M 246 54 C 293 48 351 42 382 64 C 409 88 377 115 385 144 C 391 171 382 196 363 215 C 341 236 308 241 277 231 C 248 221 238 184 246 54 Z"/>
        <path class="coat-calico-dark" d="M 407 60 C 438 44 509 49 554 64 L 557 239 C 528 260 480 259 453 234 C 431 215 440 187 422 165 C 402 141 415 118 410 98 C 407 85 403 72 407 60 Z"/>`,
      backBody: `
        <path class="coat-calico-orange" d="M 290 279 C 316 267 351 270 365 291 C 380 312 368 330 351 343 C 338 353 343 375 324 388 C 303 402 278 386 274 360 Z"/>
        <path class="coat-calico-dark" d="M 520 280 C 492 262 460 268 448 294 C 439 310 450 330 461 344 C 473 359 455 380 476 396 C 494 409 520 397 533 381 Z"/>`,
    },
    { id: 'blue', name: '英短蓝猫', art: art('blue', {
      head: { cx: 399.6, cy: 179.6, width: 291.3 }, backHead: { cx: 399.9, cy: 178.9, width: 293.8 },
      ear: { x: 276.3, y: 62.3, width: 75.5 }, // 小圆耳，分得开、长得低
      arm: { width: 62 }, paw: { width: 72 }, tail: { scale: 1.25 },
      headPath: 'M 534.0 182.0 L 534.0 189.2 L 533.9 195.0 L 533.5 200.4 L 533.0 205.4 L 532.2 210.3 L 531.3 214.9 L 530.1 219.4 L 528.7 223.7 L 527.0 227.9 L 525.2 232.0 L 523.1 235.9 L 520.9 239.7 L 518.4 243.3 L 515.7 246.8 L 512.8 250.2 L 509.6 253.4 L 506.3 256.5 L 502.7 259.4 L 499.0 262.2 L 495.0 264.9 L 490.8 267.4 L 486.4 269.8 L 481.9 272.0 L 477.1 274.0 L 472.1 275.9 L 466.9 277.6 L 461.6 279.2 L 456.0 280.6 L 450.2 281.9 L 444.2 283.0 L 438.0 283.9 L 431.5 284.7 L 424.7 285.2 L 417.5 285.7 L 409.7 285.9 L 400.0 286.0 L 390.3 285.9 L 382.5 285.7 L 375.3 285.2 L 368.5 284.7 L 362.0 283.9 L 355.8 283.0 L 349.8 281.9 L 344.0 280.6 L 338.4 279.2 L 333.1 277.6 L 327.9 275.9 L 322.9 274.0 L 318.1 272.0 L 313.6 269.8 L 309.2 267.4 L 305.0 264.9 L 301.0 262.2 L 297.3 259.4 L 293.7 256.5 L 290.4 253.4 L 287.2 250.2 L 284.3 246.8 L 281.6 243.3 L 279.1 239.7 L 276.9 235.9 L 274.8 232.0 L 273.0 227.9 L 271.3 223.7 L 269.9 219.4 L 268.7 214.9 L 267.8 210.3 L 267.0 205.4 L 266.5 200.4 L 266.1 195.0 L 266.0 189.2 L 266.0 182.0 L 266.1 174.6 L 266.4 168.7 L 267.0 163.3 L 267.7 158.1 L 268.7 153.2 L 269.9 148.4 L 271.3 143.9 L 272.9 139.5 L 274.7 135.2 L 276.8 131.1 L 279.0 127.1 L 281.4 123.2 L 284.1 119.5 L 286.9 116.0 L 290.0 112.5 L 293.2 109.2 L 296.6 106.1 L 300.2 103.1 L 304.0 100.2 L 308.0 97.5 L 312.2 95.0 L 316.5 92.6 L 321.0 90.3 L 325.7 88.2 L 330.6 86.3 L 335.6 84.5 L 340.8 82.9 L 346.2 81.5 L 351.8 80.2 L 357.6 79.1 L 363.6 78.1 L 369.8 77.4 L 376.3 76.8 L 383.2 76.3 L 390.7 76.1 L 400.0 76.0 L 409.3 76.1 L 416.8 76.3 L 423.7 76.8 L 430.2 77.4 L 436.4 78.1 L 442.4 79.1 L 448.2 80.2 L 453.8 81.5 L 459.2 82.9 L 464.4 84.5 L 469.4 86.3 L 474.3 88.2 L 479.0 90.3 L 483.5 92.6 L 487.8 95.0 L 492.0 97.5 L 496.0 100.2 L 499.8 103.1 L 503.4 106.1 L 506.8 109.2 L 510.0 112.5 L 513.1 116.0 L 515.9 119.5 L 518.6 123.2 L 521.0 127.1 L 523.2 131.1 L 525.3 135.2 L 527.1 139.5 L 528.7 143.9 L 530.1 148.4 L 531.3 153.2 L 532.3 158.1 L 533.0 163.3 L 533.6 168.7 L 533.9 174.6 Z',
    }),
      shape: { bodySX: 1.15, bodySY: 0.96, headSX: 1, ear: 1 } }, // 包子脸、敦实
    { id: 'white', name: '异瞳白猫', art: art('white') },
    { id: 'maine', name: '缅因猫', art: art('maine', {
      head: { cx: 400.4, cy: 178.1, width: 322.3 }, backHead: { cx: 400, cy: 177.9, width: 316.5 }, ear: { x: 278, y: 14, width: 110, rotate: 0 },
      arm: { width: 62 }, paw: { width: 74 }, tail: { scale: 1.45 },
      headPath: 'M 262 168 C 262 106, 322 66, 400 66 C 478 66, 538 106, 538 168 C 540 214, 532 248, 506 268 C 478 286, 440 290, 400 290 C 360 290, 322 286, 294 268 C 268 248, 260 214, 262 168 Z',
      imprint: { dx: 6, dy: -4 },
    }),
      ...tabby,
      shape: { bodySX: 1.12, bodySY: 1.03, headSX: 1, ear: 1.15 } },
    { id: 'sphynx', name: '无毛猫', art: art('sphynx', {
      head: { cx: 400.1, cy: 169.1, width: 255.3 }, ear: { x: 268, y: 34, width: 110, rotate: 16 },
      arm: { width: 48 }, paw: { width: 60 }, tail: { scale: 0.6 },
      headPath: 'M 274 158 C 272 102, 328 60, 400 60 C 472 60, 528 102, 526 158 C 525 194, 514 216, 494 230 C 482 238, 474 248, 464 258 C 446 272, 424 278, 400 278 C 376 278, 354 272, 336 258 C 326 248, 318 238, 306 230 C 286 216, 275 194, 274 158 Z',
      imprint: { dx: 30, dy: -16 },
    }),
      shape: { bodySX: 0.96, headSX: 1, ear: 1.18 } },
  ];

  const lineCoats = new Map(coats.map(({ art, ...coat }) => [coat.id, coat]));
  const root = document.documentElement;
  let artStyle = 'fur';
  let selected = coats[0];
  let initialized = false;

  function apply(id) {
    if (!initialized) {
      const defs = document.querySelector('#scene defs');
      const head = document.getElementById('coat-head-patterns');
      const body = document.getElementById('coat-body-patterns');
      const backHead = document.getElementById('coat-back-head-patterns');
      const backBody = document.getElementById('coat-back-body-patterns');
      for (const coat of coats) {
        if (coat.defs) defs.insertAdjacentHTML('beforeend', coat.defs);
        if (coat.head) head.insertAdjacentHTML('beforeend', `<g data-coat-pattern="${coat.id}">${coat.head}</g>`);
        if (coat.body) body.insertAdjacentHTML('beforeend', `<g data-coat-pattern="${coat.id}">${coat.body}</g>`);
        if (coat.backHead) backHead.insertAdjacentHTML('beforeend', `<g data-coat-pattern="${coat.id}">${coat.backHead}</g>`);
        if (coat.backBody) backBody.insertAdjacentHTML('beforeend', `<g data-coat-pattern="${coat.id}">${coat.backBody}</g>`);
        if (coat.eye) {
          for (const [side, cx] of [['l', 345], ['r', 455]]) {
            document.getElementById('eye-' + side + '-open')
              .insertAdjacentHTML('afterbegin', `<g data-coat-pattern="${coat.id}">${coat.eye(cx)}</g>`);
          }
        }
      }
      initialized = true;
    }
    const coat = coats.find((coat) => coat.id === id) || coats[0];
    const next = artStyle === 'line' ? lineCoats.get(coat.id) : coat;
    root.dataset.artStyle = artStyle;
    if (root.dataset.cat !== next.id) {
      document.getElementById('scene').setAttribute('aria-label', '坐在键盘后面的' + next.name);
      root.dataset.cat = next.id;
    }
    SillyArt.apply(next);
    selected = next;
    applyShape(next.shape || {});
    applyStrikeRings(next.tail && next.tail.rings);
    return selected;
  }

  // 体型：身体宽高、头宽由 shapeModule 每帧乘进姿态（肩膀、手臂、尾巴遮罩跟着身体走）；
  // 耳朵和罢工背影的身体、头是静态缩放，切换猫时设一次
  const EAR_PIVOT = { l: '322 110', r: '478 110' };
  function applyShape(shape) {
    const ear = shape.ear || 1;
    for (const side of ['l', 'r']) {
      const [px, py] = EAR_PIVOT[side].split(' ');
      const tf = ear === 1 ? '' : `translate(${px} ${py}) scale(${ear}) translate(${-px} ${-py})`;
      for (const g of document.querySelectorAll('#scene .ear-shape-' + side)) {
        if (tf) g.setAttribute('transform', tf); else g.removeAttribute('transform');
      }
    }
    const sx = shape.bodySX || 1, sy = shape.bodySY || 1;
    const body = document.getElementById('strike-body');
    if (sx === 1 && sy === 1) body.removeAttribute('transform');
    else body.setAttribute('transform', `translate(400 410) scale(${sx} ${sy}) translate(-400 -410)`);
    const hx = shape.headSX || 1, head = document.getElementById('strike-head-shape');
    if (hx === 1) head.removeAttribute('transform');
    else head.setAttribute('transform', `translate(400 0) scale(${hx} 1) translate(-400 0)`);
  }

  // 罢工背影的尾巴是描边画法，环纹用虚线描边：pathLength=100，按 tail.rings（从尾根量起的比例）排出 dash 和 gap
  function applyStrikeRings(rings) {
    const el = document.getElementById('strike-tail-rings');
    if (!rings || !rings.length) { el.style.display = 'none'; return; }
    const parts = [0];
    let at = 0;
    for (const [a, b] of rings) { parts.push((a - at) * 100, (b - a) * 100); at = b; }
    parts.push((1 - at) * 100);
    el.style.display = '';
    el.style.strokeDasharray = parts.map((v) => Math.round(v * 10) / 10).join(' ');
  }

  // createCat 的扩展模块：把当前这只猫的体型乘进每帧姿态
  const shapeModule = () => ({
    pose(now, dt, rm, P) {
      const shape = selected.shape;
      if (!shape) return;
      P.bodySX *= shape.bodySX || 1;
      P.bodySY *= shape.bodySY || 1;
      P.headSX *= shape.headSX || 1;
    },
  });

  window.SillyCoats = {
    list: () => coats.map(({ id, name }) => ({ id, name })),
    apply,
    setArtStyle(style, id = selected.id) {
      artStyle = style === 'line' ? 'line' : 'fur';
      return apply(id);
    },
    current: () => selected,
    shapeModule,
  };
})();
