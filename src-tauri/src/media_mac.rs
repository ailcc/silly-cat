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
