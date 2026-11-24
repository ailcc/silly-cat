# 开发说明

键盘后面的捣蛋奶牛猫：你敲哪个键，它就伸爪去按画面里的同一个键。零依赖、零构建。

- 运行：`npm start`（等于 `python3 -m http.server 4317 --bind 0.0.0.0 --directory prototype`），打开 http://localhost:4317/
- `?sleep=5` 设置入睡时间；`?drool=` `?slump=` 覆盖流口水、趴下的时刻（从最后一次输入算起的秒数）；`?work=` 连续打字多久会生气，`?rest=` 罢工后休息多久消气。URL 参数可以超出滑块范围，控制台里 `window.__cat` 是只读调试信息。
- `?push=0` 关闭推东西；`?pushevery=秒` 设置推杯子的随机间隔基准（默认 600 秒，URL 参数夹在 5–36000 秒）。
- `?cat=猫ID` 选择猫，网页控制栏也可以切换。`prototype/cats/*.svg` 是设置页的静态头像（有手绘部件时由下文的资源脚本更新），改了某只猫的正面花纹后要重新导出对应的头像。
- 键盘和鼠标朝向猫摆放（猫是使用者，观众看到的键帽字是倒的）。凡是说左右的地方（`__cat.paws.left/right`、代码里的 `'L'/'R'`、`mouseSide`）都按猫自己的左右：`left` = 猫的左爪 = 观众右侧那只白爪。
- 鼠标用尾巴操作：鼠标一动，尾巴从身后绕过身体一侧（鼠标在哪边就绕哪边）伸到前面，尾尖搭在鼠标上跟着动；点击时尾尖压到按的那颗键上，松开弹一下；鼠标停下 1.5 秒后收回身后接着摆。伸出 0.38 秒、收回 0.52 秒。两只爪子一直留在键盘上照常打字（空格默认用鼠标那一侧的爪，它正按着别的键就换另一只）。只有发飙抓鼠标砸、消气后修鼠标时才用爪子；发飙时尾巴先收回去再抓。`prefers-reduced-motion` 下尾巴直接切换，不做过渡。
- 鼠标相关的调试字段：`__cat.paws.left/right` 是爪子此刻的目标（键名、`rest`、发飙/修理时的 `rage`/`repair` 等），不会再出现 `mouse`；`__cat.mouseSide` 仍是鼠标摆在猫的哪一侧；`__cat.tail` 是尾巴和鼠标的关系：`idle` 收在身后、`reaching` 伸出途中、`on-mouse` 搭在鼠标上、`retracting` 收回途中；`__cat.tailReach` 是伸出进度 0–1（按渲染帧推进，后台标签页里会落后）。
- 结构：`input.js` 把浏览器键鼠事件翻译成抽象事件；`cat.js` 只消费这些事件（状态机 + 渲染）；`keyboard.js` 画键盘、查键位；`sleep.js`（睡眠三阶段）、`fatigue.js`（疲劳、发飙、罢工、修理）、`push.js`（推杯子、掉落和返回）和 `statusbar.js`（状态条）是挂在 `cat.js` 钩子上的扩展模块。
- 调试入口 `?demo=<阶段>`：把猫直接摆到并停在某个阶段，不受计时影响；加 `&loop=1` 循环播放该段动画，加 `&at=毫秒` 冻结在时间轴上的某一刻（逐帧检查用）。
  - `tired` 累了　`sigh` 叹气循环（每 1.6 秒一次）　`angry` 生气（可以照常打字看点头）
  - `rage` 整段发飙（砸键盘、抓起鼠标砸碎；不循环时之后进入罢工）　`strike` 罢工（一直罢工，不会消气）　`repair` 消气后自己修好
  - `tail-mouse` 尾巴操作鼠标（5 秒一轮：静止 0.3 秒 → 鼠标开始动、尾巴伸出 → 跟着鼠标动几下 → 停 → 2.25 秒点一下左键 → 停够 1.5 秒收回 → 静止）。不带 `loop` 时放一遍后交还给真实输入
  - `?demo=push` 播放一遍推杯子，`&loop=1` 缩短等待并循环播放，`&at=毫秒` 查看固定时刻。`?demo=push-back` 直接播放杯子在原位淡入。调试字段为 `__cat.pushPhase`、`__cat.mugOffset` 和 `__cat.nextPushIn`。
  - `drool` 流口水　`slumped` 趴在键盘上　`slump-in` 趴下的过渡（坐着睡 0.3 秒 → 按当前趴下方式趴下 → 趴好停 0.9 秒 → 0.4 秒快速起身）　`wake-marks` 刚醒、脸上带压痕
