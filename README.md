# silly-cat 原型

键盘后面的捣蛋奶牛猫：你敲哪个键，它就伸爪去按画面里的同一个键。零依赖、零构建。

- 运行：`npm start`（等于 `python3 -m http.server 4317 --bind 0.0.0.0 --directory prototype`），打开 http://localhost:4317/
- `?sleep=5` 设置入睡时间（5–120 秒），控制台里 `window.__cat` 是只读调试信息。
- 键盘和鼠标朝向猫摆放（猫是使用者，观众看到的键帽字是倒的）。凡是说左右的地方（`__cat.paws.left/right`、代码里的 `'L'/'R'`、`mouseSide`）都按猫自己的左右：`left` = 猫的左爪 = 观众右侧那只白爪。
- 结构：`input.js` 把浏览器键鼠事件翻译成抽象事件；`cat.js` 只消费这些事件（状态机 + 渲染）；`keyboard.js` 画键盘、查键位。
