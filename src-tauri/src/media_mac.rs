// macOS 音频活动检测：只读 CoreAudio HAL 的属性，判断「现在有没有软件真的在出声」。
// - 有按进程列出的能力（macOS 14.2+）时逐个进程看是否在输出：我们能排除通话/会议软件，
//   它们的声音不算「听歌」，免得开个语音就戴耳机。
// - 老系统没有进程列表，只能退化成看默认输出设备在不在跑（无法排除通话软件）。
// - 不录音、不读音频内容，只查音量电平和进程属性。
use std::{ffi::c_void, mem::size_of, ptr};

// 音乐软件白名单：只有这些在播放才算「用户在听歌」。2026-11-28 从黑名单改成白名单——
// IDE、浏览器等其它任何软件出声都不该让猫戴耳机（实测 Trae 内嵌浏览器开着猫的调试
// 页面，页面音效让 Trae 进程持续出声而误触发）。前缀匹配（整段或到 '.' 为止）；
// 没有 bundle id 的进程不再触发——白名单优先，宁可漏戴也不误戴。代价：不在名单里的
// 小众播放器和网页听歌不再触发；好处是浏览器/IDE/通话软件怎么出声都不会误戴，
// 之前黑名单里那一串通话/会议/语音软件（微信、QQ、腾讯会议、钉钉、飞书、Zoom、
// Teams、FaceTime、Discord）以及猫自己（com.drew.sillycat）、WebKit.GPU/WebContent、
// UZPlayer 全部天然排除，不用再逐个追。
const MUSIC_APPS: &[&str] = &[
    "com.apple.Music",      // Apple Music
    "com.spotify.client",   // Spotify
    "com.netease.163music", // 网易云音乐
    "com.tencent.QQMusic",  // QQ音乐（覆盖 QQMusicMac 等）
    "com.kugou",            // 酷狗音乐
    "com.kuwo",             // 酷我音乐
    "com.migu",             // 咪咕音乐
    "com.foobar2000",       // foobar2000
];
const SYSTEM: u32 = 1;
const GLOBAL: u32 = u32::from_be_bytes(*b"glob");
const OUTPUT: u32 = u32::from_be_bytes(*b"outp");
#[repr(C)]
struct Address {
    selector: u32,
    scope: u32,
    element: u32,
}
impl Address {
    fn new(selector: &[u8; 4], scope: u32, element: u32) -> Self {
        Self {
            selector: u32::from_be_bytes(*selector),
            scope,
            element,
        }
    }
}
#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectHasProperty(id: u32, addr: *const Address) -> u8;
    fn AudioObjectGetPropertyDataSize(
        id: u32,
        addr: *const Address,
        qualifier_len: u32,
        qualifier: *const c_void,
        len: *mut u32,
    ) -> i32;
    fn AudioObjectGetPropertyData(
        id: u32,
        addr: *const Address,
        qualifier_len: u32,
        qualifier: *const c_void,
        len: *mut u32,
        data: *mut c_void,
    ) -> i32;
}
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringGetLength(s: *const c_void) -> isize;
    fn CFStringGetCString(s: *const c_void, buf: *mut u8, capacity: isize, encoding: u32) -> bool;
    fn CFRelease(object: *const c_void);
}

// 调用方按 HAL selector 声明结果类型。
unsafe fn scalar<T: Default>(id: u32, selector: &[u8; 4], scope: u32, element: u32) -> Option<T> {
    let mut value = T::default();
    let mut len = size_of::<T>() as u32;
    let addr = Address::new(selector, scope, element);
    let status = AudioObjectGetPropertyData(
        id,
        &addr,
        0,
        ptr::null(),
        &mut len,
        (&mut value as *mut T).cast(),
    );
    (status == 0 && len as usize == size_of::<T>()).then_some(value)
}

fn process_objects(addr: &Address) -> Vec<u32> {
    let mut len = 0;
    unsafe {
        if AudioObjectGetPropertyDataSize(SYSTEM, addr, 0, ptr::null(), &mut len) != 0
            || len == 0
            || len & 3 != 0
        {
            return Vec::new();
        }
        let mut ids = vec![0u32; len as usize / 4];
        if AudioObjectGetPropertyData(
            SYSTEM,
            addr,
            0,
            ptr::null(),
            &mut len,
            ids.as_mut_ptr().cast(),
        ) != 0
        {
            return Vec::new();
        }
        ids.truncate(len as usize / 4);
        ids
    }
}

