use objc2::MainThreadMarker;
use objc2_app_kit::{NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior as Behavior};
use tauri::WebviewWindow;

pub fn configure_cat(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    // setup 在 AppKit 主线程上运行；首次 show 前同步完成配置。
    let _main_thread = MainThreadMarker::new().ok_or("cat window setup requires main thread")?;
    let always_on_top = window.is_always_on_top()?;
    let ptr = window.ns_window()?.cast::<NSWindow>();
    // SAFETY: Tauri 提供此存活窗口的 NSWindow 指针，只在当前主线程调用中借用。
    let native = unsafe { ptr.as_ref() }.ok_or("missing native cat window")?;

    let mut behavior = native.collectionBehavior();
    behavior.remove(
        Behavior::MoveToActiveSpace
            | Behavior::Managed
            | Behavior::Transient
            | Behavior::FullScreenPrimary
            | Behavior::FullScreenAuxiliary
            | Behavior::FullScreenNone
            | Behavior::Primary
            | Behavior::Auxiliary,
    );
    // macOS 13+ 的跨应用浮窗角色允许加入其他应用的原生全屏 Space。
    behavior.insert(
        Behavior::CanJoinAllSpaces | Behavior::Stationary | Behavior::CanJoinAllApplications,
    );
    native.setCollectionBehavior(behavior);
    if always_on_top {
        native.setLevel(NSStatusWindowLevel);
    }
    Ok(())
}
