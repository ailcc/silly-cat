// 台词表：全部「说的话」集中在这里，猫一套、狗一套，想改哪句直接改这里，
// 不用再去翻各个功能模块。运行时按当前物种自动取词（SillyLines.get('键名')）。
// 说明：
//   · 字符串值 = 单句台词；数组值 = 候选池（随机挑一句）。
//   · 带占位符的台词（{n}、{min}、{keys}…）由各模块填数进去，只改文字部分即可。
//   · 猫的键名和狗的键名必须一一对应，狗的键名缺了会回退到猫的台词。
//   · 纯拟声词（啪、叩、咻、嘭这类音效字）和串门小奶猫自己的叫声不在这里。
(function () {
  'use strict';

  // ---------- 猫的台词 ----------
  const CAT = {
    // 睡梦话（数组随机挑）+ 刚说完被吵醒的一声
    dreams: ['…追到蝴蝶了…', '…好大的鱼干…', '…键盘真香…', '…铲屎的别走…', '…再睡五分钟…', 'zzz…喵…'],
    wake: '喵？',

    // 发呆语录（奶牛猫精神状态）
    quotes: [
      '键盘是我咬的，与我无关',
      '上班？我在上香',
      '这届铲屎的不太行',
      '我在工作，别吵',
      '摸我，立刻，马上',
      '稿子？我吃了',
      '喵生苦短，先睡为敬',
      '工资没有，猫粮管够吗',
      '今天也是不想上班的一天',
      '嘘——我在假装办公',
    ],

    // 小账本吐槽：f = 看哪个数（keys 敲键 / rage 发飙 / push 推杯 / v 好感度），
    // min/max = 数值达到多少才说（max 不含）；{xx} 会被替换成真实数据
    quips: [
      { f: 'keys', min: 100000, text: '账本上记着你敲了 {keys} 下键盘……爪子替你酸' },
      { f: 'keys', min: 20000, text: '这阵子你敲了 {keys} 下键盘，键盘快被你盘出包浆了' },
      { f: 'keys', min: 3000, text: '才这个点就敲了 {keys} 下键盘，你在写什么大作' },
      { f: 'keys', min: 500, text: '本喵已经看着你敲了 {keys} 下键盘，眼都花了' },
      { f: 'rage', min: 1, text: '账本记着你惹我发飙 {rage} 回，一笔都没给你勾掉' },
      { f: 'rage', min: 1, text: '发飙 {rage} 次都是你干的，我全记在小本本上了' },
      { f: 'push', min: 1, text: '我把杯子推出去 {push} 次，你回回都接住了，没意思' },
      { f: 'v', min: 200, text: '好感度都满了还摸，再摸本喵要被你摸化了' },
      { f: 'v', min: 200, text: '账本写着你已是非我不可，本喵勉为其难收下这份心意' },
      { f: 'v', min: 120, max: 200, text: '好感度都 {v} 了，死忠归死忠，小鱼干呢' },
      { f: 'v', min: 60, max: 200, text: '咱俩好感度 {v} 了，多摸摸头还能涨' },
      { f: 'none', text: '账本空空的？那我先帮你记一笔「铲屎的不敬业」' },
    ],

    // 节日应景台词（holidays.js）：每个节日一组候选
    holiday: {
      halloween: ['不给小鱼干就捣蛋！', '今晚我是南瓜猫'],
      christmas: ['喵诞快乐！', '袜子挂在键盘上了'],
      newyear: ['新年快乐！', '新的一年也要多摸鱼'],
      valentine: ['♥', '铲屎的，我的心里只有你'],
      spring: ['新年快乐！红包呢？', '年夜饭有小鱼干吗'],
      national: ['祖国生日快乐！', '红旗飘飘，小鱼干飘香'],
      birthday: ['今天是本喵生日！', '蛋糕呢？要小鱼干味的'],
    },

    // 游戏模式（gamemode.js）：检测到打游戏时先睡一觉、退出后的一声
    gameSleepNamed: '打着游戏呢？我先睡了～',
    gameSleep: '你打游戏，我先睡了～',
    gameDone: '喵！打完啦？',

    // 老板键（bosskey.js）：装睡 / 醒被抓包
    bossSleep: '呼——睡着的猫',
    bossWake: '喵？！',

    // 彩蛋词（easter-words.js）：打出 cat/mao/miao/meow
    easter: '喵！',

    // 扑鼠标（pounce.js）：起跳与扑空
    pounceGo: '扑！',
    pounceMiss: '喵？！扑空了',

    // 番茄钟（pomodoro.js）：{n} 第几个番茄，{min} 休息几分钟
    pomoFocus: '专注开始！第 {n} 个番茄',
    pomoRestLong: '休息 {min} 分钟，辛苦啦喵',
    pomoRest: '休息一下喵，摸摸猫',

    // 激光笔（laser.js）
    laserCaught: '抓住了！',
    laserMiss: '哼，跑了',

    // 逗猫棒（wand.js）
    wandFun: '玩开心了！',

    // 喂零食（snack.js）：{cap} = 每天上限条数
    snackRound: '喂得太好了，圆了…',
    snackCap: '今天 {cap} 条到顶啦',
    snackFull: '吃不下啦',
    snackYum: '香！',

    // 喝水提醒（water.js）
    waterRemind: '该喝水了',
    waterGood: '真乖',

    // 久坐提醒（sitremind.js）
    sitGood: '真乖',
    sitWarn: '起来动动！',
    sitUrgent: '快起来！',

    // 隐私模式（privacymode.js）
    privacy: '我不看不看～',

    // 戳脑门（poke.js） / 拉尾巴（pull-tail.js）
    poke: '哼！',
    pullTail: '嘶！',

    // 疯跑（zoomies.js）
    zoomies: '冲！',

    // 打字节奏（typerhythm.js）：敲累了缓一口 / 敲得飞快
    typeRelax: '呼…',
    typeFast: '好快！',

    // 歪头盯指针（headturn.js）
    stare: '盯——',

    // 好感度满的一次性庆祝（affection.js）
    affectionMaxed: '这下赖上你了',

    // 开饭（meal.js）：{label} = 餐名
    mealTime: '{label}点到啦！',

    // 小奶猫串门（visitor.js）：主宠物说的两句（小奶猫自己的叫声不在这）
    visitorGreet: '喵呜~ 小家伙',
    visitorPurr: '呼噜呼噜…',
  };

  // ---------- 狗的台词（键名和猫一一对应，改文案只动这里） ----------
  const DOG = {
    dreams: ['…追到飞盘了…', '…好大的肉骨头…', '…键盘真香…', '…铲屎的别走…', '…再睡五分钟…', 'zzz…汪…'],
    wake: '汪？',

    quotes: [
      '键盘是我咬的，与我无关',
      '上班？我在上香',
      '这届铲屎的不太行',
      '我在工作，别吵',
      '摸我，立刻，马上',
      '稿子？我吃了',
      '汪生苦短，先睡为敬',
      '工资没有，狗粮管够吗',
      '今天也是不想上班的一天',
      '嘘——我在假装办公',
    ],

    quips: [
      { f: 'keys', min: 100000, text: '账本上记着你敲了 {keys} 下键盘……爪子替你酸' },
      { f: 'keys', min: 20000, text: '这阵子你敲了 {keys} 下键盘，键盘快被你盘出包浆了' },
      { f: 'keys', min: 3000, text: '才这个点就敲了 {keys} 下键盘，你在写什么大作' },
      { f: 'keys', min: 500, text: '本汪已经看着你敲了 {keys} 下键盘，眼都花了' },
      { f: 'rage', min: 1, text: '账本记着你惹我发飙 {rage} 回，一笔都没给你勾掉' },
      { f: 'rage', min: 1, text: '发飙 {rage} 次都是你干的，我全记在小本本上了' },
      { f: 'push', min: 1, text: '我把杯子推出去 {push} 次，你回回都接住了，没意思' },
      { f: 'v', min: 200, text: '好感度都满了还摸，再摸本汪要被你摸化了' },
      { f: 'v', min: 200, text: '账本写着你已是非我不可，本汪勉为其难收下这份心意' },
      { f: 'v', min: 120, max: 200, text: '好感度都 {v} 了，死忠归死忠，肉骨头呢' },
      { f: 'v', min: 60, max: 200, text: '咱俩好感度 {v} 了，多摸摸头还能涨' },
      { f: 'none', text: '账本空空的？那我先帮你记一笔「铲屎的不敬业」' },
    ],

    holiday: {
      halloween: ['不给肉骨头就捣蛋！', '今晚我是南瓜狗'],
      christmas: ['汪诞快乐！', '袜子挂在键盘上了'],
      newyear: ['新年快乐！', '新的一年也要多摸鱼'],
      valentine: ['♥', '铲屎的，我的心里只有你'],
      spring: ['新年快乐！红包呢？', '年夜饭有肉骨头吗'],
      national: ['祖国生日快乐！', '红旗飘飘，肉骨头飘香'],
      birthday: ['今天是本汪生日！', '蛋糕呢？要肉骨头味的'],
    },

    gameSleepNamed: '打着游戏呢？我先睡了～',
    gameSleep: '你打游戏，我先睡了～',
    gameDone: '汪！打完啦？',

    bossSleep: '呼——睡着的狗',
    bossWake: '汪？！',

    easter: '汪！',

    pounceGo: '扑！',
    pounceMiss: '汪？！扑空了',

    pomoFocus: '专注开始！第 {n} 个番茄',
    pomoRestLong: '休息 {min} 分钟，辛苦啦汪',
    pomoRest: '休息一下汪，摸摸狗',

    laserCaught: '抓住了！',
    laserMiss: '哼，跑了',

    wandFun: '玩开心了！',

    snackRound: '喂得太好了，圆了…',
    snackCap: '今天 {cap} 条到顶啦',
    snackFull: '吃不下啦',
    snackYum: '香！',

    waterRemind: '该喝水了',
    waterGood: '真乖',

    sitGood: '真乖',
    sitWarn: '起来动动！',
    sitUrgent: '快起来！',

    privacy: '我不看不看～',

    poke: '哼！',
    pullTail: '嘶！',

    zoomies: '冲！',

    typeRelax: '呼…',
    typeFast: '好快！',

    stare: '盯——',

    affectionMaxed: '这下赖上你了',

    mealTime: '{label}点到啦！',

    visitorGreet: '汪呜~ 小家伙',
    visitorPurr: '呼噜呼噜…',
  };

  window.SillyLines = { cat: CAT, dog: DOG };

  // 按当前物种取词：读 SillySpecies.current.id（狗拿狗的，其它都算猫）；
  // 狗缺某个键时回退猫的台词，保证不空
  window.SillyLines.get = function (key) {
    const id = (window.SillySpecies && window.SillySpecies.current && window.SillySpecies.current.id) || 'cat';
    const bank = this[id] || this.cat;
    const val = bank[key];
    return val !== undefined ? val : this.cat[key];
  };

  // 带占位符的台词：fmt('pomoFocus', { n: 3 }) → 「专注开始！第 3 个番茄」
  window.SillyLines.fmt = function (key, params) {
    const text = String(this.get(key) || '');
    return text.replace(/\{(\w+)\}/g, (_, name) =>
      params && params[name] !== undefined ? String(params[name]) : '');
  };
})();
