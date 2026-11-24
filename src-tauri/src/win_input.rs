//! 全局键鼠监听（Windows）：WH_KEYBOARD_LL / WH_MOUSE_LL 低级钩子，跑在独立线程的消息循环里。
//!
//! 和 macOS 的 tap.rs 对外接口一致：`start`、`input_monitoring_granted`、`KEY_TAP_ACTIVE`、`MOUSE_TAP_ACTIVE`，
//! 另外提供 `cursor_physical`（全局指针位置，物理像素）。
//!
//! - 只取键位：按扫描码（+ 扩展键标志）换成 KeyboardEvent.code 字符串再发给页面（`{ code, down }`），
//!   按物理位置，不随键盘布局 / 输入法变。不做字符转换，不记录、不落盘任何输入。
//! - 钩子回调只做查表和往通道里塞一个小事件，然后立刻 `CallNextHookEx` 返回；
//!   序列化和发给页面在另一个线程做，不拖慢用户的输入（低级钩子超时会被系统摘掉）。
//! - Windows 不需要「输入监控」授权。注意：系统不会把以管理员身份运行的窗口、UAC / 锁屏等安全桌面上的按键交给
//!   普通权限进程的低级钩子，这时猫看不到按键。

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, MapVirtualKeyW, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON, MAPVK_VK_TO_VSC_EX};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetCursorPos, GetMessageW, GetSystemMetrics, SetWindowsHookExW, TranslateMessage,
    UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_EXTENDED, MSG, SM_SWAPBUTTON, WH_KEYBOARD_LL, WH_MOUSE_LL,
    WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP,
    WM_SYSKEYDOWN, WM_SYSKEYUP,
};

pub static KEY_TAP_ACTIVE: AtomicBool = AtomicBool::new(false);
pub static MOUSE_TAP_ACTIVE: AtomicBool = AtomicBool::new(false);

