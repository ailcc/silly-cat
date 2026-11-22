//! 全局键鼠监听（macOS）：只读的 CGEventTap。
//!
//! 只取虚拟键码和按下/抬起，不做任何字符转换（rdev 在非主线程做 TIS 字符转换会崩），
//! 也不记录、不落盘任何输入内容。键码到 KeyboardEvent.code 的映射在前端 input-desktop.js 里做。
//!
//! - 键盘 tap 需要「输入监控」权限：没授权时不创建，后台每 2 秒查一次，授权后自动建起来。
//! - 鼠标按键 tap 单独建，不依赖键盘那份权限；指针移动不走 tap，由前端轮询指针位置得到。

use serde::Serialize;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

type CFTypeRef = *const c_void;
type CFMachPortRef = *mut c_void;
type CFRunLoopSourceRef = *mut c_void;
type CFRunLoopRef = *mut c_void;
type CFStringRef = *const c_void;
type CGEventRef = *mut c_void;
type CGEventTapProxy = *mut c_void;
type TapCallback = extern "C" fn(CGEventTapProxy, u32, CGEventRef, *mut c_void) -> CGEventRef;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct CGPoint {
    pub x: f64,
    pub y: f64,
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: TapCallback,
        user_info: *mut c_void,
    ) -> CFMachPortRef;
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
    fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    fn CGEventGetFlags(event: CGEventRef) -> u64;
    fn CGEventCreate(source: *mut c_void) -> CGEventRef;
    fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
    fn CGPreflightListenEventAccess() -> bool;
    fn CGRequestListenEventAccess() -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFRunLoopCommonModes: CFStringRef;
    fn CFMachPortCreateRunLoopSource(alloc: *const c_void, port: CFMachPortRef, order: isize) -> CFRunLoopSourceRef;
    fn CFRunLoopGetCurrent() -> CFRunLoopRef;
    fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFStringRef);
    fn CFRunLoopRun();
    fn CFRelease(cf: CFTypeRef);
}

const SESSION_EVENT_TAP: u32 = 1;
const HEAD_INSERT: u32 = 0;
const LISTEN_ONLY: u32 = 1;

const LEFT_DOWN: u32 = 1;
const LEFT_UP: u32 = 2;
const RIGHT_DOWN: u32 = 3;
const RIGHT_UP: u32 = 4;
const KEY_DOWN: u32 = 10;
const KEY_UP: u32 = 11;
const FLAGS_CHANGED: u32 = 12;
const OTHER_DOWN: u32 = 25;
const OTHER_UP: u32 = 26;
const DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const DISABLED_BY_USER: u32 = 0xFFFF_FFFF;

const FIELD_BUTTON_NUMBER: u32 = 3;
const FIELD_AUTOREPEAT: u32 = 8;
const FIELD_KEYCODE: u32 = 9;

static APP: OnceLock<AppHandle> = OnceLock::new();
static KEY_TAP: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
static MOUSE_TAP: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
pub static KEY_TAP_ACTIVE: AtomicBool = AtomicBool::new(false);
pub static MOUSE_TAP_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
struct KeyEvt {
    kc: i64,
    down: bool,
}

#[derive(Clone, Serialize)]
struct ButtonEvt {
    button: u8,
    down: bool,
}

const fn mask(t: u32) -> u64 {
    1u64 << t
}

/// 修饰键：键码 -> 设备相关的左右区分标志位（NX_DEVICE*KEYMASK）
fn modifier_bit(kc: i64) -> Option<u64> {
    Some(match kc {
        56 => 0x0000_0002, // ShiftLeft
        60 => 0x0000_0004, // ShiftRight
        59 => 0x0000_0001, // ControlLeft
        62 => 0x0000_2000, // ControlRight
        58 => 0x0000_0020, // AltLeft
        61 => 0x0000_0040, // AltRight
        55 => 0x0000_0008, // MetaLeft
        54 => 0x0000_0010, // MetaRight
        63 => 0x0080_0000, // Fn（kCGEventFlagMaskSecondaryFn）
        57 => 0x0001_0000, // CapsLock（锁定状态，前端按「按一下」处理）
        _ => return None,
    })
}

fn reenable(slot: &AtomicPtr<c_void>) {
    let tap = slot.load(Ordering::SeqCst);
    if !tap.is_null() {
        unsafe { CGEventTapEnable(tap, true) };
    }
}