fn music_process(id: u32) -> bool {
    unsafe {
        // 'piro' = kAudioProcessPropertyIsRunningOutput（进程正在跑音频输出 IO；
        // 注意真正的 IsRunning 是 'pir?'，别搞混——2026-11-27 对 SDK 头文件核实）
        if scalar::<u32>(id, b"piro", GLOBAL, 0) != Some(1) {
            return false;
        }
        match scalar::<i32>(id, b"ppid", GLOBAL, 0) {
            Some(pid) if pid as u32 != std::process::id() => (),
            _ => return false,
        }
        let cf = scalar::<*const c_void>(id, b"pbid", GLOBAL, 0).unwrap_or(ptr::null());
        // 没有 bundle id 的进程（命令行播放器等）不触发：白名单优先，宁可漏戴不误戴
        if cf.is_null() {
            return false;
        }
        let mut buf = vec![0u8; (CFStringGetLength(cf) * 4 + 1) as usize];
        let ok = CFStringGetCString(cf, buf.as_mut_ptr(), buf.len() as isize, 0x08000100);
        CFRelease(cf);
        if !ok {
            return false;
        }
        let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        let bundle = String::from_utf8_lossy(&buf[..end]);
        MUSIC_APPS.iter().any(|&entry| {
            bundle
                .strip_prefix(entry)
                .is_some_and(|suffix| suffix.is_empty() || suffix.starts_with('.'))
        })
    }
}

fn audible_device(device: u32) -> bool {
    unsafe {
        let mute = scalar::<u32>(device, b"mute", OUTPUT, 0);
        let volume = scalar::<f32>(device, b"volm", OUTPUT, 0);
        let channels = [1, 2].map(|channel| {
            let muted = mute
                .or_else(|| scalar(device, b"mute", OUTPUT, channel))
                .unwrap_or(0);
            let level = volume.or_else(|| scalar(device, b"volm", OUTPUT, channel));
            (muted, level)
        });
        let default_level = if channels.iter().all(|(_, level)| level.is_none()) {
            1.0
        } else {
            0.0
        };
        channels
            .iter()
            .any(|(muted, level)| *muted == 0 && level.unwrap_or(default_level) >= 0.01)
    }
}

/// (有没有在出声, 判定方式 "process" / "device")
pub fn sample() -> (bool, &'static str) {
    let list = Address::new(b"prs#", GLOBAL, 0);
    let by_process = unsafe { AudioObjectHasProperty(SYSTEM, &list) != 0 };
    let device = unsafe { scalar::<u32>(SYSTEM, b"dOut", GLOBAL, 0) }.unwrap_or(0);
    let audible = device != 0 && audible_device(device);
    if by_process {
        (
            audible && process_objects(&list).into_iter().any(music_process),
            "process",
        )
    } else {
        (
            audible && unsafe { scalar::<u32>(device, b"gone", GLOBAL, 0) == Some(1) },
            "device",
        )
    }
}

// ---------- 节拍采集：CoreAudio Process Tap（macOS 14.2+） ----------
// 猫戴上耳机后开一条线程，建一个「全系统输出的立体声混音 tap」（CATapUnmuted：用户耳朵
// 照常），挂进私有聚合设备用 IOProc 把波形拉进来喂给 beat_detect 估节拍。
// 波形只在内存里过一道算节拍：不落盘、不外传、不存任何音频内容。
// - AudioHardwareCreateProcessTap / DestroyProcessTap 只在 macOS 14.2+ 的 CoreAudio 里有
//   符号，老系统直接链接会导致启动时 dyld 报错，所以这两个函数用 dlsym 按需解析，
//   解析不到（老系统）就静默回退——前端拿不到节拍就用默认 460ms。
// - 首次开始采集系统会弹「系统音频录制」权限框（Info.plist 要有 NSAudioCaptureUsageDescription，
//   见 src-tauri/Info.plist）；用户拒绝的话 tap 收不到数据 → 置信度不够 → 同样回退默认节拍。
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