enum Evt {
    Key(&'static str, bool),
    Button(u8, bool),
}

static TX: OnceLock<Sender<Evt>> = OnceLock::new();

// 保留钩子用来生成 code 的实际 vk，兼容非美式布局、NumLock 和左右修饰键。
// 不用 LazyLock（Rust 1.80 才稳定）：Win7 版用 Rust 1.77.2 构建。
fn down_keys() -> &'static Mutex<HashMap<&'static str, u32>> {
    static DOWN: OnceLock<Mutex<HashMap<&'static str, u32>>> = OnceLock::new();
    DOWN.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(super) fn held_state(keys: Vec<super::HeldKey>, mut buttons: Vec<u8>) -> Result<super::HeldState, &'static str> {
    // 锁屏 / UAC 时当前桌面不可读，GetAsyncKeyState 返回的零不能当作抬起。
    cursor_physical().ok_or("input desktop unavailable")?;
    let mut down = down_keys().lock().unwrap_or_else(|err| err.into_inner());
    let keys = keys.into_iter().filter(|key| {
        let Some(&vk) = down.get(key.code.as_str()) else { return false };
        if unsafe { GetAsyncKeyState(vk as i32) } < 0 {
            return true;
        }
        // 钩子的自动重复过滤也必须重置，否则同一个键下次按下会被吞掉。
        down.remove(key.code.as_str());
        false
    }).map(|key| key.code).collect();
    drop(down);
    let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
    buttons.retain(|button| {
        let pressed = |vk| (unsafe { GetAsyncKeyState(i32::from(vk)) }) < 0;
        // GetAsyncKeyState 查物理键，互换后两侧都松开才判定抬起，避免和钩子的键位对应不一致。
        match button {
            0 | 2 if swapped => pressed(VK_LBUTTON) || pressed(VK_RBUTTON),
            0 => pressed(VK_LBUTTON),
            1 => pressed(VK_MBUTTON),
            2 => pressed(VK_RBUTTON),
            _ => true,
        }
    });
    Ok(super::HeldState { keys: Some(keys), buttons })
}

#[derive(Clone, Serialize)]
struct KeyEvt {
    code: &'static str,
    down: bool,
}

#[derive(Clone, Serialize)]
struct ButtonEvt {
    button: u8,
    down: bool,
}

// 虚拟键码（只用来认修饰键和几个扫描码有歧义的键）
const VK_PAUSE: u32 = 0x13;
const VK_LWIN: u32 = 0x5B;
const VK_RWIN: u32 = 0x5C;
const VK_NUMLOCK: u32 = 0x90;
const VK_LSHIFT: u32 = 0xA0;
const VK_RSHIFT: u32 = 0xA1;
const VK_LCONTROL: u32 = 0xA2;
const VK_RCONTROL: u32 = 0xA3;
const VK_LMENU: u32 = 0xA4;
const VK_RMENU: u32 = 0xA5;
const VK_PACKET: u32 = 0xE7;

/// 扫描码（Set 1）+ 扩展键标志 -> KeyboardEvent.code。和 Chromium 在 Windows 上的映射一致（dom_code_data.inc）。
fn code_for_scan(scan: u32, ext: bool) -> Option<&'static str> {
    Some(if ext {
        match scan {
            0x1C => "NumpadEnter",
            0x1D => "ControlRight",
            0x35 => "NumpadDivide",
            0x37 => "PrintScreen",
            0x38 => "AltRight",
            0x45 => "NumLock",
            0x46 => "Pause", // Ctrl+Pause（Break）
            0x47 => "Home",
            0x48 => "ArrowUp",
            0x49 => "PageUp",
            0x4B => "ArrowLeft",
            0x4D => "ArrowRight",
            0x4F => "End",
            0x50 => "ArrowDown",
            0x51 => "PageDown",
            0x52 => "Insert",
            0x53 => "Delete",
            0x5B => "MetaLeft",
            0x5C => "MetaRight",
            0x5D => "ContextMenu",
            0xF1 => "Lang2", // Hanja
            0xF2 => "Lang1", // Hangul / 한영
            _ => return None,
        }
    } else {
        match scan {
            0x01 => "Escape",
            0x02 => "Digit1",
            0x03 => "Digit2",
            0x04 => "Digit3",
            0x05 => "Digit4",
            0x06 => "Digit5",
            0x07 => "Digit6",
            0x08 => "Digit7",
            0x09 => "Digit8",
            0x0A => "Digit9",
            0x0B => "Digit0",
            0x0C => "Minus",
            0x0D => "Equal",
            0x0E => "Backspace",
            0x0F => "Tab",
            0x10 => "KeyQ",
            0x11 => "KeyW",
            0x12 => "KeyE",
            0x13 => "KeyR",
            0x14 => "KeyT",
            0x15 => "KeyY",
            0x16 => "KeyU",
            0x17 => "KeyI",
            0x18 => "KeyO",
            0x19 => "KeyP",
            0x1A => "BracketLeft",
            0x1B => "BracketRight",
            0x1C => "Enter",
            0x1D => "ControlLeft",
            0x1E => "KeyA",
            0x1F => "KeyS",
            0x20 => "KeyD",
            0x21 => "KeyF",
            0x22 => "KeyG",
            0x23 => "KeyH",
            0x24 => "KeyJ",
            0x25 => "KeyK",
            0x26 => "KeyL",
            0x27 => "Semicolon",
            0x28 => "Quote",
            0x29 => "Backquote",
            0x2A => "ShiftLeft",
            0x2B => "Backslash",
            0x2C => "KeyZ",
            0x2D => "KeyX",
            0x2E => "KeyC",
            0x2F => "KeyV",
            0x30 => "KeyB",
            0x31 => "KeyN",
            0x32 => "KeyM",
            0x33 => "Comma",
            0x34 => "Period",
            0x35 => "Slash",
            0x36 => "ShiftRight",
            0x37 => "NumpadMultiply",
            0x38 => "AltLeft",
            0x39 => "Space",
            0x3A => "CapsLock",
            0x3B => "F1",
            0x3C => "F2",
            0x3D => "F3",
            0x3E => "F4",
            0x3F => "F5",
            0x40 => "F6",
            0x41 => "F7",
            0x42 => "F8",
            0x43 => "F9",
            0x44 => "F10",
            0x45 => "Pause",
            0x46 => "ScrollLock",
            0x47 => "Numpad7",
            0x48 => "Numpad8",
            0x49 => "Numpad9",
            0x4A => "NumpadSubtract",
            0x4B => "Numpad4",
            0x4C => "Numpad5",
            0x4D => "Numpad6",
            0x4E => "NumpadAdd",
            0x4F => "Numpad1",
            0x50 => "Numpad2",
            0x51 => "Numpad3",
            0x52 => "Numpad0",
            0x53 => "NumpadDecimal",
            0x56 => "IntlBackslash",
            0x57 => "F11",
            0x58 => "F12",
            0x59 => "NumpadEqual",
            0x64 => "F13",
            0x65 => "F14",
            0x66 => "F15",
            0x67 => "F16",
            0x68 => "F17",
            0x69 => "F18",
            0x6A => "F19",
            0x6B => "F20",
            0x6C => "F21",
            0x6D => "F22",
            0x6E => "F23",
            0x70 => "KanaMode",
            0x71 => "Lang2",
            0x72 => "Lang1",
            0x73 => "IntlRo",
            0x76 => "F24",
            0x79 => "Convert",
            0x7B => "NonConvert",
            0x7D => "IntlYen",
            0x7E => "NumpadComma",
            _ => return None,
        }
    })
}