- 趴下方式：每次进入趴下阶段随机选一种（各一半），`__cat.slumpStyle` 是当次实际用的方式。`?slump-style=nod|melt` 强制指定（调试用），可以和 `?demo=slump-in`、`?demo=slumped` 一起用；demo 不带它时在页面加载时随机选一次。两种都不伸手，爪子留在原位：
  - `nod` 点头栽倒（3.3 秒）：点两次头、一次比一次低、每次猛地抬回来一点，第三次栽到键盘上，落下小回弹；下巴两侧露出爪尖
  - `melt` 融化摊平（2.5 秒）：身体慢慢摊宽压扁，头稍晚一点顺势滑到键盘上，缓入缓出
  - 头压住的键会被按下；醒来都是 0.4 秒快速反向起身。`prefers-reduced-motion` 下直接切到趴好的姿势。
- 睡着时（坐着睡、流口水、趴着）只移动鼠标不会叫醒猫，尾巴也不去够鼠标（正搭在鼠标上时入睡会收回去），睡眠阶段照常往下走，只抖一下耳朵；按键、点鼠标、摸头照常叫醒。犯困还没睡着时移动鼠标，尾巴照常去操作。
- 只移动鼠标不重置入睡计时：光动鼠标不打字、不点击，猫照样会犯困、睡着；按键、点鼠标、摸头才算输入。
- 状态条（`statusbar.js`）：猫头顶上方一条细进度条（画面坐标 x 300–500、y 4–24，网页版和桌面版都在 viewBox 内），左边是小标签，平时不显示，只在有事时淡入、事情过去淡出（各 0.2 秒；`prefers-reduced-motion` 下直接显示 / 隐藏）。同一时刻只显示一条，优先级 消气中 > 烦躁 > 困了，换种类时先淡出旧的再淡入新的。数值都直接取自状态机，不另外计时：
  - 困了（蓝灰）：犯困（drowsy，无输入超过入睡时间的一半）期间显示，进度 =（无输入时长 − 入睡时间 / 2）/（入睡时间 / 2），满了正好睡着，睡着后不显示。按键、点鼠标、摸头会让它清空并淡出；只移动鼠标不算输入，不清空。
  - 烦躁（红）：疲劳值 ≥ 0.5 时显示，进度就是疲劳值（出现时已经半满）。疲劳只在打字时涨（最后一次按键后 3 秒内都算在打字），停手后按 3 倍速回落、摸头再额外回落；回落到 0.5 以下淡出，涨满就发飙。发飙（rage）、罢工、修理期间不显示烦躁。
  - 消气中（绿）：罢工（strike）期间一直显示，进度 = 已累计休息时长 / 需要休息的时长，摸头时休息算双倍；罢工期间按键、点鼠标会把累计休息清零（条回到空），只移动鼠标不打断消气，满了猫转回来修键盘，修理（repair）开始时淡出。
  - 调试：`__cat.statusBar` 是只读对象：`kind`（此刻逻辑上该显示的种类：`none` / `sleepy` / `annoyed` / `calming`）、`progress`（0–1）、`enabled`（开关）、`shown` 和 `opacity`（画面上实际画着的种类和不透明度，按渲染帧推进，后台标签页里会落后）。
  - 开关：网页版默认显示，`?statusbar=0` 关掉；桌面版在设置窗口里的「显示状态条」（默认开，存在 settings.json 的 `statusBar` 字段，旧文件没有这项时按开处理）。桌面版里状态条不参与命中判断（`pointer-events: none`），点它等于点到后面的应用。
  - `?demo=` 下：`tired` / `sigh` / `angry` 的疲劳值固定在 0.72 / 0.72 / 0.93，显示对应进度的烦躁条；`rage` 发飙中不显示，不循环时之后进入罢工，消气条照常涨；`rage&loop=1` 一直发飙、一直不显示；`strike` 一直罢工、累计休息固定为 0，所以消气条一直显示但是空的；`repair` 和睡眠类、`tail-mouse`、`wake-marks` 都不显示。

