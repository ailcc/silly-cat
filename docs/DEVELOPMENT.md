# 开发说明

键盘后面的捣蛋奶牛猫：你敲哪个键，它就伸爪去按画面里的同一个键。零依赖、零构建。

- 运行：`npm start`（等于 `python3 -m http.server 4317 --bind 0.0.0.0 --directory prototype`），打开 http://localhost:4317/
- `?sleep=5` 设置入睡时间；`?drool=` `?slump=` 覆盖流口水、趴下的时刻（从最后一次输入算起的秒数）；`?work=` 连续打字多久会生气，`?rest=` 罢工后休息多久消气。URL 参数可以超出滑块范围，控制台里 `window.__cat` 是只读调试信息。
- `?push=0` 关闭推东西；`?pushevery=秒` 设置推杯子的随机间隔基准（默认 600 秒，URL 参数夹在 5–36000 秒）。
- `?cat=猫ID` 选择猫，网页控制栏也可以切换。`?style=line` 使用线条画风，省略时显示毛绒画风。
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
- 减少动画：macOS 跟随系统「减弱动态效果」（`prefers-reduced-motion`），开着时键名原地淡入淡出不飘、不推杯子、发飙和修理直接切到结果、耳朵不抖。Windows 上不跟随系统：WebView2 把「在 Windows 中显示动画」关掉当成减少动画，这个开关常被「最佳性能」、远程桌面、虚拟机关掉，跟随的话 Win10 用户会反馈键名不飘（`cat.js` 的 `IS_WINDOWS`，按 userAgent 判断）。
- 状态条（`statusbar.js`）：猫头顶上方一条细进度条（画面坐标 x 300–500、y 4–24，网页版和桌面版都在 viewBox 内），左边是小标签，平时不显示，只在有事时淡入、事情过去淡出（各 0.2 秒；`prefers-reduced-motion` 下直接显示 / 隐藏）。同一时刻只显示一条，优先级 消气中 > 烦躁 > 困了，换种类时先淡出旧的再淡入新的。数值都直接取自状态机，不另外计时：
  - 困了（蓝灰）：犯困（drowsy，无输入超过入睡时间的一半）期间显示，进度 =（无输入时长 − 入睡时间 / 2）/（入睡时间 / 2），满了正好睡着，睡着后不显示。按键、点鼠标、摸头会让它清空并淡出；只移动鼠标不算输入，不清空。
  - 烦躁（红）：疲劳值 ≥ 0.5 时显示，进度就是疲劳值（出现时已经半满）。疲劳只在打字时涨（最后一次按键后 3 秒内都算在打字），停手后按 3 倍速回落、摸头再额外回落；回落到 0.5 以下淡出，涨满就发飙。发飙（rage）、罢工、修理期间不显示烦躁。
  - 消气中（绿）：罢工（strike）期间一直显示，进度 = 已累计休息时长 / 需要休息的时长，摸头时休息算双倍；罢工期间按键、点鼠标会把累计休息清零（条回到空），只移动鼠标不打断消气，满了猫转回来修键盘，修理（repair）开始时淡出。
  - 调试：`__cat.statusBar` 是只读对象：`kind`（此刻逻辑上该显示的种类：`none` / `sleepy` / `annoyed` / `calming`）、`progress`（0–1）、`enabled`（开关）、`shown` 和 `opacity`（画面上实际画着的种类和不透明度，按渲染帧推进，后台标签页里会落后）。
  - 开关：网页版默认显示，`?statusbar=0` 关掉；桌面版在设置窗口里的「显示状态条」（默认开，存在 settings.json 的 `statusBar` 字段，旧文件没有这项时按开处理）。桌面版里状态条不参与命中判断（`pointer-events: none`），点它等于点到后面的应用。
  - `?demo=` 下：`tired` / `sigh` / `angry` 的疲劳值固定在 0.72 / 0.72 / 0.93，显示对应进度的烦躁条；`rage` 发飙中不显示，不循环时之后进入罢工，消气条照常涨；`rage&loop=1` 一直发飙、一直不显示；`strike` 一直罢工、累计休息固定为 0，所以消气条一直显示但是空的；`repair` 和睡眠类、`tail-mouse`、`wake-marks` 都不显示。

## 桌面版（Tauri 2，macOS / Windows；Windows 版只做过编译检查，没在 Windows 上运行过）

