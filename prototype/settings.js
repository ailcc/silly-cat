// 时间参数的字段表、默认值和校验。桌面版的主窗口（index.html）和设置窗口（settings.html）共用；
// 网页版也会加载本文件，但不调用任何东西，没有副作用。
// 一律按秒（和 cat.js / sleep.js / fatigue.js 的现有接口一致），界面上也都用秒。
(function () {
  'use strict';

  // drool / slump 为 null 表示「自动」：沿用 sleep.js 的原逻辑（入睡时间 × 2、× 3.5）
  const DEFAULTS = Object.freeze({ sleep: 20, drool: null, slump: null, work: 90, rest: 20 });
  const AUTO = Object.freeze({ drool: 2, slump: 3.5 });

  // min / max 都是秒
  const FIELDS = Object.freeze({
    sleep: { min: 5, max: 3600 },        // cat.js setSleepSeconds 上限 3600
    drool: { min: 6, max: 10800, optional: true },
    slump: { min: 7, max: 10800, optional: true },
    work: { min: 15, max: 36000 }, // fatigue.js setWorkSeconds 上限 36000
    rest: { min: 5, max: 3600 },
  });
  const KEYS = Object.keys(FIELDS);

  const round = (v) => Math.round(v * 100) / 100;
  const effDrool = (s) => (s.drool ?? AUTO.drool * s.sleep);
  const effSlump = (s) => (s.slump ?? AUTO.slump * s.sleep);

  // 返回 { key: 错误文案 }；空对象表示全部合法。s 的值都是秒（drool / slump 可为 null）
  function validate(s) {
    const err = {};
    for (const k of KEYS) {
      const f = FIELDS[k], v = s[k];
      if (v === null && f.optional) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) { err[k] = '请填一个数字'; continue; }
      if (v <= 0) { err[k] = '必须大于 0'; continue; }
      if (v < f.min || v > f.max) err[k] = `范围 ${f.min}–${f.max} 秒`;
    }
    if (!err.sleep && !err.drool && effDrool(s) <= s.sleep) {
      err.drool = `要比入睡时间（${round(s.sleep)} 秒）长`;
    }
    if (!err.sleep && !err.drool && !err.slump && effSlump(s) <= effDrool(s)) {
      err.slump = `要比开始流口水的时刻（${round(effDrool(s))} 秒）晚`;
    }
    return err;
  }

  // 读盘 / 收到事件时用：逐项挑出合法值，其余用默认值；先后顺序不对时 drool / slump 退回自动
  function sanitize(raw) {
    const s = { ...DEFAULTS };
    if (raw && typeof raw === 'object') {
      for (const k of KEYS) {
        const v = raw[k];
        if (v === null && FIELDS[k].optional) s[k] = null;
        else if (typeof v === 'number' && Number.isFinite(v) && v >= FIELDS[k].min && v <= FIELDS[k].max) s[k] = v;
      }
    }
    const err = validate(s);
    if (err.drool) s.drool = null;
    if (validate(s).slump) s.slump = null;
    if (validate(s).slump) s.drool = null; // drool 手填、slump 自动时也可能撞上
    return s;
  }

  window.SillySettings = { DEFAULTS, AUTO, FIELDS, KEYS, validate, sanitize, effDrool, effSlump };
})();