## 桌面版（Tauri 2，macOS / Windows；Windows 版只做过编译检查，没在 Windows 上运行过）

- 开发运行：`npm install` 后 `npm run desktop`。打包：`npm run desktop:build`。macOS 出 `src-tauri/target/release/bundle/macos/SillyCat.app` 和 `bundle/dmg/*.dmg`；Windows 出 `bundle/nsis/*-setup.exe`。都未签名：macOS 首次打开要在「隐私与安全性」里放行，Windows 会被 SmartScreen 提示「未知发布者」。
- 外壳在 `src-tauri/`，页面直接用 `prototype/`，没有打包步骤。页面在 Tauri 里会给 `<html>` 加 `desktop` class：隐藏标题和滑块、背景透明，输入来源从 `input.js` 换成 `input-desktop.js`。网页版不受影响。
- 窗口默认 420×345，透明、无边框、置顶、不进 Dock。窗口随「猫的大小」按比例缩放（50%–200%），启动时先恢复大小再定位，之后缩放保持右下角不动。拖动滑块时，设置页每帧最多调用一次 `preview_cat_size` 来缩放窗口。预览只调整窗口，`save_settings` 写入文件并广播 `silly:settings`，滑块松手时立即保存。透明的地方点击会穿透到后面的应用（每 33ms 取一次全局指针位置做命中判断）。
- 全局键鼠：两边都只取键位驱动动画，不记录、不落盘。Windows 用低级键鼠钩子（`src-tauri/src/win_input.rs`），不需要授权，但收不到以管理员身份运行的窗口、UAC 和锁屏界面里的按键。macOS 用只读的 CGEventTap（`src-tauri/src/tap.rs`），需要在「系统设置 → 隐私与安全性 → 输入监控」里勾选 SillyCat（键盘和鼠标按键都要这一项）；没授权时猫照常显示，只是不跟着打字。
- macOS 收不到键盘输入时的提示：猫左上方冒出气泡「我看不到你打字 / 点这里处理」，点它打开设置窗口，顶部多出一块处理区（「打开输入监控设置」「重置授权」「重新启动 SillyCat」），授权正常后气泡和处理区都会自己收起。Windows 和网页版没有这些。
  - 判断方法：不看 `CGPreflightListenEventAccess`（结果在进程里有缓存），看 WindowServer 让不让键盘 tap 打开——没授权、或授权记录绑的是别的签名时，`CGEventTapCreate` 照样返回 tap，但 `CGEventTapIsEnabled` 为 false、开不起来。SillyCat 自己在前台（设置窗口在前面）时系统会放行它的 tap，这时不重新判断，沿用它上次在后台时的结论。
  - 应用没有正式签名，每次构建签名都不同。授权绑在旧签名上时（例如先给本地构建授过权，再装了 CI 构建的版本），系统设置里的开关看起来是开的，但收不到按键，系统也不再弹授权窗口，系统日志里有 `Failed to match existing code requirement for subject com.drew.sillycat and service kTCCServiceListenEvent`。处理：设置窗口里点「重置授权」（应用自己执行 `/usr/bin/tccutil reset ListenEvent com.drew.sillycat`，只清本应用的这一条记录，再申请一次授权并打开输入监控设置），然后在列表里重新打开 SillyCat；打开后系统提示「退出并重新打开」就点它，没提示、或列表里没有 SillyCat，就点「重新启动 SillyCat」。
