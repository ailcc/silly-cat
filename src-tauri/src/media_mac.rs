// macOS 音频活动检测：只读 CoreAudio HAL 的属性，判断「现在有没有软件真的在出声」。
// - 有按进程列出的能力（macOS 14.2+）时逐个进程看是否在输出：我们能排除通话/会议软件，
//   它们的声音不算「听歌」，免得开个语音就戴耳机。
// - 老系统没有进程列表，只能退化成看默认输出设备在不在跑（无法排除通话软件）。
// - 不录音、不读音频内容，只查音量电平和进程属性。
use std::{ffi::c_void, mem::size_of, ptr};

// 通话 / 会议 / 语音软件：它们在出声也不算听歌（按 bundle id 前缀匹配）。
// com.apple.WebKit.GPU / WebContent：猫自己的音效跑在 WKWebView 的 GPU 进程里（bundle id
// 不是 com.drew.sillycat，单排自己没用），而且 AudioContext 建了之后音频输出 IO 常驻——
// 「正在输出」标记常亮，不排的话猫一打字就给自己戴上耳机（2026-11-27 探针实测）。
// 代价：Safari 等内嵌 WebKit 的浏览器放歌也不会触发（Chrome/Edge 是 Blink 不受影响）。
// com.yourcompany.UZPlayer：zspace 工具的常驻视频组件，不发声也一直占着音频输出 IO，
// 同样会误触发，一并排除。
const EXCLUDED: &[&str] = &[
    "com.tencent.xinWeChat",
    "com.tencent.qq",
    "com.tencent.meeting",
    "com.alibaba.DingTalkMac",
    "com.bytedance.lark",
    "com.electron.lark",
    "us.zoom.xos",
    "com.microsoft.teams",
    "com.microsoft.teams2",
    "com.apple.FaceTime",
    "com.apple.avconferenced",
    "com.apple.systemsoundserverd",
    "com.apple.audio.systemsoundserverd",
    "com.hnc.Discord",
    "com.drew.sillycat", // 猫自己的音效
    "com.apple.WebKit.GPU",
    "com.apple.WebKit.WebContent",
    "com.yourcompany.UZPlayer",
    "cn.trae", // Trae IDE：内嵌浏览器开着猫的调试页面/预览时，页面声音走 Trae 进程，不算听歌
    "com.trae",
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

fn eligible_process(id: u32) -> bool {
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
        // 命令行播放器可能没有 bundle id，照样算。
        if cf.is_null() {
            return true;
        }
        let mut buf = vec![0u8; (CFStringGetLength(cf) * 4 + 1) as usize];
        let ok = CFStringGetCString(cf, buf.as_mut_ptr(), buf.len() as isize, 0x08000100);
        CFRelease(cf);
        if !ok {
            return false;
        }
        let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        let bundle = String::from_utf8_lossy(&buf[..end]);
        !EXCLUDED.iter().any(|&entry| {
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
            audible && process_objects(&list).into_iter().any(eligible_process),
            "process",
        )
    } else {
        (
            audible && unsafe { scalar::<u32>(device, b"gone", GLOBAL, 0) == Some(1) },
            "device",
        )
    }
}