- 开发运行：`npm install` 后 `npm run desktop`。配置更新签名环境变量后用 `npm run desktop:build` 打包。只构建普通安装包可运行 `npm run desktop:build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'`。macOS 出 `src-tauri/target/release/bundle/macos/SillyCat.app` 和 `bundle/dmg/*.dmg`；Windows 出 `bundle/nsis/*-setup.exe`。本地 macOS 构建默认使用 ad-hoc 签名，配置证书的 CI 使用固定自签证书。macOS 首次打开仍要在「隐私与安全性」里放行，Windows 会被 SmartScreen 提示「未知发布者」。
- 外壳在 `src-tauri/`，页面直接用 `prototype/`，没有打包步骤。页面在 Tauri 里会给 `<html>` 加 `desktop` class：隐藏标题和滑块、背景透明，输入来源从 `input.js` 换成 `input-desktop.js`。网页版不受影响。
- 窗口默认 420×345，透明、无边框、置顶、不进 Dock。窗口随「猫的大小」按比例缩放（50%–200%），启动时先恢复大小再定位，之后缩放保持右下角不动。拖动滑块时，设置页每帧最多调用一次 `preview_cat_size` 来缩放窗口。预览只调整窗口，`save_settings` 写入文件并广播 `silly:settings`，滑块松手时立即保存。透明的地方点击会穿透到后面的应用（每 33ms 取一次全局指针位置做命中判断）。
- 全局键鼠：两边都只取键位驱动动画，不记录、不落盘。Windows 用低级键鼠钩子（`src-tauri/src/win_input.rs`），不需要授权，但收不到以管理员身份运行的窗口、UAC 和锁屏界面里的按键。macOS 用只读的 CGEventTap（`src-tauri/src/tap.rs`），需要在「系统设置 → 隐私与安全性 → 输入监控」里勾选 SillyCat（键盘和鼠标按键都要这一项）；没授权时猫照常显示，只是不跟着打字。
- macOS 收不到键盘输入时的提示：猫左上方冒出气泡「我看不到你打字 / 点这里处理」，点它打开设置窗口，顶部多出一块处理区（「打开输入监控设置」「重置授权」「重新启动 SillyCat」），授权正常后气泡和处理区都会自己收起。Windows 和网页版没有这些。
  - 判断方法：不看 `CGPreflightListenEventAccess`（结果在进程里有缓存），看 WindowServer 让不让键盘 tap 打开——没授权、或授权记录绑的是别的签名时，`CGEventTapCreate` 照样返回 tap，但 `CGEventTapIsEnabled` 为 false、开不起来。SillyCat 自己在前台（设置窗口在前面）时系统会放行它的 tap，这时不重新判断，沿用它上次在后台时的结论。
  - ad-hoc 签名随构建变化。首个证书签名的版本需要重新授权一次，之后同一证书签名的版本会保留授权。授权绑在旧签名上时（例如先给本地构建授过权，再装了 CI 构建的版本），系统设置里的开关看起来是开的，但收不到按键，系统也不再弹授权窗口，系统日志里有 `Failed to match existing code requirement for subject com.drew.sillycat and service kTCCServiceListenEvent`。处理：设置窗口里点「重置授权」（应用自己执行 `/usr/bin/tccutil reset ListenEvent com.drew.sillycat`，只清本应用的这一条记录，再申请一次授权并打开输入监控设置），然后在列表里重新打开 SillyCat；打开后系统提示「退出并重新打开」就点它，没提示、或列表里没有 SillyCat，就点「重新启动 SillyCat」。
