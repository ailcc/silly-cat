# 捣蛋猫 兼容版

供原版装不上或缺少 WebView2 的 Windows x64 电脑使用。兼容版使用 Electron 22.3.27 自带的 Chromium。安装包按当前用户安装，zip 解压后可直接运行 SillyCatCompat.exe。桌面和开始菜单显示「捣蛋猫 兼容版」。

## 使用与排查

点托盘图标或右键猫可以打开设置、玩法说明、检查更新、切换显示、锁定或重置位置、打开日志文件夹和退出。按住身体可拖动，按住头部可摸猫。Windows 7 使用 Aero 时显示透明窗口，关闭桌面合成时使用卡片背景。

设置、窗口位置和锁定状态和正式版共用 `%APPDATA%\com.drew.sillycat\`（从正式版切过来不用重新设置）。这个文件夹也保存运行日志 `silly-cat.log` 和安装日志 `install.log`。运行日志超过 256 KiB 后，下次追加时轮换为 `silly-cat.log.old`。致命运行错误会把当前日志复制到桌面「捣蛋猫兼容版-错误日志.txt」，安装失败会生成「捣蛋猫兼容版-安装日志.txt」。桌面不可写时按弹窗提示从日志文件夹获取。调试启动脚本的用法见随包 README.txt。

## 开发和验收

在本目录执行 `npm ci`、`npm run selftest`、`npm run dist`。自测需可用的桌面窗口服务、回环网络及项目的 Tauri CLI。页面直接加载同仓库的 prototype 资源，preload 提供其使用的 Tauri 接口。macOS 可开发和交叉打包，真实系统键鼠、合成、登录项及安装升级流程须在 Windows 上验收。自测使用临时配置和模拟的系统操作。`npm run selftest -- --selftest-out /path/to/output` 可指定窗口自测报告及截图的输出目录。

macOS 上运行 dist 时，准备脚本按 package-lock.json 的版本和 SHA-512 完整性值补齐 Koffi 的 Windows x64 预编译模块。

构建输出位于 dist/，包含当前用户 NSIS 安装包和免安装 zip。产品内部标识为 com.drew.sillycat.compat，配置目录与正式版共用。NSIS 模板读取已有安装位置，没有比较新旧产品版本号的降级拦截。安装脚本保留模板的进程检查、卸载和结束页逻辑。

兼容版不做 Windows 全屏游戏检测和密码框（隐私）检测，这两项只在正式版（Tauri）里有；缺少这两项时猫不会误戴耳机或乱捂脸。

## 发布签名与更新清单

发版走 `.github/workflows/release.yml` 的 `electron` 任务。CI 检查应用版本与 `src-tauri/tauri.conf.json` 一致，测试和打包后用 Tauri 的更新密钥为最终安装包签名，再用 Electron 运行应用的验签代码，校验成功后生成 `latest-electron.json`。标签构建将安装包、`.sig`、免安装 zip 和清单上传到同一个草稿 Release。手动运行可从 workflow artifact 下载产物，缺更新密钥时只出安装包和 zip 等构建产物。

自动更新清单按顺序尝试三个源，第一个能拉到的生效（下载地址写在清单里，取哪份清单就用哪个源下载）：Gitee Release 附件 `releases/download/latest/latest-electron.json`（可达性最好）→ Gitee 仓库 `raw/main/updates/latest-electron.json` → GitHub `releases/latest/download/latest-electron.json`。下载失败自动换别的源重试一次，安装目录不可写时打开 Gitee 发布页手动下载。

需要手动出包时，从仓库根目录执行以下步骤。

1. 确认 `electron/package.json`、`electron/package-lock.json` 和 `src-tauri/tauri.conf.json` 的应用版本一致。运行 `npm ci`，再进入 `electron/` 执行 `npm ci`、`npm run selftest` 和 `npm run dist`，然后回到根目录。
2. 在发布环境中设置 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，执行 `npm run tauri -- signer sign --app-version <版本> electron/dist/SillyCat_<版本>_electron_x64-setup.exe`，保留生成的 `.sig`。
3. 设置 `ELECTRON_RUN_AS_NODE=1`，用 `electron/node_modules/electron/dist/electron.exe`（macOS 上是同目录下的 `Electron.app/Contents/MacOS/Electron`）运行 `electron/tools/verify-update-signature.cjs <安装包路径> <.sig 路径> <版本>`。脚本默认使用内置正式公钥。
4. 执行 `node electron/tools/make-electron-manifest.mjs <版本> <标签> <安装包文件名> <.sig 路径> electron/dist/latest-electron.json`。版本和标签分别填写，例如 `0.0.7` 与 `v0.0.7`，安装包参数只填文件名。将安装包、`.sig`、免安装 zip 和清单放在同一个草稿 Release。
