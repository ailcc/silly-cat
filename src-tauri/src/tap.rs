//! 全局键鼠监听（macOS）：只读的 CGEventTap。
//!
//! 只取虚拟键码和按下/抬起，不做任何字符转换（rdev 在非主线程做 TIS 字符转换会崩），
//! 也不记录、不落盘任何输入内容。键码到 KeyboardEvent.code 的映射在前端 input-desktop.js 里做。
//!
//! - 能不能收到输入，以 WindowServer 给的结果为准，不看 `CGPreflightListenEventAccess`：
//!   实测（macOS 26.6）没授权、或授权记录和当前签名对不上（装了新构建后常见，tccd 报
//!   "Failed to match existing code requirement"）时，`CGEventTapCreate` 照样返回非空的 tap，
//!   但 `CGEventTapIsEnabled` 是 false，`CGEventTapEnable(true)` 也开不起来，事件一个都收不到；
//!   Preflight 的结果还会在进程里缓存，授权变了也不一定跟着变。
//!   所以两条 tap 都是「建出来、打开、确认真的打开了才用」，不然释放掉，2 秒后再试。
//! - 但本应用是前台应用时（设置窗口在前面），没授权的 tap 也会被系统打开（只是收不到别的应用的按键）；
//!   切到别的应用后系统又把它关掉、再也开不起来。所以「能不能收到」只在本应用不在前台、且已经不在前台
//!   超过 1 秒时才重新判断，在前台期间沿用上一次的结论。
//! - 键盘、鼠标按键各一条 tap（同一项「输入监控」权限）；指针移动不走 tap，由前端轮询指针位置得到。
//! - `keyboard_state` 给前端判断要不要提示授权：tap 在跑但被系统关掉（授权被撤销）也算收不到。

use serde::Serialize;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
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
    fn CGEventTapIsEnabled(tap: CFMachPortRef) -> bool;
    fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    fn CGEventSourceKeyState(state: i32, key: u16) -> bool;
    fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
    fn CGEventSourceFlagsState(state: i32) -> u64;
    fn CGEventGetFlags(event: CGEventRef) -> u64;
    fn CGEventCreate(source: *mut c_void) -> CGEventRef;
    fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
    fn CGPreflightListenEventAccess() -> bool;
    fn CGRequestListenEventAccess() -> bool;
}

#[link(name = "objc", kind = "dylib")]
extern "C" {
    fn objc_getClass(name: *const std::ffi::c_char) -> *mut c_void;
    fn sel_registerName(name: *const std::ffi::c_char) -> *mut c_void;
    fn objc_msgSend();
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
/// 键盘 tap 至少试建过一次（之前前端不提示，避免启动头两秒误报）
static KEY_TAP_TRIED: AtomicBool = AtomicBool::new(false);
/// 上一次在后台时得出的结论（KeyboardState 的编号），在前台期间沿用
static KEY_VERDICT: AtomicU8 = AtomicU8::new(0);
/// 本应用从什么时候开始不在前台（在前台时为 None）
static INACTIVE_SINCE: Mutex<Option<Instant>> = Mutex::new(None);

/// 键盘输入现在能不能收到（仅 macOS 有意义）
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum KeyboardState {
    /// 刚启动，还没试过
    Pending,
    /// tap 在跑且是打开的
    Ok,
    /// 建不起来 / 建出来是关着的 / 跑着跑着被系统关掉：多半是没授权或授权记录和签名对不上
    Blocked,
}

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

#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn IsSecureEventInputEnabled() -> u8;
}

pub(super) fn held_state(keys: Vec<super::HeldKey>, mut buttons: Vec<u8>) -> Result<super::HeldState, &'static str> {
    const HID: i32 = 1; // kCGEventSourceStateHIDSystemState
    let keys = unsafe {
        if IsSecureEventInputEnabled() != 0 {
            None
        } else {
            let flags = CGEventSourceFlagsState(HID);
            Some(keys.into_iter().filter(|key| match modifier_bit(i64::from(key.kc)) {
                Some(bit) => flags & bit != 0,
                None => CGEventSourceKeyState(HID, key.kc),
            }).map(|key| key.code).collect())
        }
    };
    buttons.retain(|button| {
        let cg_button = match button { 0 => 0, 1 => 2, 2 => 1, _ => return true };
        unsafe { CGEventSourceButtonState(HID, cg_button) }
    });
    Ok(super::HeldState { keys, buttons })
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