const TAP_UID: &[u8; 4] = b"tuid"; // kAudioTapPropertyUID
const AGG_TAP_LIST: &[u8; 4] = b"tap#"; // kAudioAggregateDevicePropertyTapList
const STREAM_FORMAT: &[u8; 4] = b"sfmt"; // kAudioDevicePropertyStreamFormat
const UTF8: u32 = 0x08000100; // kCFStringEncodingUTF8

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFBooleanTrue: c_void;
    fn CFStringCreateWithCString(alloc: *const c_void, c_str: *const u8, encoding: u32) -> *const c_void;
    fn CFArrayCreate(alloc: *const c_void, values: *mut *const c_void, num: isize, callbacks: *const c_void) -> *const c_void;
    fn CFDictionaryCreate(
        alloc: *const c_void,
        keys: *mut *const c_void,
        values: *mut *const c_void,
        num: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> *const c_void;
}
// 这批 AudioDevice / Aggregate API 从 10.x 就有，直接链接
#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectSetPropertyData(
        id: u32,
        addr: *const Address,
        qualifier_len: u32,
        qualifier: *const c_void,
        len: u32,
        data: *const c_void,
    ) -> i32;
    fn AudioHardwareCreateAggregateDevice(desc: *const c_void, out: *mut u32) -> i32;
    fn AudioHardwareDestroyAggregateDevice(id: u32) -> i32;
    fn AudioDeviceCreateIOProcID(
        out: *mut u32,
        device: u32,
        proc_: Option<extern "C" fn(u32, *const c_void, *const c_void, *const c_void, *mut c_void, *const c_void, *mut c_void) -> i32>,
        client: *mut c_void,
    ) -> i32;
    fn AudioDeviceDestroyIOProcID(device: u32, proc_: u32) -> i32;
    fn AudioDeviceStart(device: u32, proc_: u32) -> i32;
    fn AudioDeviceStop(device: u32, proc_: u32) -> i32;
}
#[link(name = "objc", kind = "dylib")]
extern "C" {
    fn objc_getClass(name: *const std::ffi::c_char) -> *mut c_void;
    fn sel_registerName(name: *const std::ffi::c_char) -> *mut c_void;
    fn objc_msgSend();
}

#[derive(Default)]
#[repr(C)]
struct Asbd {
    sample_rate: f64,
    format_id: u32,
    flags: u32,
    bytes_per_packet: u32,
    frames_per_packet: u32,
    bytes_per_frame: u32,
    channels_per_frame: u32,
    bits_per_channel: u32,
}

static BEAT_RUNNING: AtomicBool = AtomicBool::new(false);
static BEAT_STOP: AtomicBool = AtomicBool::new(false);
static CAP_RATE: AtomicU32 = AtomicU32::new(48000);

unsafe fn dlsym_ptr(name: &std::ffi::CStr) -> *mut c_void {
    extern "C" {
        fn dlsym(handle: *mut c_void, symbol: *const std::ffi::c_char) -> *mut c_void;
    }
    dlsym(ptr::null_mut(), name.as_ptr()) // RTLD_DEFAULT：CoreAudio 已随进程加载
}

unsafe fn cfstr(s: &str) -> *const c_void {
    let mut bytes = s.as_bytes().to_vec();
    bytes.push(0);
    CFStringCreateWithCString(ptr::null(), bytes.as_ptr(), UTF8)
}

fn sel(name: &'static std::ffi::CStr) -> *mut c_void {
    unsafe { sel_registerName(name.as_ptr()) }
}

/// IOProc 回调：聚合设备跑起来后系统不断推波形进来，这里只做「取第一个 buffer、
/// 原样交给 beat_detect」，重活都在那边的锁里排队做，不阻塞实时线程。
extern "C" fn io_callback(
    _device: u32,
    _now: *const c_void,
    input: *const c_void,
    _in_time: *const c_void,
    _output: *mut c_void,
    _out_time: *const c_void,
    _client: *mut c_void,
) -> i32 {
    unsafe {
        if input.is_null() {
            return 0;
        }
        // AudioBufferList：mNumberBuffers(u32) 后空 4 字节对齐，每个 AudioBuffer
        // 是 {mNumberChannels u32, mDataByteSize u32, mData 指针}。布局两种都可能：
        // 交错（1 个 buffer 双声道）或非交错（每声道一个 buffer），全都喂进去，
        // beat_detect 那边本来就按「来什么混什么」处理
        let count = *(input as *const u32);
        let rate = CAP_RATE.load(Ordering::Relaxed);
        for i in 0..count as usize {
            let buf = (input as *const u8).add(8 + i * 16);
            let channels = *(buf as *const u32);
            let bytes = *(buf.add(4) as *const u32);
            let data = *(buf.add(8) as *const *const c_void);
            if data.is_null() || bytes == 0 || channels == 0 {
                continue;
            }
            let frames = bytes as usize / 4 / channels as usize;
            let slice = std::slice::from_raw_parts(data as *const f32, frames * channels as usize);
            crate::beat_detect::feed(slice, channels, rate);
        }
    }
    0
}