- 按住头是摸头；按住身体、键盘、鼠标等其他地方拖动窗口，位置记在 `~/Library/Application Support/com.drew.sillycat/window-position.json`（Windows 在 `%APPDATA%\com.drew.sillycat\`，记的是物理像素）。
- 菜单栏（托盘）图标：设置…、显示/隐藏猫、重置位置、打开输入监控设置（仅 macOS）、退出。
- 右键猫、键盘、鼠标等有画面的地方，在指针位置弹出菜单：设置…、退出。
- 设置窗口：从右键菜单或菜单栏图标里的「设置…」打开（已经开着就带到前面，Esc 关闭；关掉不会退出应用）。页面是 `prototype/settings.html`，字段表和校验在 `prototype/settings.js`。时间参数都按秒填：入睡时间（默认 20，5–3600）；开始流口水、趴到键盘上的时刻（从最后一次操作算起，6/7–10800，留空 = 自动，即入睡时间 × 2、× 3.5；必须入睡 < 流口水 < 趴下）；连续打字多久发飙（默认 90，15–36000）；罢工后歇多久消气（默认 20，5–3600）；大约多久推一次东西（默认 600，60–36000）。「显示状态条」和「推东西」默认开启。改出合法值后立即生效并写入 `~/Library/Application Support/com.drew.sillycat/settings.json`，下次启动自动读取；「恢复默认」回到上面的默认值。
- 设置窗口的基础高度由 `SETTINGS_HEIGHT` 和 `BASE_H` 一起定义。创建时按猫所在显示器的工作区逻辑高度减 40 px 封顶，取不到所在显示器时用主显示器，两者都取不到时用基础高度。页面展开或收起授权区时按 `screen.availHeight - 40` 封顶，内容超出时可上下滚动。
- `settings.json` 的 `cat` 字段可填 `settings.js` 的 `CATS` 中的任一 ID，缺失或无效时用 `cow`。桌面版启动时等 `load_settings` 返回再显示选中的猫，读取失败时显示奶牛猫。设置页点头像后立即保存，主窗口收到 `silly:settings` 就切换。
- 桌面版忽略 `?cat=`。支持 URL 的其他字段（含 `?statusbar=`、`?push=`、`?pushevery=`）在启动时按 URL 参数 > 已保存设置 > 默认值取值；之后在设置窗口里改的值覆盖 URL 参数。网页版不读也不写 settings.json，照旧用 URL 参数和控制栏。
- 已知问题：其他应用全屏时猫可能不显示；在密码框里打字时系统不把按键交给监听，按住的键可能卡在按下状态。
- 发布：推送 `v*` 标签后，GitHub Actions（`.github/workflows/release.yml`）会构建 macOS 通用版 dmg 和 Windows NSIS 安装包，挂到草稿 Release 上。v0.0.1、v0.0.2 都是这个流程打出来的。

## 手绘毛发部件

网页与桌面主窗口都通过 `SillyCoats.apply(id)` 换猫。`index.html` 先加载 `art.js`、各猫的尺寸清单，再加载 `coats.js`。只有同时具备毛色的 `art` 配置和清单条目的部件才会替换对应矢量。切走时移除图片和切片，恢复原花纹与轮廓。眼睛、鼻口、牙齿、胡须、腮红、鼻边黑点、键鼠、杯子和特效继续由矢量绘制。头图鼓腮时绕 (400, 205) 缩放，压痕仍使用动态的头部裁剪路径。

新增一只猫时，依次完成以下步骤。

1. 在 `prototype/coats.js` 的列表登记 ID、名称、`art: art(id)` 和可选的 `shape`。在 `settings.js` 的 `CATS` 同位置加入 ID。网页下拉框从 `SillyCoats.list()` 读取列表。更新 README 的猫列表。
2. 在 `style.css` 的头像调色区域添加该 ID 的基础毛色和四肢、尾巴、耳朵的回退色。左右眼皮用 `--coat-lid-l/r` 匹配眼周的毛色，闭眼弧线用 `--coat-eye-arc-l/r`。两只虹膜默认使用 `--coat-iris`，异瞳分别覆盖 `--coat-iris-l`、`--coat-iris-r`。胡须使用 `--coat-whisker` 和 `--coat-whisker-opacity`，眉毛使用 `--coat-brow`，浅色侧眉毛可用 `--coat-brow-l` 覆盖。按需设置鼻子、嘴线和腮红透明度。
3. 将透明 PNG 放进同一输入目录，包括 `head`、`ear`、`body`、`arm-l`、`arm-r`、`paw-l`、`paw-r`、`tail`、`back-head`、`ear-back`、`back-body`。头图留出五官。前腿从肩到腕、尾巴从根到尖，都从上往下画成直条。正面和背面分别按观众左右命名：`ear` 和 `ear-back` 在画面左边；右耳默认镜像左耳。花色不对称时，再给出已朝右的 `ear-r.png`、`ear-back-r.png`，各自在对应视角的右边直接使用。
4. 在 `tools/prepare_art.py` 的 `PORTRAITS` 登记头图中心和宽度、耳图位置和角度、可选耳根支点，以及 `headSX` 和耳朵缩放，与 `coats.js` 同步。运行 `python3 tools/prepare_art.py --cat 猫ID --source 原图目录`（需要 Pillow 的 WebP 支持）。奶牛猫沿用脚本内的旧文件名映射。脚本清除 alpha < 32 的像素，裁切后留 6 px 透明边，缩到长边至多 768 px，导出质量 90 的 WebP 和尺寸清单到 `prototype/art/猫ID/`。头图和耳图齐备时同步生成 `prototype/cats/猫ID.svg`。头像内嵌长边至多 256 px 的图片，复用网页的矢量五官和配色。
5. 在 `index.html` 的 `art.js` 与 `coats.js` 之间加载新清单。原图未齐时可先登记空清单 `SillyArt.register("猫ID", {});` 并提供矢量头像。已有的九只非奶牛猫均预留了清单入口，生成资源后刷新页面即可。
6. 按 800 × 620 场景坐标调摆放。用 `art(id, opts)` 按部件浅合并字段，例如 `{ head: { cy: 166 }, arm: { width: 44 }, tail: { scale: 0.6 } }`。前腿默认切 8 段，尾巴默认切 16 段，相邻切片按接点的角平分线斜切拼接。正面尾宽为（原直径 + 毛边）× `art.tail.scale`，鼠标上方复用这组切片。罢工尾宽为 31 × 同一倍数，路径和时序沿用原姿态。用 `?cat=猫ID&demo=tail-mouse` 和 `?cat=猫ID&demo=strike` 检查正背面、尾巴和耳朵，再在设置页检查头像与键盘选猫。

`head` 和 `paw` 默认用中心点 `cx, cy` 与 `width` 放置，爪子的坐标相对腕部组。罢工后脑勺 `backHead` 继承合并后的 `head`，可单独覆盖。图片高度按素材宽高比计算。`arm` 可覆盖 `width, top, bottom, segments` 和 `maskBody`（用随身体运动的遮罩挡住肩端），`tail` 可覆盖 `scale, fringe, segments`。

`ear` 使用左耳图左上角 `x, y` 和 `width`。`rotate` 单位是度，正值让耳尖向画面外侧倾斜。`pivot: { x, y }` 使用左侧场景坐标，默认取当前耳图底边中点，右侧支点关于 x = 400 对称。正面、罢工背影和独立右耳图都使用此规则；耳图旋转后再应用 `shape.ear`。

`headPath` 是场景坐标中的闭合 SVG 路径，供醒来压痕和背影头部花纹裁切。正面裁切随头图鼓腮，两面裁切均随所在头组缩放。`imprint: { dx, dy }` 平移裁切内的键帽印和红晕，默认都是 0。用 `?cat=猫ID&demo=wake-marks&at=1200` 检查键印是否完整。