- 按住头是摸头；按住身体、键盘、鼠标等其他地方拖动窗口，位置记在 `~/Library/Application Support/com.drew.sillycat/window-position.json`（Windows 在 `%APPDATA%\com.drew.sillycat\`，记的是物理像素）。
- 点击菜单栏（托盘）图标，或右键猫、键盘、鼠标等有画面的地方，打开同一套菜单：设置…、检查更新…、显示/隐藏猫、锁定位置、重置位置、打开输入监控设置（仅 macOS）、分隔线、退出。右键菜单在指针位置弹出。
- 勾选「锁定位置」后拖不动，摸头和右键照常。「重置位置」仍可把猫放回默认位置，锁定状态保持不变。锁定状态存在应用配置目录的 `window-lock.json`（布尔字段 `locked`），启动时读取，缺失或损坏时默认解锁。
- 设置窗口：从右键菜单或菜单栏图标里的「设置…」打开（已经开着就带到前面，Esc 关闭；关掉不会退出应用）。页面是 `prototype/settings.html`，字段表和校验在 `prototype/settings.js`。时间参数都按秒填：入睡时间（默认 20，5–3600）；开始流口水、趴到键盘上的时刻（从最后一次操作算起，6/7–10800，留空 = 自动，即入睡时间 × 2、× 3.5；必须入睡 < 流口水 < 趴下）；连续打字多久发飙（默认 90，15–36000）；罢工后歇多久消气（默认 20，5–3600）；大约多久推一次东西（默认 600，60–36000）。「显示状态条」和「推东西」默认开启。改出合法值后立即生效并写入 `~/Library/Application Support/com.drew.sillycat/settings.json`，下次启动自动读取；「恢复默认」回到上面的默认值。
- 设置窗口的基础高度由 `SETTINGS_HEIGHT` 和 `BASE_H` 一起定义。创建时按猫所在显示器的工作区逻辑高度减 40 px 封顶，取不到所在显示器时用主显示器，两者都取不到时用基础高度。页面展开或收起授权区时按 `screen.availHeight - 40` 封顶，内容超出时可上下滚动。
- `settings.json` 的 `cat` 字段可填 `settings.js` 的 `CATS` 中的任一 ID，缺失或无效时用 `cow`。`artStyle` 可填 `fur`（毛绒）或 `line`（线条），缺失或无效时用 `fur`。桌面版启动时等 `load_settings` 返回再显示选中的猫和画风，读取失败时显示毛绒奶牛猫。设置页换猫或切画风会立即保存，主窗口收到 `silly:settings` 就切换。「恢复默认」会选回毛绒奶牛猫。
- 桌面版忽略 `?cat=` 和 `?style=`。支持 URL 的其他字段（含 `?statusbar=`、`?push=`、`?pushevery=`）在启动时按 URL 参数 > 已保存设置 > 默认值取值；之后在设置窗口里改的值覆盖 URL 参数。网页版不读也不写 settings.json，照旧用 URL 参数和控制栏；直接打开设置页可切换头像画风预览。
- macOS 上猫窗口在其他应用的原生全屏 Space 里也显示（`src-tauri/src/macos_window.rs`）：主窗口在首次 `show()` 前设置 `collectionBehavior = CanJoinAllSpaces | Stationary | CanJoinAllApplications`（`CanJoinAllApplications` 是 macOS 13 起的跨应用浮窗角色，我们最低 13），置顶时窗口层级设为 `NSStatusWindowLevel`（25）。设置失败只记日志，猫照常显示。验证：用 `CGWindowListCopyWindowInfo` 看到猫窗口 layer = 25、onscreen；另一个应用进入原生全屏后肉眼确认猫仍在（macOS 26.6.2）。设置窗口没有做这个处理。
- 已知问题：在密码框里打字时系统不把按键交给监听，按住的键可能卡在按下状态。
- 发布：推送 `v*` 标签后，GitHub Actions（`.github/workflows/release.yml`）会构建 macOS 通用版 dmg 和 Windows NSIS 安装包，挂到草稿 Release 上。手动运行只上传 workflow artifacts，默认由 Tauri 在打 DMG 前签名，也可以选 `signing_mode=script` 用脚本签完再打包。CI 验证 DMG 和应用归档的签名，并把签名要求写入运行摘要。
  - 用 `tools/make-signing-cert.sh <仓库外的输出目录>` 生成一次固定证书。按脚本输出把 `.p12.base64` 和密码文件分别写入 Secrets `MACOS_SIGNING_CERT_P12_BASE64`、`MACOS_SIGNING_CERT_PASSWORD`，把证书 SHA-1 写入 Variable `MACOS_SIGNING_CERT_SHA1`。两个 Secrets 都没有时用 ad-hoc 签名。
  - CI 里不把证书交给 tauri：tauri 收到 `APPLE_CERTIFICATE` 时只认通用名带 Apple 前缀（如 `Developer ID Application:`）的证书，自签证书会报 `failed to resolve signing identity`。工作流在签名前自己把证书导入临时钥匙串并设为「代码签名受信任」，只把证书 SHA-1 作为 `APPLE_SIGNING_IDENTITY` 交给 tauri。2026-11-24 在 CI 实测，`signing_mode=tauri` 和 `script` 两种方式产出的 DMG、应用归档签名要求一致：`identifier "com.drew.sillycat" and certificate leaf = H"<SHA-1>"`，均为 universal。
  - 将 `.p12` 和密码备份到密码管理器或离线介质。换证书，或丢失证书且无法从备份恢复时，所有用户都要重新授权。发布首个证书签名的版本时，在草稿 Release 说明里提醒用户重置一次输入监控授权。
  - 本地验签时，把 `.p12.base64` 和密码从文件读入上述同名环境变量，运行 `tools/macos-sign.sh sign <SillyCat.app>`，再用 `tools/verify-mac-signing.sh <产物路径> <证书SHA-1>` 检查 `.app`、`.dmg` 或 `.app.tar.gz`。单架构本地测试包可在产物路径前加 `--allow-single-arch`。
- Windows 的 WebView2：`bundle.windows.webviewInstallMode` 保持默认的 `downloadBootstrapper`：安装时先查注册表，已装就跳过，没装才联网下载微软的引导程序。不用 `offlineInstaller`：它把完整运行库打进安装包，2026-11-24 实测微软独立安装包 `MicrosoftEdgeWebView2RuntimeInstallerX64.exe` 为 294,099,168 字节（约 280MB，Tauri 文档写的 127MB 已过时），而且 Windows 自更新直接下载 `-setup.exe`，每次更新都要下这么大。联网下载失败的用户，靠 `src-tauri/installer/` 里的两个语言文件覆盖的安装器报错文字找到出路：文字只指向 https://github.com/S0u1/silly-cat 的「常见问题」，具体下载方法写在 README，这样以后要改（比如决定在 GitHub 托管运行库）只改 README，不用重发安装器。语言文件由 `bundle.windows.nsis.customLanguageFiles` 引用，是 Tauri 内置语言文件的完整副本，只改了 `webview2AbortError` 和 `webview2DownloadError` 两行；升级 Tauri CLI 后要对照内置文件检查条目是否有增减。
- Win7/8/8.1 的 WebView2：微软最新版运行库和引导程序在这些系统上崩（报缺 `PackageIdFromFullName`），最后支持的是 109。README 常见问题里给的是微软更新目录的直链（x64 109.0.1518.140，150,552,536 字节，SHA-256 `eac95c80…119b`，2026-11-24 下载核对过哈希，没在 Win7 真机装过），链接失效时走目录搜索页。注意：这只解决 WebView2；主线版本用较新的 Rust/Tauri 构建，Win7 上能否运行 SillyCat 本身另说。`exp/win7` 分支（Rust 1.77.2 + Tauri 2.11，CI 手动触发）出的安装包导入表检查通过，同样没在真机运行过。

## 更新机制

桌面版使用 Tauri 2 updater。启动约 10 秒后检查一次，之后每 24 小时检查。设置文件中的布尔字段 `autoUpdate` 默认是 `true`，缺失或类型错误时也按开启处理。关闭后停止后台检查，右键菜单和托盘里的「检查更新…」仍可手动使用。检查只请求本项目的 GitHub Release，不上传输入或设置。只有用户点击安装才下载更新。

生产端点为 `https://github.com/S0u1/silly-cat/releases/latest/download/latest.json`，指向已发布的最新 Release。Rust 插件根据清单、当前平台和 semver 决定是否提示更新，下载后校验签名，并要求签名中的版本与清单一致。macOS 使用通用 `.app.tar.gz`，Windows 使用 NSIS 安装包和 passive 安装模式。安装位置不可写时转到 Releases 页面手动下载。

