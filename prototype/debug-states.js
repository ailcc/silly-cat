// 调试状态表：网页版调试面板（debug-panel.js）和桌面版设置窗口的调试栏（settings.js）共用。
// 每项：[组名, [[按钮文字, demo 参数], ...]]（demo 名与各模块的 ?demo= 调试钩子一致；
// 支持 & 附加参数，如 'knead&at=800'、'listen&doze=1'）。
(function () {
  'use strict';
  window.SillyDebugStates = [
    ['睡眠与听歌', [
      ['趴着睡觉', 'slumped'],
      ['趴下入睡', 'slump-in'],
      ['说梦话', 'slumped'], // 真睡着才说梦话（和趴睡同一状态，梦里 0.8 秒后开始冒梦话）
      ['流口水', 'drool'],
      ['刚醒压痕', 'wake-marks'],
      ['听歌戴耳机', 'listen'], // 听 8 秒后自动睡着
      ['听歌睡着', 'listen&doze=1'], // 戴着耳机直接睡着（&doze=1 跳过 8 秒等待）
      ['踩奶', 'knead&at=800'], // knead 演示必须带 at 才会进入踩奶冻结帧
    ]],
    ['情绪与疲劳', [
      ['起床气', 'rage'],
      ['罢工', 'strike'],
      ['修复中', 'repair'],
      ['叹气', 'sigh'],
    ]],
    ['鼠标演出', [
      ['摸头开心', 'pet'],
      ['爪子按鼠标', 'paw-mouse'],
      ['尾巴按鼠标', 'tail-mouse'],
      ['歪头看指针', 'tilt'],
    ]],
    ['互动与彩蛋', [
      ['打字飞快', 'fasttype'],
      ['拍指针', 'swat'],
      ['戳一戳', 'poke'],
      ['拉尾巴', 'pull'],
      ['尾巴拍键盘', 'tailslap'],
      ['推杯子', 'push'],
      ['杯子推回来', 'push-back'],
      ['毛线球', 'wand'],
      ['激光笔', 'laser'],
      ['键盘彩蛋', 'keyeggs'],
      ['键盘流水', 'kbdflow'],
      ['转头看', 'headturn'],
      ['后脚打拍', 'hindpaws'],
      ['彩蛋词', 'catword'],
      ['语录', 'quote'],
    ]],
    ['饮食与提醒', [
      ['喝咖啡', 'coffee'],
      ['咖啡心虚', 'coffee-scare'],
      ['零食', 'snack'],
      ['喝水', 'water'],
      ['番茄钟', 'pomo'],
      ['久坐提醒', 'sit'],
    ]],
    ['其他', [
      ['游戏模式', 'game'],
      ['老板键', 'boss'],
      ['隐私模式', 'privacy'],
      ['掉毛', 'shed'],
      ['访客', 'visitor'],
      ['装扮全戴', 'growth'],
    ]],
  ];
})();
