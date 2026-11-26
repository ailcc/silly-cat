// 捣蛋奶牛猫桌宠：透明置顶窗口 + 全局键鼠监听 + 托盘菜单。前端直接用 ../prototype。
// 支持 macOS 和 Windows：全局输入和指针位置按平台拆开（macOS: tap.rs，Windows: win_input.rs），
// 对下面暴露同一组接口：start / input_monitoring_granted / KEY_TAP_ACTIVE / MOUSE_TAP_ACTIVE。
// 「键盘输入收不到、要提示授权」只有 macOS 有（tap::keyboard_state），见 input_status。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod autostart;
mod game_detect;
mod mcp;
mod music_detect;
mod privacy;
mod updater;

#[cfg(target_os = "macos")]
mod macos_window;
#[cfg(target_os = "macos")]
mod tap;
#[cfg(target_os = "macos")]
use tap as input;

#[cfg(target_os = "windows")]
mod win_input;
#[cfg(target_os = "windows")]
use win_input as input;

/// 其他平台（Linux 等）暂不支持全局输入：能编译、能显示猫，只是不跟着打字
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod input {
    use std::sync::atomic::AtomicBool;
    pub static KEY_TAP_ACTIVE: AtomicBool = AtomicBool::new(false);
    pub static MOUSE_TAP_ACTIVE: AtomicBool = AtomicBool::new(false);
    pub fn input_monitoring_granted() -> bool {
        false
    }
    pub fn start(_app: tauri::AppHandle) {}
}

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const MARGIN: f64 = 24.0;
// 和 tauri.conf.json 的 main 窗口一致，即 100% 时的逻辑尺寸。
const BASE_W: f64 = 420.0;
const BASE_H: f64 = 345.0;
// 和 prototype/settings.js 的 SIZE 一致。
const SIZE_MIN: f64 = 0.5;
const SIZE_MAX: f64 = 2.0;

/// 窗口左上角位置。macOS：全局坐标的「点」（逻辑像素）；Windows：虚拟桌面的物理像素
/// （Windows 各屏缩放可以不同，逻辑坐标在多屏下没有统一含义，所以存物理像素）。
#[derive(Serialize, Deserialize, Clone, Copy)]
struct SavedPos {
    x: f64,
    y: f64,
}

#[derive(Serialize)]
struct CursorInfo {
    /// 全局指针位置，前端只拿相邻两次的差值当 pointerMove。macOS：点；Windows：按窗口缩放系数换算的逻辑像素（累加得到，见下）
    gx: f64,
    gy: f64,
    /// 换算到窗口内容区的 CSS 像素（macOS = 点，Retina 下已经除过缩放系数；Windows = 物理像素差 / 窗口缩放系数）
    x: f64,
    y: f64,
}

#[derive(Serialize)]
struct InputStatus {
    /// 系统记录里的授权（macOS: CGPreflightListenEventAccess）。只作参考，签名对不上时不准
    granted: bool,
    keys: bool,
    mouse: bool,
    /// 键盘输入状态："ok" / "blocked"（收不到，要提示授权）/ "pending"（刚启动还没试）/ "unsupported"（不需要授权的平台）
    keyboard: &'static str,
    /// 要不要在猫旁边和设置窗口里提示处理授权：只有 macOS 上 keyboard == "blocked" 时为 true
    needs_permission: bool,
}

#[derive(Deserialize)]
struct HeldKey {
    code: String,
    #[cfg(target_os = "macos")]
    kc: u16,
}

#[derive(Serialize)]
struct HeldState {
    // None 表示这一类状态暂不可读。
    keys: Option<Vec<String>>,
    buttons: Vec<u8>,
}

#[tauri::command]
fn held_input_state(keys: Vec<HeldKey>, buttons: Vec<u8>) -> Result<HeldState, &'static str> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    { input::held_state(keys, buttons) }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (keys, buttons);
        Err("unsupported platform")
    }
}

/// 前端每 ~33ms 调一次：取全局指针位置并换算到窗口内，用来做命中判断和「移动鼠标」。不需要输入监控权限。
#[cfg(target_os = "macos")]
#[tauri::command]
fn cursor_local(window: WebviewWindow) -> Option<CursorInfo> {
    let p = tap::cursor_location()?;
    let scale = window.scale_factor().ok()?;
    let inner = window.inner_position().ok()?.to_logical::<f64>(scale);
    Some(CursorInfo { gx: p.x, gy: p.y, x: p.x - inner.x, y: p.y - inner.y })
}