struct TapSession {
    tap: u32,
    aggregate: u32,
    proc_id: u32,
}

/// 建 tap + 聚合设备 + IOProc 并启动；任何一步失败都清理干净返回 None（老系统、
/// 没符号、没授权等，前端自然回退默认节拍）。启动第一次会触发系统权限弹窗。
unsafe fn setup_tap() -> Option<TapSession> {
    // CATapDescription 是 ObjC 类，macOS 14.2 之前的系统没这个类
    let cls = objc_getClass(c"CATapDescription".as_ptr());
    if cls.is_null() {
        return None;
    }
    let create_sym = dlsym_ptr(c"AudioHardwareCreateProcessTap");
    let destroy_sym = dlsym_ptr(c"AudioHardwareDestroyProcessTap");
    if create_sym.is_null() || destroy_sym.is_null() {
        return None;
    }
    let create_tap: unsafe extern "C" fn(*const c_void, *mut u32) -> i32 =
        std::mem::transmute(create_sym);
    let destroy_tap: unsafe extern "C" fn(u32) -> i32 = std::mem::transmute(destroy_sym);

    // [[CATapDescription alloc] initStereoGlobalTapButExcludeProcesses:@[]]：全系统输出
    // 混成立体声（不排除任何进程）；muteBehavior = CATapUnmuted，用户耳朵照常
    let send_alloc: extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void =
        std::mem::transmute(objc_msgSend as *const ());
    let send_obj: extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> *mut c_void =
        std::mem::transmute(objc_msgSend as *const ());
    let send_set_id: extern "C" fn(*mut c_void, *mut c_void, *const c_void) -> *mut c_void =
        std::mem::transmute(objc_msgSend as *const ());
    let send_set_bool: extern "C" fn(*mut c_void, *mut c_void, i8) -> *mut c_void =
        std::mem::transmute(objc_msgSend as *const ());
    let send_set_uint: extern "C" fn(*mut c_void, *mut c_void, usize) -> *mut c_void =
        std::mem::transmute(objc_msgSend as *const ());
    let send_release: extern "C" fn(*mut c_void, *mut c_void) =
        std::mem::transmute(objc_msgSend as *const ());
    let allocd = send_alloc(cls, sel(c"alloc"));
    if allocd.is_null() {
        return None;
    }
    let empty = CFArrayCreate(ptr::null(), ptr::null_mut(), 0, ptr::null()) as *mut c_void;
    let desc = send_obj(allocd, sel(c"initStereoGlobalTapButExcludeProcesses:"), empty);
    CFRelease(empty); // init 里面已经拷贝了，这边交还
    if desc.is_null() {
        return None;
    }
    let name_cf = cfstr("silly-cat-beat");
    send_set_id(desc, sel(c"setName:"), name_cf); // property 是 copy 语义，字符串马上放
    CFRelease(name_cf);
    send_set_uint(desc, sel(c"setMuteBehavior:"), 0); // CATapUnmuted
    send_set_bool(desc, sel(c"setPrivate:"), 1); // 私有 tap：不进系统设备列表

    let mut tap = 0u32;
    let created = create_tap(desc, &mut tap) == 0 && tap != 0;
    send_release(desc, sel(c"release")); // HAL 建的时候已持有，所有权交还
    if !created {
        return None;
    }
    // tap 的 UID（CFString），挂到聚合设备时要用；HAL 属性按 Get 规则返回 +1 引用，
    // 挂完要放；拿不到就退（记得销毁 tap）
    let tap_uid = match scalar::<*const c_void>(tap, TAP_UID, GLOBAL, 0) {
        Some(uid) if !uid.is_null() => uid,
        _ => {
            destroy_tap(tap);
            return None;
        }
    };

    // 私有聚合设备：只在猫自己的进程里可见（HAL 建的时候就拷贝了字典，CF 侧建完即放）
    let keys = [cfstr("name"), cfstr("uid"), cfstr("private")];
    let values = [
        cfstr("silly-cat-agg"),
        cfstr(&format!("silly-cat-agg-{}", std::process::id())),
        &kCFBooleanTrue as *const _ as *const c_void,
    ];
    let dict = CFDictionaryCreate(
        ptr::null(),
        keys.as_ptr() as *mut *const c_void,
        values.as_ptr() as *mut *const c_void,
        3,
        ptr::null(),
        ptr::null(),
    );
    let mut aggregate = 0u32;
    let agg_created =
        AudioHardwareCreateAggregateDevice(dict, &mut aggregate) == 0 && aggregate != 0;
    for k in keys.iter().chain(values[..2].iter()) {
        CFRelease(*k);
    }
    CFRelease(dict);
    if !agg_created {
        destroy_tap(tap);
        CFRelease(tap_uid);
        return None;
    }
    // 把 tap 挂进聚合设备（kAudioAggregateDevicePropertyTapList = CFArray<CFString UID>）
    let list = CFArrayCreate(ptr::null(), [tap_uid].as_mut_ptr() as *mut *const c_void, 1, ptr::null());
    let list_set = AudioObjectSetPropertyData(
        aggregate,
        &Address::new(AGG_TAP_LIST, GLOBAL, 0),
        0,
        ptr::null(),
        size_of::<*const c_void>() as u32,
        (&list as *const *const c_void).cast(),
    ) == 0;
    CFRelease(list);
    CFRelease(tap_uid);
    if !list_set {
        AudioHardwareDestroyAggregateDevice(aggregate);
        destroy_tap(tap);
        return None;
    }
    if scalar::<Asbd>(aggregate, STREAM_FORMAT, GLOBAL, 0)
        .map(|f| f.sample_rate.round() as u32)
        .filter(|r| *r >= 8000)
        .map(|r| CAP_RATE.store(r, Ordering::Relaxed))
        .is_none()
    {
        AudioHardwareDestroyAggregateDevice(aggregate);
        destroy_tap(tap);
        return None;
    }

    let mut proc_id = 0u32;
    if AudioDeviceCreateIOProcID(&mut proc_id, aggregate, Some(io_callback), ptr::null_mut()) != 0
        || proc_id == 0
        || AudioDeviceStart(aggregate, proc_id) != 0
    {
        if proc_id != 0 {
            AudioDeviceDestroyIOProcID(aggregate, proc_id);
        }
        AudioHardwareDestroyAggregateDevice(aggregate);
        destroy_tap(tap);
        return None;
    }
    Some(TapSession { tap, aggregate, proc_id })
}