/// 一次低级键盘事件 -> code；该忽略的返回 None
fn key_code(k: &KBDLLHOOKSTRUCT) -> Option<&'static str> {
    let vk = k.vkCode;
    let ext = k.flags & LLKHF_EXTENDED != 0;
    match vk {
        // SendInput 注入的 Unicode 字符（输入法、远程工具）：扫描码字段装的是字符本身，不是键位，直接忽略
        VK_PACKET => return None,
        // 小键盘 NumLock / Shift+方向键时系统会伪造一对带扩展标志的 Shift 抬起 / 按下，真 Shift 从不带扩展标志
        VK_LSHIFT | VK_RSHIFT if ext => return None,
        // AltGr（右 Alt）会额外伪造一个左 Ctrl，扫描码带 0x200 标记
        VK_LCONTROL if k.scanCode & 0x200 != 0 => return None,
        // 修饰键按虚拟键码认左右，最稳
        VK_LSHIFT => return Some("ShiftLeft"),
        VK_RSHIFT => return Some("ShiftRight"),
        VK_LCONTROL => return Some("ControlLeft"),
        VK_RCONTROL => return Some("ControlRight"),
        VK_LMENU => return Some("AltLeft"),
        VK_RMENU => return Some("AltRight"),
        VK_LWIN => return Some("MetaLeft"),
        VK_RWIN => return Some("MetaRight"),
        // NumLock 和 Pause 共用扫描码 0x45，扩展标志在不同键盘 / 驱动上不可靠，按虚拟键码分
        VK_NUMLOCK => return Some("NumLock"),
        VK_PAUSE => return Some("Pause"),
        _ => {}
    }
    let scan = k.scanCode & 0xFF;
    if scan != 0 {
        return code_for_scan(scan, ext);
    }
    // 少数注入的按键没有扫描码：用虚拟键码反查（_EX 会在扩展键上带 0xE0 前缀）
    let sc = unsafe { MapVirtualKeyW(vk, MAPVK_VK_TO_VSC_EX) };
    if sc == 0 {
        return None;
    }
    code_for_scan(sc & 0xFF, sc & 0xFF00 == 0xE000)
}