/// Windows：GetCursorPos 和 inner_position 都是物理像素（进程 Per-Monitor V2 DPI 感知），
/// 先在物理像素里相减，再除以窗口当前所在屏的缩放系数，得到 WebView2 里的 CSS 像素。
/// gx/gy 不直接用「物理坐标 / 缩放」——窗口拖到另一块缩放不同的屏时那样会凭空跳一大截；
/// 改成把每次的物理位移按当时的缩放换算后累加，前端拿到的差值始终是逻辑像素，和 macOS 的「点」同一量级。
#[cfg(target_os = "windows")]
#[tauri::command]
fn cursor_local(window: WebviewWindow) -> Option<CursorInfo> {
    use std::sync::Mutex;
    /// 上一次的（物理位置，累加出的逻辑位置）
    type Last = Option<((i32, i32), (f64, f64))>;
    static LAST: Mutex<Last> = Mutex::new(None);
    let (px, py) = win_input::cursor_physical()?;
    let scale = window.scale_factor().ok()?;
    let inner = window.inner_position().ok()?;
    let mut last = LAST.lock().ok()?;
    let (gx, gy) = match *last {
        Some(((lx, ly), (gx, gy))) => (gx + (px - lx) as f64 / scale, gy + (py - ly) as f64 / scale),
        None => (px as f64 / scale, py as f64 / scale),
    };
    *last = Some(((px, py), (gx, gy)));
    Some(CursorInfo { gx, gy, x: (px - inner.x) as f64 / scale, y: (py - inner.y) as f64 / scale })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
fn cursor_local(window: WebviewWindow) -> Option<CursorInfo> {
    let p = window.cursor_position().ok()?;
    let scale = window.scale_factor().ok()?;
    let inner = window.inner_position().ok()?;
    Some(CursorInfo { gx: p.x / scale, gy: p.y / scale, x: (p.x - inner.x as f64) / scale, y: (p.y - inner.y as f64) / scale })
}

#[tauri::command]
fn input_status() -> InputStatus {
    #[cfg(target_os = "macos")]
    let keyboard = match tap::keyboard_state() {
        tap::KeyboardState::Ok => "ok",
        tap::KeyboardState::Blocked => "blocked",
        tap::KeyboardState::Pending => "pending",
    };
    #[cfg(not(target_os = "macos"))]
    let keyboard = "unsupported";
    InputStatus {
        granted: input::input_monitoring_granted(),
        keys: input::KEY_TAP_ACTIVE.load(Ordering::SeqCst),
        mouse: input::MOUSE_TAP_ACTIVE.load(Ordering::SeqCst),
        keyboard,
        needs_permission: cfg!(target_os = "macos") && keyboard == "blocked",
    }
}

/// 设置窗口「打开输入监控设置」
#[tauri::command]
fn open_input_monitoring() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        open_input_monitoring_settings();
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    Err("只有 macOS 需要输入监控授权".into())
}

/// 设置窗口「重置授权」：只能由用户点按钮触发。
/// 清掉本应用自己的输入监控记录（`tccutil reset ListenEvent <本应用标识>`，不碰别的应用和别的权限），
/// 再申请一次授权，并打开输入监控设置页。适用于「列表里开着但收不到按键」——授权记录绑的是旧版本的签名。
/// 进程里对授权结果有缓存，这次申请不一定能让系统重新弹窗 / 把应用加回列表，所以设置页同时给「重新启动」按钮。
#[tauri::command]
fn reset_input_monitoring(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let id = app.config().identifier.clone();
        let out = std::process::Command::new("/usr/bin/tccutil")
            .args(["reset", "ListenEvent", id.as_str()])
            .output()
            .map_err(|e| format!("运行 tccutil 失败：{e}"))?;
        if !out.status.success() {
            let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if msg.is_empty() { format!("tccutil 退出码 {:?}", out.status.code()) } else { msg });
        }
        tap::request_input_monitoring();
        open_input_monitoring_settings();
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("只有 macOS 需要输入监控授权".into())
    }
}

/// 设置窗口「重新启动 SillyCat」：授权变了以后进程里的结果可能要重启才更新
#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

fn settings_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

/// 读已保存的设置（没有或读坏了返回 null，前端用默认值）。字段和校验在前端（settings.js）
#[tauri::command]
fn load_settings(app: AppHandle) -> Option<serde_json::Value> {
    let s = std::fs::read_to_string(settings_file(&app)?).ok()?;
    serde_json::from_str::<serde_json::Value>(&s).ok().filter(|v| v.is_object())
}

