// 捣蛋奶牛猫桌宠：透明置顶窗口 + 全局键鼠监听 + 托盘菜单。前端直接用 ../prototype。
// 支持 macOS 和 Windows：全局输入和指针位置按平台拆开（macOS: tap.rs，Windows: win_input.rs），
// 对下面暴露同一组接口：start / input_monitoring_granted / KEY_TAP_ACTIVE / MOUSE_TAP_ACTIVE。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const MARGIN: f64 = 24.0;

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
    granted: bool,
    keys: bool,
    mouse: bool,
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
    InputStatus {
        granted: input::input_monitoring_granted(),
        keys: input::KEY_TAP_ACTIVE.load(Ordering::SeqCst),
        mouse: input::MOUSE_TAP_ACTIVE.load(Ordering::SeqCst),
    }
}

fn settings_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

/// 读已保存的时间参数（没有或读坏了返回 null，前端用默认值）。字段和校验在前端（settings.js）
#[tauri::command]
fn load_settings(app: AppHandle) -> Option<serde_json::Value> {
    let s = std::fs::read_to_string(settings_file(&app)?).ok()?;
    serde_json::from_str::<serde_json::Value>(&s).ok().filter(|v| v.is_object())
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
    let _ = app.emit_to("main", "silly:settings", settings);
    Ok(())
}

/// 打开设置窗口；已经开着就带到前面。同步 command 在主线程跑，连点两次也只会建一个窗口
#[tauri::command]
fn open_settings(app: AppHandle) {
    show_settings(&app);
}

/// 右键猫（或键盘、鼠标等有画面的地方）：在指针位置弹出原生右键菜单「设置… / 退出」。
///
/// 写成 async command：在后台线程里跑，Tauri 的 `popup_menu` 自己把弹出动作派到主线程的事件循环里执行
/// （macOS 的 NSMenu、Windows 的 TrackPopupMenu 都是模态的，会一直等到菜单关掉才返回）。
/// 不放在同步 command 里，是为了不在 WebView2 / WKWebView 的 IPC 回调里嵌套模态消息循环。
/// 弹出位置用 `popup_menu`（不传坐标）＝当前指针位置：macOS 取 NSEvent.mouseLocation，Windows 取 GetCursorPos，
/// 都由 muda 自己处理缩放，不经过前端坐标换算。
/// 菜单项的 id 带 `ctx-` 前缀；Tauri 的菜单事件是全局的，统一在 `handle_menu_event` 里处理，和托盘菜单共用一套逻辑。
#[tauri::command]
async fn show_context_menu(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let prefs = MenuItem::with_id(&app, MENU_CTX_PREFS, "设置…", true, None::<&str>).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(&app, MENU_CTX_QUIT, "退出", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&app, &[&prefs, &quit]).map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

const MENU_CTX_PREFS: &str = "ctx-prefs";
const MENU_CTX_QUIT: &str = "ctx-quit";

/// 所有菜单（托盘菜单 + 右键菜单）的事件都走这里：Tauri 的菜单事件是应用级的，托盘的 on_menu_event 也会收到右键菜单的事件
fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "prefs" | MENU_CTX_PREFS => show_settings(app),
        "quit" | MENU_CTX_QUIT => app.exit(0),
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

fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("捣蛋奶牛猫 · 设置")
        .inner_size(400.0, 620.0)
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
    let size = win
        .outer_size()
        .ok()
        .zip(win.scale_factor().ok())
        .map(|(s, k)| s.to_logical::<f64>(k))
        .unwrap_or(tauri::LogicalSize::new(420.0, 345.0));
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
    let (cx, cy) = (p.x + 210.0, p.y + 172.0);
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

/// 窗口的逻辑尺寸（配置里是 420×345）
#[cfg(target_os = "windows")]
fn logical_size(win: &WebviewWindow) -> tauri::LogicalSize<f64> {
    win.outer_size()
        .ok()
        .zip(win.scale_factor().ok())
        .map(|(s, k)| s.to_logical::<f64>(k))
        .unwrap_or(tauri::LogicalSize::new(420.0, 345.0))
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            cursor_local,
            input_status,
            load_settings,
            save_settings,
            open_settings,
            show_context_menu
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let win = app.get_webview_window("main").expect("main window");
            let start = load_pos(app.handle()).filter(|p| on_some_screen(&win, *p)).unwrap_or_else(|| default_pos(&win));
            place(&win, start);
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
            let prefs = MenuItem::with_id(app, "prefs", "设置…", true, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", "显示/隐藏猫", true, None::<&str>)?;
            let reset = MenuItem::with_id(app, "reset", "重置位置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            // 「打开输入监控设置」只有 macOS 有（Windows 不需要授权）
            #[cfg(target_os = "macos")]
            let menu = {
                let settings = MenuItem::with_id(app, "settings", "打开输入监控设置", true, None::<&str>)?;
                Menu::with_items(app, &[&prefs, &toggle, &reset, &settings, &sep, &quit])?
            };
            #[cfg(not(target_os = "macos"))]
            let menu = Menu::with_items(app, &[&prefs, &toggle, &reset, &sep, &quit])?;
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running silly-cat");
}
