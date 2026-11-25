//! 密码隐私模式（默认开启）：140ms 一次看一眼前台焦点，落在密码框里就把「silly:privacy」
//! 事件发给前端——猫闭上眼睛、抬起两只前爪捂住脸，绝不偷看密码；焦点离开再放下爪子
//! （连续 2 个周期 ≈280ms 的防抖，登录框里焦点闪一下不会让猫一惊一乍）。
//!
//! - Windows：UI Automation 的 IsPassword（浏览器 / Electron / WPF / UAC 都支持），
//!   外加经典 Win32 的 ES_PASSWORD 兜底；对第三方 UIA 误报做了 Edit 类型 + 高度校验。
//! - macOS：Carbon 的 IsSecureEventInputEnabled（系统级安全输入）+ 辅助功能的
//!   AXSecureTextField 子角色；没有辅助功能权限时 AXIsProcessTrusted 为 false，
//!   检测静默禁用（猫只是不知道你在输密码，不会报错）。
//! - 只读焦点元素的「是否密码框」属性，不碰键盘输入，不影响任何应用。

use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct PrivacyPayload {
    pub active: bool,
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        #[cfg(windows)]
        let uia = win_impl::UiaDetector::new();

        let mut active = false;
        let mut clear_streak: u8 = 0;

        loop {
            std::thread::sleep(Duration::from_millis(140));

            #[cfg(windows)]
            let is_pwd = win_impl::is_focused_password_field(uia.as_ref());
            #[cfg(target_os = "macos")]
            let is_pwd = mac_impl::is_focused_password_field();
            #[cfg(all(not(windows), not(target_os = "macos")))]
            let is_pwd = false;

            if is_pwd {
                clear_streak = 0;
                if !active {
                    active = true;
                    let _ = app.emit_to("main", "silly:privacy", PrivacyPayload { active: true });
                }
            } else if active {
                clear_streak = clear_streak.saturating_add(1);
                if clear_streak >= 2 {
                    active = false;
                    clear_streak = 0;
                    let _ = app.emit_to("main", "silly:privacy", PrivacyPayload { active: false });
                }
            }
        }
    });
}

#[cfg(windows)]
mod win_impl {
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, UIA_EditControlTypeId};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetGUIThreadInfo, GetWindowLongPtrW,
        GetWindowThreadProcessId, GUITHREADINFO, GWL_STYLE,
    };

    const ES_MULTILINE: isize = 0x0004;
    const ES_PASSWORD: isize = 0x0020;
    const MAX_PASSWORD_BOX_HEIGHT_PX: i32 = 140;

    pub(super) fn is_plausible_password_rect(top: i32, bottom: i32) -> bool {
        let h = bottom.saturating_sub(top);
        // 真实的单行密码框高度在 8–140px 之间；排除 0px 的坏代理和整篇文档画布（WPS / Word 等）
        (8..=MAX_PASSWORD_BOX_HEIGHT_PX).contains(&h)
    }

    pub(super) fn is_classic_edit_class(class_name: &str) -> bool {
        let lower = class_name.to_ascii_lowercase();
        lower == "edit"
            || lower.starts_with("richedit")
            || lower == "tedit"
            || lower == "tmaskedit"
            || lower == "wedit"
            || (lower.starts_with("thunder") && lower.contains("textbox"))
    }

    pub struct UiaDetector {
        uia: IUIAutomation,
        com_inited: bool,
    }

    impl UiaDetector {
        pub fn new() -> Option<Self> {
            unsafe {
                let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
                let com_inited = hr.is_ok();
                let uia: IUIAutomation =
                    CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
                Some(Self { uia, com_inited })
            }
        }

        pub fn focused_is_password(&self) -> bool {
            unsafe {
                let Ok(el) = self.uia.GetFocusedElement() else { return false };
                let is_pwd = match el.CurrentIsPassword() {
                    Ok(b) => b.as_bool(),
                    Err(_) => false,
                };
                if !is_pwd {
                    return false;
                }
                // 防第三方 UIA/MSAA 代理误报（如 Win7 上的 WPS 把文档报成 IsPassword）：
                // 真密码框一定是 Edit 类型、单行高度
                let Ok(ctrl_type) = el.CurrentControlType() else { return false };
                if ctrl_type != UIA_EditControlTypeId {
                    return false;
                }
                let Ok(rc) = el.CurrentBoundingRectangle() else { return false };
                if !is_plausible_password_rect(rc.top, rc.bottom) {
                    return false;
                }
                true
            }
        }
    }

    impl Drop for UiaDetector {
        fn drop(&mut self) {
            if self.com_inited {
                unsafe { CoUninitialize() };
            }
        }
    }

    fn classic_win32_is_password() -> bool {
        unsafe {
            let fg = GetForegroundWindow();
            if fg.is_null() {
                return false;
            }
            let mut pid: u32 = 0;
            let tid = GetWindowThreadProcessId(fg, &mut pid);
            if tid == 0 {
                return false;
            }
            let mut info: GUITHREADINFO = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
            if GetGUIThreadInfo(tid, &mut info) == 0 || info.hwndFocus.is_null() {
                return false;
            }
            // ES_PASSWORD 只在 Edit / RichEdit 窗口类上有意义；其他控件上这一位是别的含义，
            // 会把猫永远锁在捂眼状态
            let mut cls_buf = [0u16; 128];
            let cls_len = GetClassNameW(info.hwndFocus, cls_buf.as_mut_ptr(), cls_buf.len() as i32);
            if cls_len <= 0 {
                return false;
            }
            let cls_name = String::from_utf16_lossy(&cls_buf[..cls_len as usize]);
            if !is_classic_edit_class(&cls_name) {
                return false;
            }
            let style = GetWindowLongPtrW(info.hwndFocus, GWL_STYLE);
            (style & ES_PASSWORD) != 0 && (style & ES_MULTILINE) == 0
        }
    }

    pub fn is_focused_password_field(uia: Option<&UiaDetector>) -> bool {
        if classic_win32_is_password() {
            return true;
        }
        if let Some(det) = uia {
            return det.focused_is_password();
        }
        false
    }
}