fn cat_size_of(settings: &serde_json::Value) -> f64 {
    settings["size"]
        .as_f64()
        .filter(|size| size.is_finite() && (SIZE_MIN..=SIZE_MAX).contains(size))
        .unwrap_or(1.0)
}

/// 用物理像素固定右下角，缩放时只移动左上角。
fn apply_cat_size(win: &WebviewWindow, size: f64) {
    let Ok(k) = win.scale_factor() else { return };
    let target = PhysicalSize::new(
        (BASE_W * size * k).round() as u32,
        (BASE_H * size * k).round() as u32,
    );
    let Ok(current) = win.outer_size() else { return };
    if current.width.abs_diff(target.width) <= 1 && current.height.abs_diff(target.height) <= 1 {
        return;
    }
    let Ok(pos) = win.outer_position() else { return };
    let top_left = PhysicalPosition::new(
        pos.x + (current.width as i32 - target.width as i32),
        pos.y + (current.height as i32 - target.height as i32),
    );
    if win.set_size(target).is_ok() {
        let _ = win.set_position(top_left);
    }
}

/// 拖动滑块时只调整主窗口大小，设置由 save_settings 写盘和广播。
#[tauri::command]
fn preview_cat_size(app: AppHandle, size: f64) {
    if !size.is_finite() || !(SIZE_MIN..=SIZE_MAX).contains(&size) {
        return;
    }
    if let Some(win) = app.get_webview_window("main") {
        apply_cat_size(&win, size);
    }
}

/// 设置页每次改出合法值就调：写盘，再通知主窗口立即生效
#[tauri::command]
fn save_settings(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    if !settings.is_object() {
        return Err("settings 必须是对象".into());
    }
    let f = settings_file(&app).ok_or("找不到配置目录")?;
    if let Some(dir) = f.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&f, text).map_err(|e| e.to_string())?;
    if let Some(win) = app.get_webview_window("main") {
        apply_cat_size(&win, cat_size_of(&settings));
    }
    updater::set_auto(&app, &settings);
    mcp::update_state(&settings); // MCP 外观接口的开关 / 端口跟着设置走
    let _ = app.emit_to("main", "silly:settings", settings);
    Ok(())
}

/// 打开设置窗口；已经开着就带到前面。同步 command 在主线程跑，连点两次也只会建一个窗口
#[tauri::command]
fn open_settings(app: AppHandle) {
    show_settings(&app);
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn open_link(target: String) -> Result<(), String> {
    // 和 settings.html 的 #about-links 对应：github = 本项目（增强版仓库），origin = 原作者仓库
    let url = match target.as_str() {
        "github" => "https://github.com/ailcc/silly-cat",
        "origin" => "https://github.com/S0u1/silly-cat",
        _ => return Err("未知链接".into()),
    };
    updater::open_in_browser(url).map_err(|err| err.to_string())
}

struct PositionLock {
    locked: AtomicBool,
    tray_item: CheckMenuItem<tauri::Wry>,
}

#[derive(Serialize, Deserialize, Default)]
struct SavedLock {
    locked: bool,
}

fn lock_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("window-lock.json"))
}

fn load_lock(app: &AppHandle) -> Option<SavedLock> {
    let data = std::fs::read(lock_file(app)?).ok()?;
    serde_json::from_slice(&data).ok()
}

fn save_lock(app: &AppHandle, locked: bool) -> Result<(), Box<dyn std::error::Error>> {
    let path = lock_file(app).ok_or("找不到配置目录")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_vec(&SavedLock { locked })?)?;
    std::fs::rename(temp, path)?;
    Ok(())
}

#[tauri::command]
fn position_locked(app: AppHandle) -> bool {
    app.state::<PositionLock>().locked.load(Ordering::SeqCst)
}

/// 托盘和右键共用菜单内容，前缀区分两个原生菜单里的项目。
fn build_cat_menu(
    app: &AppHandle,
    prefix: &str,
    locked: bool,
) -> tauri::Result<(Menu<tauri::Wry>, CheckMenuItem<tauri::Wry>)> {
    let item = |id, label| MenuItem::with_id(app, format!("{prefix}{id}"), label, true, None::<&str>);
    let lock = CheckMenuItem::with_id(
        app,
        format!("{prefix}lock"),
        "锁定位置",
        true,
        locked,
        None::<&str>,
    )?;
    let menu = Menu::with_items(
        app,
        &[
            &item("prefs", "设置…")?,
            &item("check-update", "检查更新…")?,
            &item("toggle", "显示/隐藏猫")?,
            &lock,
            &item("reset", "重置位置")?,
        ],
    )?;
    #[cfg(target_os = "macos")]
    menu.append(&item("settings", "打开输入监控设置")?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&item("quit", "退出")?)?;
    Ok((menu, lock))
}