fn send(e: Evt) {
    if let Some(tx) = TX.get() {
        let _ = tx.send(e);
    }
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 && lparam != 0 {
        let msg = wparam as u32;
        let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        let up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
        if down || up {
            let k = &*(lparam as *const KBDLLHOOKSTRUCT);
            if let Some(c) = key_code(k) {
                // 长按自动重复：同一个键没抬起又来按下，丢掉
                let fresh = {
                    let mut held = down_keys().lock().unwrap_or_else(|err| err.into_inner());
                    if down {
                        // 回调发生在系统更新异步键态之前。即使上次 keyup 丢失且查询一直失败，
                        // 真正重新按下时，先前的物理键态也已抬起。
                        held.insert(c, k.vkCode).is_none() || GetAsyncKeyState(k.vkCode as i32) >= 0
                    } else {
                        held.remove(c);
                        true
                    }
                };
                if fresh {
                    send(Evt::Key(c, down));
                }
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        // 只要左 / 中 / 右键；侧键、滚轮、移动都不要（移动由前端轮询指针位置得到）
        let evt = match wparam as u32 {
            WM_LBUTTONDOWN => Some((0, true)),
            WM_LBUTTONUP => Some((0, false)),
            WM_MBUTTONDOWN => Some((1, true)),
            WM_MBUTTONUP => Some((1, false)),
            WM_RBUTTONDOWN => Some((2, true)),
            WM_RBUTTONUP => Some((2, false)),
            _ => None,
        };
        if let Some((b, d)) = evt {
            send(Evt::Button(b, d));
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

/// 在当前线程装两个低级钩子并跑消息循环（低级钩子的回调由装钩子的线程的消息循环来派发）。
/// 一个都装不上返回 false；装上了就不会返回。
fn run_hooks() -> bool {
    unsafe {
        let hmod = GetModuleHandleW(std::ptr::null());
        let kb = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), hmod, 0);
        let ms = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), hmod, 0);
        KEY_TAP_ACTIVE.store(!kb.is_null(), Ordering::SeqCst);
        MOUSE_TAP_ACTIVE.store(!ms.is_null(), Ordering::SeqCst);
        if kb.is_null() && ms.is_null() {
            return false;
        }
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        // 正常不会走到这里
        KEY_TAP_ACTIVE.store(false, Ordering::SeqCst);
        MOUSE_TAP_ACTIVE.store(false, Ordering::SeqCst);
        if !kb.is_null() {
            UnhookWindowsHookEx(kb);
        }
        if !ms.is_null() {
            UnhookWindowsHookEx(ms);
        }
    }
    true
}

/// Windows 不需要「输入监控」之类的授权
pub fn input_monitoring_granted() -> bool {
    true
}

/// 当前指针位置（虚拟桌面坐标，物理像素，原点在主屏左上角）。进程是 Per-Monitor V2 DPI 感知（tao 启动时设置），
/// 所以 GetCursorPos 返回的就是物理像素，和 Tauri 的 PhysicalPosition 同一套坐标。
pub fn cursor_physical() -> Option<(i32, i32)> {
    let mut p = POINT { x: 0, y: 0 };
    // 锁屏 / UAC 安全桌面上会失败
    (unsafe { GetCursorPos(&mut p) } != 0).then_some((p.x, p.y))
}

pub fn start(app: AppHandle) {
    let (tx, rx) = channel::<Evt>();
    let _ = TX.set(tx);

    // 发给页面的线程：钩子回调只往通道里塞事件，序列化和 emit 都在这里做
    std::thread::Builder::new()
        .name("silly-input-emit".into())
        .spawn(move || {
            for e in rx {
                let _ = match e {
                    Evt::Key(code, down) => app.emit("silly:key", KeyEvt { code, down }),
                    Evt::Button(button, down) => app.emit("silly:button", ButtonEvt { button, down }),
                };
            }
        })
        .expect("spawn input emit thread");

    std::thread::Builder::new()
        .name("silly-input-hook".into())
        .spawn(|| {
            for _ in 0..30 {
                if run_hooks() {
                    return;
                }
                std::thread::sleep(Duration::from_secs(2));
            }
            eprintln!("[silly-cat] 全局键鼠钩子装不上，猫不会跟着打字和点击");
        })
        .expect("spawn input hook thread");
}
