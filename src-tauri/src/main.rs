// 捣蛋奶牛猫桌宠：透明置顶窗口 + 全局键鼠监听 + 托盘菜单。前端直接用 ../prototype。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod tap;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, LogicalPosition, Manager, WebviewWindow, WindowEvent};

const MARGIN: f64 = 24.0;

#[derive(Serialize, Deserialize, Clone, Copy)]
struct SavedPos {
    x: f64,
    y: f64,
}

#[derive(Serialize)]
struct CursorInfo {
    /// 全局指针位置（点）
    gx: f64,
    gy: f64,
    /// 换算到窗口内容区的 CSS 像素（= 点，Retina 下已经除过缩放系数）
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
#[tauri::command]
fn cursor_local(window: WebviewWindow) -> Option<CursorInfo> {
    let p = tap::cursor_location()?;
    let scale = window.scale_factor().ok()?;
    let inner = window.inner_position().ok()?.to_logical::<f64>(scale);
    Some(CursorInfo { gx: p.x, gy: p.y, x: p.x - inner.x, y: p.y - inner.y })
}

#[tauri::command]
fn input_status() -> InputStatus {
    InputStatus {
        granted: tap::input_monitoring_granted(),
        keys: tap::KEY_TAP_ACTIVE.load(Ordering::SeqCst),
        mouse: tap::MOUSE_TAP_ACTIVE.load(Ordering::SeqCst),
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

fn place(win: &WebviewWindow, p: SavedPos) {
    let _ = win.set_position(LogicalPosition::new(p.x, p.y));
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

fn open_input_monitoring_settings() {
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
        .spawn();
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![cursor_local, input_status])
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
                    if let Ok(k) = w2.scale_factor() {
                        let l = pos.to_logical::<f64>(k);
                        schedule_save(handle.clone(), SavedPos { x: l.x, y: l.y });
                    }
                }
            });

            // 托盘菜单
            let toggle = MenuItem::with_id(app, "toggle", "显示/隐藏猫", true, None::<&str>)?;
            let reset = MenuItem::with_id(app, "reset", "重置位置", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "打开输入监控设置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&toggle, &reset, &settings, &sep, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("捣蛋奶牛猫")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| {
                    let Some(win) = app.get_webview_window("main") else { return };
                    match event.id().as_ref() {
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
                        "settings" => open_input_monitoring_settings(),
                        "quit" => app.exit(0),
                        _ => {}
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            tap::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running silly-cat");
}