/// 右键猫（或键盘、鼠标等有画面的地方）：在指针位置弹出和托盘内容相同的原生菜单。
///
/// 写成 async command：在后台线程里跑，Tauri 的 `popup_menu` 自己把弹出动作派到主线程的事件循环里执行
/// （macOS 的 NSMenu、Windows 的 TrackPopupMenu 都是模态的，会一直等到菜单关掉才返回）。
/// 不放在同步 command 里，是为了不在 WebView2 / WKWebView 的 IPC 回调里嵌套模态消息循环。
/// 弹出位置用 `popup_menu`（不传坐标）＝当前指针位置：macOS 取 NSEvent.mouseLocation，Windows 取 GetCursorPos，
/// 都由 muda 自己处理缩放，不经过前端坐标换算。
/// 菜单项的 id 带 `ctx-` 前缀；Tauri 的菜单事件是全局的，统一在 `handle_menu_event` 里处理，和托盘菜单共用一套逻辑。
#[tauri::command]
async fn show_context_menu(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let locked = position_locked(app.clone());
    let (menu, _) = build_cat_menu(&app, "ctx-", locked).map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

/// 所有菜单（托盘菜单 + 右键菜单）的事件都走这里：Tauri 的菜单事件是应用级的，托盘的 on_menu_event 也会收到右键菜单的事件
fn handle_menu_event(app: &AppHandle, id: &str) {
    let id = id.strip_prefix("ctx-").unwrap_or(id);
    match id {
        "prefs" => show_settings(app),
        "check-update" => {
            show_settings(app);
            updater::manual_check(app.clone());
        }
        "lock" => {
            let state = app.state::<PositionLock>();
            let locked = !state.locked.fetch_xor(true, Ordering::SeqCst);
            if let Err(e) = save_lock(app, locked) {
                eprintln!("[silly-cat] 保存位置锁定失败：{e}");
            }
            // 原生菜单可能自行切换勾选，以 Rust 状态为准。右键菜单会在下次打开时重建。
            let _ = state.tray_item.set_checked(locked);
            let _ = app.emit_to("main", "silly:lock", locked);
        }
        "quit" => app.exit(0),
        _ => {
            let Some(win) = app.get_webview_window("main") else { return };
            match id {
                "toggle" => {
                    if win.is_visible().unwrap_or(true) {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                    }
                }
                "reset" => {
                    let p = default_pos(&win);
                    place(&win, p);
                    save_pos(app, p);
                    let _ = win.show();
                }
                #[cfg(target_os = "macos")]
                "settings" => open_input_monitoring_settings(),
                _ => {}
            }
        }
    }
}

/// 设置窗口的默认高度，和 settings.html 的 BASE_H 一致。留一点字体换行余量，授权提示显示时由页面加高。
const SETTINGS_HEIGHT: f64 = 1288.0;

fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let monitor = app.get_webview_window("main")
        .and_then(|win| win.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let height = monitor.map_or(SETTINGS_HEIGHT, |m| {
        let work_height = m.work_area().size.to_logical::<f64>(m.scale_factor()).height;
        SETTINGS_HEIGHT.min((work_height - 40.0).max(1.0))
    });
    let built = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("捣蛋猫 · 设置")
        .inner_size(400.0, height)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .center()
        .focused(true)
        .build();
    if let Ok(w) = built {
        // macOS：Accessory 应用默认不是前台应用，激活一下设置窗口才能成为键盘焦点窗口。
        // Windows：这一步来自用户刚点过的托盘菜单 / 猫窗口，系统允许本进程把新窗口带到前台
        let _ = w.set_focus();
    }
}

fn pos_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("window-position.json"))
}

fn load_pos(app: &AppHandle) -> Option<SavedPos> {
    let s = std::fs::read_to_string(pos_file(app)?).ok()?;
    serde_json::from_str(&s).ok()
}

fn save_pos(app: &AppHandle, p: SavedPos) {
    let Some(f) = pos_file(app) else { return };
    if let Some(dir) = f.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(s) = serde_json::to_string(&p) {
        let _ = std::fs::write(f, s);
    }
}