unsafe fn teardown(session: TapSession) {
    let destroy_tap: unsafe extern "C" fn(u32) -> i32 =
        std::mem::transmute(dlsym_ptr(c"AudioHardwareDestroyProcessTap"));
    AudioDeviceStop(session.aggregate, session.proc_id);
    AudioDeviceDestroyIOProcID(session.aggregate, session.proc_id);
    AudioHardwareDestroyAggregateDevice(session.aggregate);
    destroy_tap(session.tap);
}

/// 猫戴上耳机时开始采节拍（见文件头注释：14.2 以下静默不采集）
pub fn beat_capture_start() {
    if BEAT_RUNNING.load(Ordering::SeqCst) {
        return;
    }
    BEAT_STOP.store(false, Ordering::SeqCst);
    if std::thread::Builder::new()
        .name("silly-beat-capture".into())
        .spawn(|| {
            let session = unsafe { setup_tap() };
            if let Some(session) = session {
                while !BEAT_STOP.load(Ordering::SeqCst) {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                unsafe { teardown(session) };
            } else {
                // 每次戴上耳机才试一次，不会刷屏；老系统/没符号/没授权都归这里
                crate::log::write("beat", "节拍 tap 建不起来（macOS <14.2、没符号或没授权），回退默认节拍");
            }
            BEAT_RUNNING.store(false, Ordering::SeqCst);
            crate::beat_detect::reset();
        })
        .is_ok()
    {
        BEAT_RUNNING.store(true, Ordering::SeqCst);
    }
}

/// 摘耳机时停掉采集并清节拍状态
pub fn beat_capture_stop() {
    BEAT_STOP.store(true, Ordering::SeqCst);
    crate::beat_detect::reset();
}
