// 装饰摆放参数：每个皮肤（毛色）一套独立数据，微调位置改这个文件、保存后刷新页面生效。
//
// 坐标系：800 × 620 的场景坐标，x 向右、y 向下，画面正中 x = 400。
// 各项参数含义：
//   headphone（耳机）    x、y = 头梁锚点位置；scale = 整体缩放（1.35 是猫的基准大小）
//   crown（皇冠）        x、y = 位置；scale = 缩放
//   scarfBand（围巾上半部分，绕脖的带子）x、y = 参考框左上角；w、h = 参考框宽高（U 型路径自动拉伸填满这个框）
//   scarfTail（围巾下摆）x、y = 参考框左上角；w、h = 参考框宽高（垂摆路径自动拉伸填满这个框）
//   bell（铃铛）         x、y = 挂点正中；size = 铃铛半径
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
    },
    dog: {
      headphone: { x: 400, y: 116, scale: 1.134 },
      crown:     { x: 400, y: 94,  scale: 0.9 },
      scarfBand: { x: 298, y: 270, w: 204, h: 64 },
      scarfTail: { x: 406, y: 328, w: 31,  h: 56 },
      bell:      { x: 400, y: 339, size: 10 },
    },
  };

  // ---- 每个皮肤一套（数字来自所属物种的基准，想调谁就改谁）----
  const coats = {
    // 奶牛猫
    cow: {
      headphone: { x: 400, y: 100, scale: 1.35 },
      crown:     { x: 400, y: 58,  scale: 1 },
      scarfBand: { x: 314, y: 285, w: 172, h: 64 },
      scarfTail: { x: 406, y: 330, w: 31,  h: 62 },
      bell:      { x: 400, y: 354, size: 10 },
    },
    // 橘猫
    orange: {
      headphone: { x: 400, y: 100, scale: 1.35 },
      crown:     { x: 400, y: 58,  scale: 1 },
      scarfBand: { x: 314, y: 285, w: 172, h: 64 },
      scarfTail: { x: 406, y: 330, w: 31,  h: 62 },
      bell:      { x: 400, y: 354, size: 10 },
    },
    // 狸花猫
    lihua: {
      headphone: { x: 400, y: 100, scale: 1.35 },
      crown:     { x: 400, y: 58,  scale: 1 },
      scarfBand: { x: 314, y: 285, w: 172, h: 64 },
      scarfTail: { x: 406, y: 330, w: 31,  h: 62 },
      bell:      { x: 400, y: 354, size: 10 },
    },
    // 暹罗猫
    siamese: {
      headphone: { x: 400, y: 100, scale: 1.35 },
      crown:     { x: 400, y: 58,  scale: 1 },
      scarfBand: { x: 314, y: 285, w: 172, h: 64 },
      scarfTail: { x: 406, y: 330, w: 31,  h: 62 },
      bell:      { x: 400, y: 354, size: 10 },
    },
    // 黑猫
    black: {
      headphone: { x: 400, y: 100, scale: 1.35 },
      crown:     { x: 400, y: 58,  scale: 1 },
      scarfBand: { x: 314, y: 285, w: 172, h: 64 },
      scarfTail: { x: 406, y: 330, w: 31,  h: 62 },
      bell:      { x: 400, y: 354, size: 10 },
    },
    // 三花猫
    calico: {
      headphone: { x: 400, y: 100, scale: 1.35 },
      crown:     { x: 400, y: 58,  scale: 1 },
      scarfBand: { x: 314, y: 285, w: 172, h: 64 },
      scarfTail: { x: 406, y: 330, w: 31,  h: 62 },
      bell:      { x: 400, y: 354, size: 10 },
    },
    // 英短蓝猫
    blue: {
      headphone: { x: 400, y: 100, scale: 1.35 },
      crown:     { x: 400, y: 58,  scale: 1 },
      scarfBand: { x: 314, y: 285, w: 172, h: 64 },
      scarfTail: { x: 406, y: 330, w: 31,  h: 62 },
      bell:      { x: 400, y: 354, size: 10 },
    },
    // 异瞳白猫
    white: {
      headphone: { x: 400, y: 100, scale: 1.35 },
      crown:     { x: 400, y: 58,  scale: 1 },
      scarfBand: { x: 314, y: 285, w: 172, h: 64 },
      scarfTail: { x: 406, y: 330, w: 31,  h: 62 },
      bell:      { x: 400, y: 354, size: 10 },
    },
    // 缅因猫
    maine: {
      headphone: { x: 400, y: 100, scale: 1.35 },
      crown:     { x: 400, y: 58,  scale: 1 },
      scarfBand: { x: 314, y: 285, w: 172, h: 64 },
      scarfTail: { x: 406, y: 330, w: 31,  h: 62 },
      bell:      { x: 400, y: 354, size: 10 },
    },
    // 无毛猫
    sphynx: {
      headphone: { x: 400, y: 100, scale: 1.35 },
      crown:     { x: 400, y: 58,  scale: 1 },
      scarfBand: { x: 314, y: 285, w: 172, h: 64 },
      scarfTail: { x: 406, y: 330, w: 31,  h: 62 },
      bell:      { x: 400, y: 354, size: 10 },
    },
    // 大黄（土狗）
    tianyuan: {
      headphone: { x: 400, y: 116, scale: 1.134 },
      crown:     { x: 400, y: 94,  scale: 0.9 },
      scarfBand: { x: 298, y: 270, w: 204, h: 64 },
      scarfTail: { x: 406, y: 328, w: 31,  h: 56 },
      bell:      { x: 400, y: 339, size: 10 },
    },
    // 柯基
    corgi: {
      headphone: { x: 400, y: 116, scale: 1.134 },
      crown:     { x: 400, y: 94,  scale: 0.9 },
      scarfBand: { x: 298, y: 270, w: 204, h: 64 },
      scarfTail: { x: 406, y: 328, w: 31,  h: 56 },
      bell:      { x: 400, y: 339, size: 10 },
    },
    // 边牧
    collie: {
      headphone: { x: 400, y: 116, scale: 1.134 },
      crown:     { x: 400, y: 94,  scale: 0.9 },
      scarfBand: { x: 298, y: 270, w: 204, h: 64 },
      scarfTail: { x: 406, y: 328, w: 31,  h: 56 },
      bell:      { x: 400, y: 339, size: 10 },
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