/// 主屏右下角（避开 Dock / 菜单栏）
#[cfg(not(target_os = "windows"))]
fn default_pos(win: &WebviewWindow) -> SavedPos {
    let size = logical_size(win);
    if let Ok(Some(m)) = win.primary_monitor() {
        let k = m.scale_factor();
        let wa = m.work_area();
        let pos = wa.position.to_logical::<f64>(k);
        let sz = wa.size.to_logical::<f64>(k);
        return SavedPos { x: pos.x + sz.width - size.width - MARGIN, y: pos.y + sz.height - size.height - MARGIN };
    }
    SavedPos { x: 200.0, y: 200.0 }
}

/// 保存的位置至少有一块（窗口中心）还落在某块屏幕上才用，不然退回默认位置
#[cfg(not(target_os = "windows"))]
fn on_some_screen(win: &WebviewWindow, p: SavedPos) -> bool {
    let Ok(monitors) = win.available_monitors() else { return false };
    let size = logical_size(win);
    let (cx, cy) = (p.x + size.width / 2.0, p.y + size.height / 2.0);
    monitors.iter().any(|m| {
        let k = m.scale_factor();
        let pos = m.position().to_logical::<f64>(k);
        let sz = m.size().to_logical::<f64>(k);
        cx >= pos.x && cx <= pos.x + sz.width && cy >= pos.y && cy <= pos.y + sz.height
    })
}

#[cfg(not(target_os = "windows"))]
fn place(win: &WebviewWindow, p: SavedPos) {
    let _ = win.set_position(tauri::LogicalPosition::new(p.x, p.y));
}

/// 窗口 Moved 事件给的物理位置 -> 要保存的位置
#[cfg(not(target_os = "windows"))]
fn moved_pos(win: &WebviewWindow, pos: PhysicalPosition<i32>) -> Option<SavedPos> {
    let l = pos.to_logical::<f64>(win.scale_factor().ok()?);
    Some(SavedPos { x: l.x, y: l.y })
}

/// 窗口当前的逻辑尺寸，取不到时按 100% 算。
fn logical_size(win: &WebviewWindow) -> tauri::LogicalSize<f64> {
    win.outer_size()
        .ok()
        .zip(win.scale_factor().ok())
        .map(|(s, k)| s.to_logical::<f64>(k))
        .unwrap_or(tauri::LogicalSize::new(BASE_W, BASE_H))
}

/// Windows：主屏工作区（已扣掉任务栏，任务栏在哪条边都行）右下角，全部按物理像素算；
/// 窗口尺寸和边距按主屏的缩放系数换算——窗口放过去后就是那块屏的缩放
#[cfg(target_os = "windows")]
fn default_pos(win: &WebviewWindow) -> SavedPos {
    let size = logical_size(win);
    if let Ok(Some(m)) = win.primary_monitor() {
        let k = m.scale_factor();
        let wa = m.work_area();
        let x = wa.position.x as f64 + wa.size.width as f64 - (size.width + MARGIN) * k;
        let y = wa.position.y as f64 + wa.size.height as f64 - (size.height + MARGIN) * k;
        return SavedPos { x: x.round(), y: y.round() };
    }
    SavedPos { x: 200.0, y: 200.0 }
}

/// Windows：窗口中心（物理像素）落在某块屏幕上才用保存的位置
#[cfg(target_os = "windows")]
fn on_some_screen(win: &WebviewWindow, p: SavedPos) -> bool {
    let Ok(monitors) = win.available_monitors() else { return false };
    let size = logical_size(win);
    monitors.iter().any(|m| {
        let k = m.scale_factor();
        let (cx, cy) = (p.x + size.width * k / 2.0, p.y + size.height * k / 2.0);
        let pos = m.position();
        let sz = m.size();
        cx >= pos.x as f64 && cx <= (pos.x + sz.width as i32) as f64 && cy >= pos.y as f64 && cy <= (pos.y + sz.height as i32) as f64
    })
}

#[cfg(target_os = "windows")]
fn place(win: &WebviewWindow, p: SavedPos) {
    let _ = win.set_position(PhysicalPosition::new(p.x.round() as i32, p.y.round() as i32));
}

#[cfg(target_os = "windows")]
fn moved_pos(_win: &WebviewWindow, pos: PhysicalPosition<i32>) -> Option<SavedPos> {
    Some(SavedPos { x: pos.x as f64, y: pos.y as f64 })
}

static MOVE_GEN: AtomicU64 = AtomicU64::new(0);

