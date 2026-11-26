捣蛋猫 兼容版 · Windows x64

原版装不上或提示缺少 WebView2 时，可以使用这个版本。使用安装包时按向导完成当前用户安装；使用 zip 时先完整解压，再双击 SillyCatElectronDemo.exe。

点击托盘里的猫图标，或右键桌面上的猫，可以打开设置、检查更新、隐藏猫、锁定位置或退出。按住身体可以拖动，按住头部可以摸猫。

遇到白底或显示异常时，先退出猫，然后用下面的脚本对比：
  start-no-gpu.bat        关闭 GPU 加速
  start-debug.bat         显示窗口边框并记录键鼠累计次数
  start-debug-no-gpu.bat  同时启用上述两项

运行日志 silly-cat.log 和安装日志 install.log 位于 %APPDATA%\SillyCatElectronDemo\。
点击菜单里的「打开日志文件夹」，或把上面的目录粘贴进资源管理器地址栏。
启动失败或崩溃时，桌面会生成「捣蛋猫兼容版-错误日志.txt」；安装失败则生成「捣蛋猫兼容版-安装日志.txt」。
反馈时请附上错误提示和对应的日志，以及 Windows 版本。桌面不可写时可从日志文件夹取回日志。