#[cfg(target_os = "macos")]
mod mac_impl {
    use std::ffi::c_void;

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn IsSecureEventInputEnabled() -> u8;
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXUIElementCreateSystemWide() -> *mut c_void;
        fn AXUIElementCopyAttributeValue(
            element: *mut c_void,
            attribute: *const c_void,
            value: *mut *mut c_void,
        ) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
        fn CFStringCreateWithBytes(
            alloc: *const c_void,
            bytes: *const u8,
            num_bytes: isize,
            encoding: u32,
            is_external_rep: u8,
        ) -> *mut c_void;
        fn CFGetTypeID(cf: *const c_void) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFEqual(cf1: *const c_void, cf2: *const c_void) -> u8;
    }

    unsafe fn make_cf_string(s: &str) -> *mut c_void {
        CFStringCreateWithBytes(
            std::ptr::null(),
            s.as_ptr(),
            s.len() as isize,
            K_CF_STRING_ENCODING_UTF8,
            0,
        )
    }

    unsafe fn ax_focused_is_secure_text_field() -> bool {
        if !AXIsProcessTrusted() {
            return false; // 没有辅助功能权限：静默禁用（猫不检测，也不打扰）
        }
        let sys_wide = AXUIElementCreateSystemWide();
        if sys_wide.is_null() {
            return false;
        }
        let attr_focused = make_cf_string("AXFocusedUIElement");
        let attr_subrole = make_cf_string("AXSubrole");
        let secure_subrole = make_cf_string("AXSecureTextField");

        let mut is_secure = false;
        if !attr_focused.is_null() && !attr_subrole.is_null() && !secure_subrole.is_null() {
            let mut focused: *mut c_void = std::ptr::null_mut();
            let err1 = AXUIElementCopyAttributeValue(sys_wide, attr_focused, &mut focused);
            if err1 == 0 && !focused.is_null() {
                let mut subrole: *mut c_void = std::ptr::null_mut();
                let err2 = AXUIElementCopyAttributeValue(focused, attr_subrole, &mut subrole);
                if err2 == 0 && !subrole.is_null() {
                    if CFGetTypeID(subrole) == CFStringGetTypeID()
                        && CFEqual(subrole, secure_subrole) != 0
                    {
                        is_secure = true;
                    }
                    CFRelease(subrole);
                }
                CFRelease(focused);
            }
        }

        if !secure_subrole.is_null() {
            CFRelease(secure_subrole);
        }
        if !attr_subrole.is_null() {
            CFRelease(attr_subrole);
        }
        if !attr_focused.is_null() {
            CFRelease(attr_focused);
        }
        CFRelease(sys_wide);
        is_secure
    }

    pub fn is_focused_password_field() -> bool {
        unsafe {
            if IsSecureEventInputEnabled() != 0 {
                return true; // 系统级安全输入（登录窗口等），无需权限
            }
            ax_focused_is_secure_text_field()
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn classic_edit_class_filter_rejects_non_edit_win32_controls() {
        assert!(super::win_impl::is_classic_edit_class("Edit"));
        assert!(super::win_impl::is_classic_edit_class("RICHEDIT50W"));
        assert!(!super::win_impl::is_classic_edit_class("SysTreeView32"));
        assert!(!super::win_impl::is_classic_edit_class("DirectUIHWND"));
        assert!(super::win_impl::is_plausible_password_rect(100, 132));
        assert!(!super::win_impl::is_plausible_password_rect(0, 0));
        assert!(!super::win_impl::is_plausible_password_rect(100, 720));
    }
}
