// 装饰摆放参数：每个皮肤（毛色）一套独立数据，微调位置改这个文件、保存后刷新页面生效。
//
// 坐标系：800 × 620 的场景坐标，x 向右、y 向下，画面正中 x = 400。
// 各项参数含义：
//   headphone（耳机）    x、y = 头梁锚点位置；scale = 整体缩放（1.35 是猫的基准大小）
//   crown（皇冠）        x、y = 位置；scale = 缩放
//   scarfBand（围巾上半部分，绕脖的带子）x、y = 参考框左上角；w、h = 参考框宽高（U 型路径自动拉伸填满这个框）
//   scarfTail（围巾下摆）x、y = 参考框左上角；w、h = 参考框宽高（垂摆路径自动拉伸填满这个框）
//   bell（铃铛）         x、y = 挂点正中；size = 铃铛半径
// 节日装扮（ holidays 的五件，都是「参考框」：x、y = 框左上角，w、h = 拉伸到的宽高）：
//   holidayHat     圣诞帽（跟头动）     猫的原始框：308,34 171×76
//   holidayBdayhat 生日尖角帽（跟头动） 猫的原始框：330,2  116×106
//   holidayCapeBand 披风肩带（U 型，同围巾带画法）猫基准：314,282 176×56
//   holidayCapeDrapeL/DrapeR 披风左/右下摆（各自独立参数）猫基准：318/412,300 36×100
//   holidayPumpkin 万圣节南瓜灯（桌上摆的场景物件）x、y = 中心，scale = 缩放；默认 742,452
// 想看原始框在哪：?demo=christmas 等直接看对应装扮；把 w/h 设回猫的原始框就是原样。
//
// 用法：想微调哪个皮肤，直接改它对应的数字即可；改动只影响那一个皮肤。
// 新增皮肤没写在这里时，回退到 species 里对应物种的默认值。
// 调整技巧：浏览器里 ?cat=皮肤id 看效果；y 越大越靠下，x 越大越靠右；
// w/h 是「拉伸到这个宽高」，不是位移——只想整体挪位置就只动 x/y。
(function () {
  'use strict';

  const species = {
    cat: {
      headphone: { x: 400, y: 100, scale: 1.35 },
      crown:     { x: 400, y: 58,  scale: 1 },
      scarfBand: { x: 314, y: 285, w: 172, h: 64 },
      scarfTail: { x: 406, y: 330, w: 31,  h: 62 },
      bell:      { x: 400, y: 354, size: 10 },
      // 节日装扮：猫的这些值就是各路径的原始绘制框（不变形不改位），想调再改
      holidayHat:     { x: 308, y: 34,  w: 171, h: 76 },
      holidayBdayhat: { x: 330, y: 2,   w: 116, h: 106 },
      holidayCapeBand:  { x: 314, y: 282, w: 176, h: 56 },  // 披风肩带（U 型，同围巾带画法）
      holidayCapeDrapeL:{ x: 318, y: 300, w: 36,  h: 100 }, // 披风左下摆
      holidayCapeDrapeR:{ x: 412, y: 300, w: 36,  h: 100 }, // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
    dog: {
      headphone: { x: 400, y: 116, scale: 1.134 },
      crown:     { x: 400, y: 94,  scale: 0.9 },
      scarfBand: { x: 298, y: 270, w: 204, h: 64 },
      scarfTail: { x: 406, y: 328, w: 31,  h: 56 },
      bell:      { x: 400, y: 339, size: 10 },
      // 节日装扮按狗的头身给的初值（狗头更宽更靠下、胸口更宽），不满意直接改数字微调
      holidayHat:     { x: 292, y: 40,  w: 216, h: 84 },  // 帽檐下沿 ≈ 124，压在狗头顶
      holidayBdayhat: { x: 310, y: 10,  w: 180, h: 120 },
      holidayCapeBand:  { x: 298, y: 276, w: 204, h: 58 },  // 披风肩带（U 型）
      holidayCapeDrapeL:{ x: 296, y: 304, w: 44,  h: 98 },  // 披风左下摆
      holidayCapeDrapeR:{ x: 460, y: 304, w: 44,  h: 98 },  // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
  };

  // ---- 每个皮肤一套（数字来自所属物种的基准，想调谁就改谁）----
  const coats = {
    // 奶牛猫
    cow: {
      headphone: { x: 400, y: 75, scale: 1 },
      crown:     { x: 400, y: 50,  scale: 1 },
      scarfBand: { x: 324, y: 275, w: 152, h: 64 },
      scarfTail: { x: 406, y: 315, w: 31,  h: 62 },
      bell:      { x: 400, y: 330, size: 10 },
      // 节日装扮（参考框 x/y/w/h；南瓜灯是 x/y 中心 + scale）
      holidayHat:     { x: 330, y: 14,  w: 171, h: 76 },
      holidayBdayhat: { x: 330, y: 2,   w: 116, h: 106 },
      holidayCapeBand:  { x: 314, y: 272, w: 156, h: 56 },  // 披风肩带（U 型，同围巾带画法）
      holidayCapeDrapeL:{ x: 318, y: 300, w: 36,  h: 100 }, // 披风左下摆
      holidayCapeDrapeR:{ x: 412, y: 300, w: 36,  h: 100 }, // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
    // 橘猫
    orange: {
      headphone: { x: 400, y: 75, scale: 1 },
      crown:     { x: 400, y: 50,  scale: 1 },
      scarfBand: { x: 324, y: 270, w: 142, h: 64 },
      scarfTail: { x: 406, y: 305, w: 31,  h: 62 },
      bell:      { x: 400, y: 325, size: 10 },
      // 节日装扮（参考框 x/y/w/h；南瓜灯是 x/y 中心 + scale）
      holidayHat:     { x: 330, y: 30,  w: 171, h: 76 },
      holidayBdayhat: { x: 330, y: 2,   w: 116, h: 106 },
      holidayCapeBand:  { x: 320, y: 272, w: 146, h: 56 },  // 披风肩带（U 型，同围巾带画法）
      holidayCapeDrapeL:{ x: 318, y: 300, w: 36,  h: 100 }, // 披风左下摆
      holidayCapeDrapeR:{ x: 412, y: 300, w: 36,  h: 100 }, // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
    // 狸花猫
    lihua: {
      headphone: { x: 400, y: 75, scale: 1 },
      crown:     { x: 400, y: 50,  scale: 1 },
      scarfBand: { x: 314, y: 270, w: 165, h: 64 },
      scarfTail: { x: 406, y: 310, w: 31,  h: 62 },
      bell:      { x: 400, y: 325, size: 10 },
      // 节日装扮（参考框 x/y/w/h；南瓜灯是 x/y 中心 + scale）
      holidayHat:     { x: 328, y: 14,  w: 171, h: 76 },
      holidayBdayhat: { x: 340, y: -12,   w: 116, h: 106 },
      holidayCapeBand:  { x: 320, y: 282, w: 156, h: 56 },  // 披风肩带（U 型，同围巾带画法）
      holidayCapeDrapeL:{ x: 318, y: 300, w: 36,  h: 100 }, // 披风左下摆
      holidayCapeDrapeR:{ x: 412, y: 300, w: 36,  h: 100 }, // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
    // 暹罗猫
    siamese: {
      headphone: { x: 400, y: 85, scale: 1.1 },
      crown:     { x: 400, y: 58,  scale: 1 },
      scarfBand: { x: 334, y: 255, w: 132, h: 64 },
      scarfTail: { x: 406, y: 290, w: 31,  h: 62 },
      bell:      { x: 400, y: 307, size: 10 },
      // 节日装扮（参考框 x/y/w/h；南瓜灯是 x/y 中心 + scale）
      holidayHat:     { x: 332, y: 14,  w: 171, h: 76 },
      holidayBdayhat: { x: 330, y: 2,   w: 116, h: 106 },
      holidayCapeBand:  { x: 320, y: 260, w: 146, h: 56 },  // 披风肩带（U 型，同围巾带画法）
      holidayCapeDrapeL:{ x: 318, y: 275, w: 36,  h: 100 }, // 披风左下摆
      holidayCapeDrapeR:{ x: 412, y: 275, w: 36,  h: 100 }, // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
    // 黑猫
    black: {
      headphone: { x: 400, y: 75, scale: 1 },
      crown:     { x: 400, y: 50,  scale: 1 },
      scarfBand: { x: 324, y: 265, w: 152, h: 64 },
      scarfTail: { x: 406, y: 300, w: 31,  h: 62 },
      bell:      { x: 400, y: 318, size: 10 },
      // 节日装扮（参考框 x/y/w/h；南瓜灯是 x/y 中心 + scale）
      holidayHat:     { x: 332, y: 14,  w: 171, h: 76 },
      holidayBdayhat: { x: 330, y: 2,   w: 116, h: 106 },
      holidayCapeBand:  { x: 314, y: 275, w: 156, h: 56 },  // 披风肩带（U 型，同围巾带画法）
      holidayCapeDrapeL:{ x: 318, y: 300, w: 36,  h: 100 }, // 披风左下摆
      holidayCapeDrapeR:{ x: 412, y: 300, w: 36,  h: 100 }, // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
    // 三花猫
    calico: {
      headphone: { x: 400, y: 75, scale: 1 },
      crown:     { x: 400, y: 60,  scale: 1 },
      scarfBand: { x: 337, y: 250, w: 132, h: 64 },
      scarfTail: { x: 406, y: 285, w: 31,  h: 62 },
      bell:      { x: 400, y: 302, size: 10 },
      // 节日装扮（参考框 x/y/w/h；南瓜灯是 x/y 中心 + scale）
      holidayHat:     { x: 332, y: 14,  w: 171, h: 76 },
      holidayBdayhat: { x: 330, y: 2,   w: 116, h: 106 },
      holidayCapeBand:  { x: 334, y: 260, w: 136, h: 56 },  // 披风肩带（U 型，同围巾带画法）
      holidayCapeDrapeL:{ x: 338, y: 280, w: 36,  h: 100 }, // 披风左下摆
      holidayCapeDrapeR:{ x: 412, y: 280, w: 36,  h: 100 }, // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
    // 英短蓝猫
    blue: {
      headphone: { x: 400, y: 75, scale: 1 },
      crown:     { x: 400, y: 64,  scale: 1 },
      scarfBand: { x: 330, y: 255, w: 125, h: 64 },
      scarfTail: { x: 406, y: 290, w: 31,  h: 62 },
      bell:      { x: 400, y: 308, size: 10 },
      // 节日装扮（参考框 x/y/w/h；南瓜灯是 x/y 中心 + scale）
      holidayHat:     { x: 332, y: 14,  w: 171, h: 76 },
      holidayBdayhat: { x: 330, y: 2,   w: 116, h: 106 },
      holidayCapeBand:  { x: 334, y: 262, w: 130, h: 56 },  // 披风肩带（U 型，同围巾带画法）
      holidayCapeDrapeL:{ x: 338, y: 280, w: 36,  h: 100 }, // 披风左下摆
      holidayCapeDrapeR:{ x: 412, y: 280, w: 36,  h: 100 }, // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
    // 异瞳白猫
    white: {
      headphone: { x: 400, y: 75, scale: 1 },
      crown:     { x: 400, y: 50,  scale: 1 },
      scarfBand: { x: 324, y: 270, w: 152, h: 64 },
      scarfTail: { x: 406, y: 308, w: 31,  h: 62 },
      bell:      { x: 400, y: 320, size: 10 },
      // 节日装扮（参考框 x/y/w/h；南瓜灯是 x/y 中心 + scale）
      holidayHat:     { x: 332, y: 14,  w: 171, h: 76 },
      holidayBdayhat: { x: 330, y: 2,   w: 116, h: 106 },
      holidayCapeBand:  { x: 334, y: 275, w: 146, h: 56 },  // 披风肩带（U 型，同围巾带画法）
      holidayCapeDrapeL:{ x: 338, y: 300, w: 36,  h: 100 }, // 披风左下摆
      holidayCapeDrapeR:{ x: 432, y: 300, w: 36,  h: 100 }, // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
    // 缅因猫
    maine: {
      headphone: { x: 400, y: 75, scale: 1 },
      crown:     { x: 400, y: 58,  scale: 1 },
      scarfBand: { x: 324, y: 270, w: 152, h: 64 },
      scarfTail: { x: 416, y: 305, w: 31,  h: 62 },
      bell:      { x: 400, y: 324, size: 10 },
      // 节日装扮（参考框 x/y/w/h；南瓜灯是 x/y 中心 + scale）
      holidayHat:     { x: 332, y: 14,  w: 171, h: 76 },
      holidayBdayhat: { x: 330, y: 2,   w: 116, h: 106 },
      holidayCapeBand:  { x: 330, y: 272, w: 146, h: 56 },  // 披风肩带（U 型，同围巾带画法）
      holidayCapeDrapeL:{ x: 328, y: 300, w: 36,  h: 100 }, // 披风左下摆
      holidayCapeDrapeR:{ x: 412, y: 300, w: 36,  h: 100 }, // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
    // 无毛猫
    sphynx: {
      headphone: { x: 400, y: 100, scale: 1.4 },
      crown:     { x: 400, y: 55,  scale: 1 },
      scarfBand: { x: 334, y: 245, w: 122, h: 64 },
      scarfTail: { x: 416, y: 280, w: 31,  h: 62 },
      bell:      { x: 400, y: 297, size: 10 },
      // 节日装扮（参考框 x/y/w/h；南瓜灯是 x/y 中心 + scale）
      holidayHat:     { x: 332, y: 14,  w: 171, h: 76 },
      holidayBdayhat: { x: 330, y: 2,   w: 116, h: 106 },
      holidayCapeBand:  { x: 334, y: 262, w: 130, h: 56 },  // 披风肩带（U 型，同围巾带画法）
      holidayCapeDrapeL:{ x: 338, y: 290, w: 36,  h: 100 }, // 披风左下摆
      holidayCapeDrapeR:{ x: 412, y: 290, w: 36,  h: 100 }, // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
    // 大黄（土狗）
    tianyuan: {
      headphone: { x: 400, y: 90, scale: 0.8 },
      crown:     { x: 400, y: 87,  scale: 0.9 },
      scarfBand: { x: 302, y: 260, w: 195, h: 64 },
      scarfTail: { x: 420, y: 295, w: 31,  h: 56 },
      bell:      { x: 400, y: 315, size: 10 },
      // 节日装扮按狗头身的初值，微调直接改数字
      holidayHat:     { x: 352, y: 20,  w: 121, h: 76 },    // 圣诞帽
      holidayBdayhat: { x: 350, y: 10,  w: 100, h: 120 },   // 生日帽
      holidayCapeBand:  { x: 302, y: 266, w: 195, h: 58 },  // 披风肩带（U 型）
      holidayCapeDrapeL:{ x: 350, y: 300, w: 44,  h: 98 },  // 披风左下摆
      holidayCapeDrapeR:{ x: 400, y: 300, w: 44,  h: 98 },  // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
    // 柯基
    corgi: {
      headphone: { x: 400, y: 90, scale: 0.9 },
      crown:     { x: 400, y: 94,  scale: 0.9 },
      scarfBand: { x: 302, y: 260, w: 195, h: 64 },
      scarfTail: { x: 420, y: 295, w: 31,  h: 56 },
      bell:      { x: 400, y: 315, size: 10 },
      // 节日装扮按狗头身的初值，微调直接改数字
      holidayHat:     { x: 352, y: 20,  w: 121, h: 76 },    // 圣诞帽
      holidayBdayhat: { x: 330, y: 10,  w: 120, h: 120 },   // 生日帽
      holidayCapeBand:  { x: 298, y: 276, w: 204, h: 58 },  // 披风肩带（U 型）
      holidayCapeDrapeL:{ x: 350, y: 300, w: 44,  h: 98 },  // 披风左下摆
      holidayCapeDrapeR:{ x: 400, y: 300, w: 44,  h: 98 },  // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
    // 边牧
    collie: {
      headphone: { x: 400, y: 100, scale: 1 },
      crown:     { x: 400, y: 94,  scale: 0.9 },
      scarfBand: { x: 302, y: 260, w: 195, h: 64 },
      scarfTail: { x: 420, y: 295, w: 31,  h: 56 },
      bell:      { x: 400, y: 315, size: 10 },
      // 节日装扮按狗头身的初值，微调直接改数字
      holidayHat:     { x: 352, y: 22,  w: 121, h: 76 },    // 圣诞帽
      holidayBdayhat: { x: 340, y: 10,  w: 120, h: 120 },   // 生日帽
      holidayCapeBand:  { x: 302, y: 266, w: 195, h: 58 },  // 披风肩带（U 型）
      holidayCapeDrapeL:{ x: 350, y: 300, w: 44,  h: 98 },  // 披风左下摆
      holidayCapeDrapeR:{ x: 400, y: 300, w: 44,  h: 98 },  // 披风右下摆
      holidayPumpkin: { x: 742, y: 452, scale: 1 },
    },
  };

  window.SillyDecorFit = {
    species,
    coats,
    // 取当前「皮肤 × 物种」下某件装饰的参数：皮肤写了就整条用皮肤的，没写回退物种默认
    get(item) {
      const sp = (window.SillySpecies?.current?.id) || 'cat';
      const coatId = window.SillyCoats?.current?.()?.id;
      const over = (coatId && coats[coatId]) || {};
      return over[item] || (species[sp] && species[sp][item]) || null;
    },
  };
})();