extern "C" fn key_callback(_p: CGEventTapProxy, ty: u32, event: CGEventRef, _u: *mut c_void) -> CGEventRef {
    if ty == DISABLED_BY_TIMEOUT || ty == DISABLED_BY_USER {
        reenable(&KEY_TAP);
        return event;
    }
    let Some(app) = APP.get() else { return event };
    unsafe {
        match ty {
            KEY_DOWN | KEY_UP => {
                if ty == KEY_DOWN && CGEventGetIntegerValueField(event, FIELD_AUTOREPEAT) != 0 {
                    return event; // 长按自动重复不算新按键
                }
                let kc = CGEventGetIntegerValueField(event, FIELD_KEYCODE);
                let _ = app.emit("silly:key", KeyEvt { kc, down: ty == KEY_DOWN });
            }
            FLAGS_CHANGED => {
                let kc = CGEventGetIntegerValueField(event, FIELD_KEYCODE);
                if let Some(bit) = modifier_bit(kc) {
                    let down = kc == 57 || CGEventGetFlags(event) & bit != 0;
                    let _ = app.emit("silly:key", KeyEvt { kc, down });
                }
            }
            _ => {}
        }
    }
    event
}

extern "C" fn mouse_callback(_p: CGEventTapProxy, ty: u32, event: CGEventRef, _u: *mut c_void) -> CGEventRef {
    if ty == DISABLED_BY_TIMEOUT || ty == DISABLED_BY_USER {
        reenable(&MOUSE_TAP);
        return event;
    }
    let Some(app) = APP.get() else { return event };
    let evt = match ty {
        LEFT_DOWN => Some(ButtonEvt { button: 0, down: true }),
        LEFT_UP => Some(ButtonEvt { button: 0, down: false }),
        RIGHT_DOWN => Some(ButtonEvt { button: 2, down: true }),
        RIGHT_UP => Some(ButtonEvt { button: 2, down: false }),
        OTHER_DOWN | OTHER_UP => {
            // 只要中键（按键号 2）；侧键忽略
            let n = unsafe { CGEventGetIntegerValueField(event, FIELD_BUTTON_NUMBER) };
            (n == 2).then_some(ButtonEvt { button: 1, down: ty == OTHER_DOWN })
        }
        _ => None,
    };
    if let Some(e) = evt {
        let _ = app.emit("silly:button", e);
    }
    event
}

/// 在当前线程建一个只读 tap 并跑 run loop；建不起来返回 false。成功时不会返回。
fn run_tap(events: u64, cb: TapCallback, slot: &AtomicPtr<c_void>, active: &AtomicBool) -> bool {
    unsafe {
        let tap = CGEventTapCreate(SESSION_EVENT_TAP, HEAD_INSERT, LISTEN_ONLY, events, cb, std::ptr::null_mut());
        if tap.is_null() {
            return false;
        }
        let src = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
        if src.is_null() {
            CFRelease(tap as CFTypeRef);
            return false;
        }
        slot.store(tap, Ordering::SeqCst);
        CFRunLoopAddSource(CFRunLoopGetCurrent(), src, kCFRunLoopCommonModes);
        CGEventTapEnable(tap, true);
        active.store(true, Ordering::SeqCst);
        CFRunLoopRun();
        // 正常不会走到这里
        active.store(false, Ordering::SeqCst);
        slot.store(std::ptr::null_mut(), Ordering::SeqCst);
        CFRelease(src as CFTypeRef);
        CFRelease(tap as CFTypeRef);
    }
    true
}

pub fn input_monitoring_granted() -> bool {
    unsafe { CGPreflightListenEventAccess() }
}

/// 当前指针位置（全局坐标，单位是点，原点在主屏左上角）。不需要任何权限。
pub fn cursor_location() -> Option<CGPoint> {
    unsafe {
        let ev = CGEventCreate(std::ptr::null_mut());
        if ev.is_null() {
            return None;
        }
        let p = CGEventGetLocation(ev);
        CFRelease(ev as CFTypeRef);
        Some(p)
    }
}

pub fn start(app: AppHandle) {
    let _ = APP.set(app);

    // 没有输入监控权限时请求一次（系统会弹窗 / 把应用加进设置列表），之后不再打扰
    if !input_monitoring_granted() {
        unsafe { CGRequestListenEventAccess() };
    }

    std::thread::Builder::new()
        .name("silly-key-tap".into())
        .spawn(|| loop {
            if input_monitoring_granted() {
                let events = mask(KEY_DOWN) | mask(KEY_UP) | mask(FLAGS_CHANGED);
                if run_tap(events, key_callback, &KEY_TAP, &KEY_TAP_ACTIVE) {
                    return;
                }
            }
            std::thread::sleep(Duration::from_secs(2));
        })
        .expect("spawn key tap thread");

    std::thread::Builder::new()
        .name("silly-mouse-tap".into())
        .spawn(|| {
            let events = mask(LEFT_DOWN) | mask(LEFT_UP) | mask(RIGHT_DOWN) | mask(RIGHT_UP) | mask(OTHER_DOWN) | mask(OTHER_UP);
            for _ in 0..30 {
                if run_tap(events, mouse_callback, &MOUSE_TAP, &MOUSE_TAP_ACTIVE) {
                    return;
                }
                std::thread::sleep(Duration::from_secs(2));
            }
            eprintln!("[silly-cat] 鼠标按键监听建不起来，画面里的鼠标不会跟着点击");
        })
        .expect("spawn mouse tap thread");
}