/// 在当前线程建一个只读 tap 并跑 run loop；建不起来、或建出来系统不让打开（没授权）就释放掉返回 false。成功时不会返回。
fn run_tap(events: u64, cb: TapCallback, slot: &AtomicPtr<c_void>, active: &AtomicBool) -> bool {
    unsafe {
        let tap = CGEventTapCreate(SESSION_EVENT_TAP, HEAD_INSERT, LISTEN_ONLY, events, cb, std::ptr::null_mut());
        if tap.is_null() {
            return false;
        }
        CGEventTapEnable(tap, true);
        if !CGEventTapIsEnabled(tap) {
            CFRelease(tap as CFTypeRef);
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

/// 系统记录里的授权（`CGPreflightListenEventAccess`）。只作参考：签名对不上时、授权刚变时都可能不准，
/// 判断「能不能收到按键」用 `keyboard_state`。
pub fn input_monitoring_granted() -> bool {
    unsafe { CGPreflightListenEventAccess() }
}

/// 申请输入监控权限：系统会弹窗 / 把应用加进「输入监控」列表（已经有记录时什么都不做）
pub fn request_input_monitoring() -> bool {
    unsafe { CGRequestListenEventAccess() }
}

/// `[NSApp isActive]`：本应用是不是前台应用。不用额外的 crate，直接走 objc 运行时
fn app_is_active() -> bool {
    unsafe {
        let cls = objc_getClass(c"NSApplication".as_ptr());
        if cls.is_null() {
            return false;
        }
        let send_obj: extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void = std::mem::transmute(objc_msgSend as *const ());
        let send_bool: extern "C" fn(*mut c_void, *mut c_void) -> i8 = std::mem::transmute(objc_msgSend as *const ());
        let app = send_obj(cls, sel_registerName(c"sharedApplication".as_ptr()));
        !app.is_null() && send_bool(app, sel_registerName(c"isActive".as_ptr())) != 0
    }
}

fn encode(s: KeyboardState) -> u8 {
    match s {
        KeyboardState::Pending => 0,
        KeyboardState::Ok => 1,
        KeyboardState::Blocked => 2,
    }
}

fn decode(v: u8) -> KeyboardState {
    match v {
        1 => KeyboardState::Ok,
        2 => KeyboardState::Blocked,
        _ => KeyboardState::Pending,
    }
}

/// 键盘输入能不能收到。由 input_status（同步 command，在主线程上）调用：要读 `[NSApp isActive]`。
pub fn keyboard_state() -> KeyboardState {
    let trusted = {
        let mut since = INACTIVE_SINCE.lock().unwrap_or_else(|e| e.into_inner());
        if app_is_active() {
            *since = None;
            false
        } else {
            since.get_or_insert_with(Instant::now).elapsed() >= Duration::from_secs(1)
        }
    };
    if !trusted {
        return decode(KEY_VERDICT.load(Ordering::SeqCst));
    }
    let v = observe_key_tap();
    KEY_VERDICT.store(encode(v), Ordering::SeqCst);
    v
}

/// 在后台时看键盘 tap 的实际状态
fn observe_key_tap() -> KeyboardState {
    if KEY_TAP_ACTIVE.load(Ordering::SeqCst) {
        let tap = KEY_TAP.load(Ordering::SeqCst);
        if tap.is_null() {
            return KeyboardState::Blocked;
        }
        // 超时被关掉的，回调里会马上重新打开；这里再顺手开一次，开不起来才算收不到（授权被撤销等）
        unsafe {
            if !CGEventTapIsEnabled(tap) {
                CGEventTapEnable(tap, true);
            }
            return if CGEventTapIsEnabled(tap) { KeyboardState::Ok } else { KeyboardState::Blocked };
        }
    }
    if KEY_TAP_TRIED.load(Ordering::SeqCst) {
        KeyboardState::Blocked
    } else {
        KeyboardState::Pending
    }
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
        request_input_monitoring();
    }

    // 不看 Preflight：直接试建，WindowServer 说了算（见文件头）。没授权时每 2 秒试一次，授权后自动建起来
    std::thread::Builder::new()
        .name("silly-key-tap".into())
        .spawn(|| loop {
            let events = mask(KEY_DOWN) | mask(KEY_UP) | mask(FLAGS_CHANGED);
            let ran = run_tap(events, key_callback, &KEY_TAP, &KEY_TAP_ACTIVE);
            KEY_TAP_TRIED.store(true, Ordering::SeqCst);
            if ran {
                return;
            }
            std::thread::sleep(Duration::from_secs(2));
        })
        .expect("spawn key tap thread");

    std::thread::Builder::new()
        .name("silly-mouse-tap".into())
        .spawn(|| {
            let events = mask(LEFT_DOWN) | mask(LEFT_UP) | mask(RIGHT_DOWN) | mask(RIGHT_UP) | mask(OTHER_DOWN) | mask(OTHER_UP);
            loop {
                if run_tap(events, mouse_callback, &MOUSE_TAP, &MOUSE_TAP_ACTIVE) {
                    return;
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        })
        .expect("spawn mouse tap thread");
}