/// 窗口移动后 400ms 没再动才写盘（拖动过程中 Moved 一秒几十次）
fn schedule_save(app: AppHandle, p: SavedPos) {
    let gen = MOVE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        if MOVE_GEN.load(Ordering::SeqCst) == gen {
            save_pos(&app, p);
        }
    });
}

#[cfg(target_os = "macos")]
fn open_input_monitoring_settings() {
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
        .spawn();
}

/// 截猫表情包：前端把 PNG（base64）交过来，解码后写进系统剪贴板，全程不落任何文件
#[tauri::command]
fn copy_snapshot(app: AppHandle, data: String) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use tauri::image::Image;
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let bytes = STANDARD.decode(data.trim()).map_err(|e| format!("图片数据无效：{e}"))?;
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder.read_info().map_err(|e| format!("图片解码失败：{e}"))?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader
        .next_frame(&mut buf)
        .map_err(|e| format!("图片解码失败：{e}"))?;
    app.clipboard()
        .write_image(&Image::new_owned(
            buf[..info.buffer_size()].to_vec(),
            info.width,
            info.height,
        ))
        .map_err(|e| format!("写入剪贴板失败：{e}"))
}

fn main() {
    tauri::Builder::default()
        // 单实例必须最先注册：第二个进程启动时立即退出，并把参数转给第一个实例
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 再次启动时把已有的猫带出来（可能被「显示/隐藏猫」藏起来了）
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            cursor_local,
            held_input_state,
            input_status,
            open_input_monitoring,
            reset_input_monitoring,
            restart_app,
            load_settings,
            preview_cat_size,
            save_settings,
            open_settings,
            app_version,
            open_link,
            autostart::autostart_status,
            autostart::set_autostart,
            #[cfg(target_os = "macos")]
            autostart::open_login_items,
            position_locked,
            show_context_menu,
            copy_snapshot,
            updater::check_update,
            updater::install_update,
            updater::updater_configured,
            updater::update_status,
            music_detect::user_music_active
        ])
        .setup(|app| {
            updater::setup(app.handle());
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let locked = load_lock(app.handle()).unwrap_or_default().locked;
            let (menu, tray_item) = build_cat_menu(app.handle(), "", locked)?;
            app.manage(PositionLock {
                locked: AtomicBool::new(locked),
                tray_item,
            });

            let win = app.get_webview_window("main").expect("main window");
            // 先恢复大小，屏幕检查和默认位置才能用缩放后的尺寸。
            let size = load_settings(app.handle().clone()).as_ref().map_or(1.0, cat_size_of);
            if size != 1.0 {
                let _ = win.set_size(tauri::LogicalSize::new(BASE_W * size, BASE_H * size));
            }
            let start = load_pos(app.handle()).filter(|p| on_some_screen(&win, *p)).unwrap_or_else(|| default_pos(&win));
            place(&win, start);
            // 全屏行为配置失败时只记日志，猫照常显示（只是可能进不了别的应用的全屏 Space）。
            #[cfg(target_os = "macos")]
            {
                if let Err(e) = macos_window::configure_cat(&win) {
                    eprintln!("[silly-cat] 设置跨全屏窗口行为失败：{e}");
                }
            }
            let _ = win.show();

            // 拖动后记住位置
            let handle = app.handle().clone();
            let w2 = win.clone();
            win.on_window_event(move |e| {
                if let WindowEvent::Moved(pos) = e {
                    if let Some(p) = moved_pos(&w2, *pos) {
                        schedule_save(handle.clone(), p);
                    }
                }
            });

            // 托盘菜单
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("捣蛋奶牛猫")
                .menu(&menu)
                .show_menu_on_left_click(true)
                // 这个处理函数是应用级的：托盘菜单和右键菜单（show_context_menu）的事件都会到这里
                .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()));
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            input::start(app.handle().clone());
            // 游戏模式：后台轮询前台窗口，发现全屏游戏就通知前端（猫戴耳机睡觉）
            game_detect::start(app.handle().clone());
            // 用户听歌：后台轮询进程列表，发现音乐软件就通知前端（猫戴耳机陪着，软件退出才摘）
            music_detect::start(app.handle().clone());
            // 密码隐私模式：焦点进密码框就通知前端（猫捂眼不看）
            privacy::start(app.handle().clone());
            // MCP 外观接口：本地回环 HTTP 服务（设置里默认关，开了才放行请求）
            if let Some(f) = settings_file(app.handle()) {
                mcp::setup(app.handle().clone(), f);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running silly-cat");
}