更新公钥嵌入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。将对应私钥内容和密码分别保存到仓库 Secrets `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，并在本地安全备份。这对密钥和 macOS 代码签名证书各有用途。换用新私钥后，旧客户端仍可能发现版本，但会拒绝安装由新密钥签署的包。丢失旧私钥时，需要用户手动安装包含新公钥的版本。

标签构建要求两个更新 Secrets 均已配置。手动运行 release 工作流时，缺少任一项会告警并跳过更新产物签名。默认的 `tauri` 路径在标签构建中由 tauri-action 将安装包、更新归档、签名和合并后的 `latest.json` 上传到同一个草稿。发布草稿前检查清单中 macOS 两种架构和 Windows x64 的下载地址、签名及版本。`script` 试跑路径重新签署最终的 macOS 归档；如采用该路径发布，需要手工将最终归档的下载 URL 和新签名写入清单的 macOS 平台项，保留 Windows 平台项。

在 macOS 上运行 `cd src-tauri && cargo test --offline updater:: -- --ignored`，可无界面验证回环下载、正确签名替换临时 .app、错签或签名缺少版本或归档被篡改时保留旧版，以及安装目录不可写时的权限探测；更新后的重启和输入监控授权保留情况仍需真机验证。

在 macOS worktree 根目录运行 `tools/test-updater.sh`，按终端提示完成本机更新和错误签名测试。脚本使用独立测试标识符、一次性密钥及回环端点。验证关闭自动检查时，保存设置并重新启动旧版，等待超过 10 秒，确认服务日志没有新的清单请求，再手动检查并确认有请求。升级成功后再手动检查应显示已是最新版本，按脚本提示临时移走清单后，手动检查应显示失败。要一并验证输入监控授权是否保留，可将环境变量 `UPDATER_TEST_IDENTITY` 设为本机已有的固定证书签名身份，再运行同一脚本。

无界面测试可运行 `cargo test --manifest-path src-tauri/Cargo.toml`。允许绑定回环端口的环境还可运行 `cargo test --manifest-path src-tauri/Cargo.toml check_loopback_manifest -- --ignored`，用真实插件检查本地清单中的新版和当前版本。

## Windows 7 / 8 / 8.1 版

Tauri 2.12 起不再支持 Win7，Rust 1.78 起的标准库也要求 Win10。所以发布流程里 `release.yml` 的 `win7` 任务单独用 Rust 1.77.2 和 Tauri 2.11 再构建一个包，传到同一个草稿 Release，文件名带 `win7`：`SillyCat_x.y.z_win7_x64-setup.exe`、对应 `.sig` 和 `latest-win7.json`。主线包的构建不依赖它，它失败时（`continue-on-error`）只是这个 Release 没有 win7 附件。

构建细节（都只发生在 CI 工作区，不改仓库里的 `Cargo.toml` 和 `Cargo.lock`）：

- 给 `Cargo.toml` 加 `rust-version = "1.77.2"`，把 `tauri-plugin-updater` 放宽到 `"2"`（2.14 要求的 Tauri 2.12 在 Win7 上不能用），再用 stable 的 cargo 设 `CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback` 重新生成 `Cargo.lock`，选出 1.77.2 能编的版本（2026-11-24 解析为 tauri 2.11.6、tauri-plugin-updater 2.12.0）。
- `@tauri-apps/cli` 临时换成 2.11.5，要和 Rust 端的 Tauri 小版本一致。
- `src-tauri/tauri.win7.conf.json` 叠加在主配置上：只打 NSIS；`webviewInstallMode` 设为 `skip`（微软最新的引导程序在 Win7 上崩，WebView2 109 由用户按 README 常见问题自己装）；更新地址改成 `.../releases/latest/download/latest-win7.json`。这样 Win7 版不会被主线 `latest.json` 更新到普通 Windows 包。
- `tools/make-win7-manifest.mjs` 用同一把更新私钥签出的 `.sig` 生成 `latest-win7.json`，发布草稿后它才会出现在 `releases/latest/download/`。
- `tools/win7-check-imports.py` 检查 `silly-cat.exe` 的导入表，发现 Win8 以上才有的系统接口就让任务失败。它只看链接时写进导入表的接口，运行时动态获取的看不到。

约束：以后 Rust 代码不能用 1.77.2 之后才稳定的接口（例如 `LazyLock` 要 1.80，`ErrorKind::ReadOnlyFilesystem` 要 1.83），新增依赖也要能在 1.77.2 下编译，否则 `win7` 任务会失败。本地检查：把上面的 `Cargo.toml` 和 `Cargo.lock` 改动做在临时工作区里，运行 `cargo +1.77.2 check --target x86_64-pc-windows-gnu --locked`。

截至 2026-11-24，这个包没有在 Win7 真机上安装或运行过，导入表检查通过也不等于一定能运行；Win7 版的自动更新、WebView2 109 的安装也都没有真机验证。

## 手绘毛发部件

网页与桌面主窗口都通过 `SillyCoats.apply(id)` 换猫。`index.html` 先加载 `art.js`、各猫的尺寸清单，再加载 `coats.js`。只有同时具备毛色的 `art` 配置和清单条目的部件才会替换对应矢量。切走时移除图片和切片，恢复原花纹与轮廓。眼睛、鼻口、牙齿、胡须、腮红、鼻边黑点、键鼠、杯子和特效继续由矢量绘制。头图鼓腮时绕 (400, 205) 缩放，压痕仍使用动态的头部裁剪路径。

新增一只猫时，依次完成以下步骤。

1. 在 `prototype/coats.js` 的列表登记 ID、名称、`art: art(id)` 和可选的 `shape`。在 `settings.js` 的 `CATS` 同位置加入 ID。网页下拉框从 `SillyCoats.list()` 读取列表。更新 README 的猫列表。
2. 在 `style.css` 的头像调色区域添加该 ID 的基础毛色和四肢、尾巴、耳朵的回退色。左右眼皮用 `--coat-lid-l/r` 匹配眼周的毛色，闭眼弧线用 `--coat-eye-arc-l/r`。两只虹膜默认使用 `--coat-iris`，异瞳分别覆盖 `--coat-iris-l`、`--coat-iris-r`。胡须使用 `--coat-whisker` 和 `--coat-whisker-opacity`，眉毛使用 `--coat-brow`，浅色侧眉毛可用 `--coat-brow-l` 覆盖。按需设置鼻子、嘴线和腮红透明度。
3. 将透明 PNG 放进同一输入目录，包括 `head`、`ear`、`body`、`arm-l`、`arm-r`、`paw-l`、`paw-r`、`tail`、`back-head`、`ear-back`、`back-body`。头图留出五官。前腿从肩到腕、尾巴从根到尖，都从上往下画成直条。正面和背面分别按观众左右命名：`ear` 和 `ear-back` 在画面左边；右耳默认镜像左耳。花色不对称时，再给出已朝右的 `ear-r.png`、`ear-back-r.png`，各自在对应视角的右边直接使用。
4. 在 `tools/prepare_art.py` 的 `PORTRAITS` 登记头图中心和宽度、耳图位置和角度、可选耳根支点，以及 `headSX` 和耳朵缩放，与 `coats.js` 同步。运行 `python3 tools/prepare_art.py --cat 猫ID --source 原图目录`（需要 Pillow 的 WebP 支持）。奶牛猫沿用脚本内的旧文件名映射。脚本清除 alpha < 32 的像素，裁切后留 6 px 透明边，缩到长边至多 768 px，导出质量 90 的 WebP 和尺寸清单到 `prototype/art/猫ID/`。头图和耳图齐备时同步生成 `prototype/cats/猫ID.svg`。头像内嵌长边至多 256 px 的图片，复用网页的矢量五官和配色。
5. 在 `index.html` 的 `art.js` 与 `coats.js` 之间加载新清单。原图未齐时可先登记空清单 `SillyArt.register("猫ID", {});` 并提供矢量头像。已有的九只非奶牛猫均预留了清单入口，生成资源后刷新页面即可。
6. 按 800 × 620 场景坐标调摆放。用 `art(id, opts)` 按部件浅合并字段，例如 `{ head: { cy: 166 }, arm: { width: 44 }, tail: { scale: 0.6 } }`。前腿默认切 8 段，尾巴默认切 16 段，相邻切片按接点的角平分线斜切拼接。正面尾宽为（原直径 + 毛边）× `art.tail.scale`，鼠标上方复用这组切片。罢工尾宽为 31 × 同一倍数，路径和时序沿用原姿态。用 `?cat=猫ID&demo=tail-mouse` 和 `?cat=猫ID&demo=strike` 检查正背面、尾巴和耳朵，再在设置页检查头像与键盘选猫。

新增猫，或改了线条版的正面花纹、五官、配色或体型后，运行 `python3 tools/line_avatars.py`（需要 Python 3 和 Node.js）。脚本复用场景 SVG、`style.css` 的头像配色和 `coats.js` 的矢量花纹，重新生成 `prototype/cats/line/猫ID.svg`。设置页按画风读取对应目录下的头像。

`head` 和 `paw` 默认用中心点 `cx, cy` 与 `width` 放置，爪子的坐标相对腕部组。罢工后脑勺 `backHead` 继承合并后的 `head`，可单独覆盖。图片高度按素材宽高比计算。`arm` 可覆盖 `width, top, bottom, segments` 和 `maskBody`（用随身体运动的遮罩挡住肩端），`tail` 可覆盖 `scale, fringe, segments`。

`ear` 使用左耳图左上角 `x, y` 和 `width`。`rotate` 单位是度，正值让耳尖向画面外侧倾斜。`pivot: { x, y }` 使用左侧场景坐标，默认取当前耳图底边中点，右侧支点关于 x = 400 对称。正面、罢工背影和独立右耳图都使用此规则；耳图旋转后再应用 `shape.ear`。

`headPath` 是场景坐标中的闭合 SVG 路径，供醒来压痕和背影头部花纹裁切。正面裁切随头图鼓腮，两面裁切均随所在头组缩放。`imprint: { dx, dy }` 平移裁切内的键帽印和红晕，默认都是 0。用 `?cat=猫ID&demo=wake-marks&at=1200` 检查键印是否完整。
