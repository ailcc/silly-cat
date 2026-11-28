//! 用户听歌检测：每秒问一次系统「现在有没有软件真的在出声」，有就发
//! 「silly:user-music」事件给前端，猫戴上耳机陪用户一起听。
//!
//! - 只看音频电平 / 进程属性，不录音、不读内容、不上传任何东西。
//! - 真正在出声才戴：持续出声 3 秒戴上；静音或暂停持续 8 秒才摘（避开歌词间隙、
//!   暂停按钮抖一下）。2026-11-28 从「排除通话软件的黑名单」改成「音乐软件白名单」：
//!   只有网易云/QQ音乐/Spotify 等音乐播放器在播放才算听歌，浏览器、IDE 等其它任何
//!   软件出声都不触发（老系统拿不到进程列表时仍退化成设备级检测）。
//! - 和「猫自己空闲听歌」解耦：这里只管电脑有没有声音。
//! - 猫戴着耳机期间一切照常：打字、睡觉、玩彩蛋都不受影响（前端只是多挂一个外观）。

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[cfg(target_os = "macos")]
use crate::media_mac;
#[cfg(windows)]
use crate::media_worker;

/// 戴上 / 摘下各自需要的持续时间
const ON_HOLD: Duration = Duration::from_secs(3);
const OFF_HOLD: Duration = Duration::from_secs(8);
const POLL: Duration = Duration::from_secs(1);
/// 节拍变化超过这个毫秒数就给前端补发一条事件（换歌后跟着新节拍摇）
const BEAT_DELTA: u32 = 20;

static MUSIC_ACTIVE: AtomicBool = AtomicBool::new(false);
static BEAT_MS: AtomicU32 = AtomicU32::new(0);
/// 设置里的开关（默认开）；关掉后不再采样，也不再发事件
static ENABLED: AtomicBool = AtomicBool::new(true);

pub fn is_music_active() -> bool {
    MUSIC_ACTIVE.load(Ordering::Relaxed)
}

#[derive(Debug, Clone, Serialize)]
pub struct UserMusicPayload {
    pub active: bool,
    /// 检测到的节拍周期（毫秒）；0 = 还没检测出来，前端用默认节拍
    pub beat_ms: u32,
}

/// 当前系统有没有软件在出声；None = 这个平台不支持检测
fn sample() -> Option<bool> {
    #[cfg(target_os = "macos")]
    {
        Some(media_mac::sample().0)
    }
    #[cfg(windows)]
    {
        media_worker::latest()
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        None
    }
}

// 节拍采集随平台走（macOS: Process Tap；Windows: WASAPI loopback）；其它平台没有
#[cfg(target_os = "macos")]
fn beat_capture(start: bool) {
    if start {
        media_mac::beat_capture_start();
    } else {
        media_mac::beat_capture_stop();
    }
}
#[cfg(windows)]
fn beat_capture(start: bool) {
    if start {
        crate::media_win::beat_capture::start();
    } else {
        crate::media_win::beat_capture::stop();
    }
}
#[cfg(not(any(target_os = "macos", windows)))]
fn beat_capture(_start: bool) {}

fn emit(app: &AppHandle, active: bool) {
    MUSIC_ACTIVE.store(active, Ordering::Relaxed);
    if !active {
        BEAT_MS.store(0, Ordering::Relaxed);
    }
    let _ = app.emit_to(
        "main",
        "silly:user-music",
        UserMusicPayload {
            active,
            beat_ms: BEAT_MS.load(Ordering::Relaxed),
        },
    );
}

/// 后台轮询线程：状态变化才发事件（前端按事件开关耳机，不轮询）；
/// 戴着期间节拍检测出结果或变化明显时补发一条，让猫换着新节拍摇头晃脑
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut raw_prev = false;
        let mut raw_since = Instant::now();
        let mut wearing = false;
        let mut beat_emitted = 0u32;
        loop {
            std::thread::sleep(POLL);
            if !ENABLED.load(Ordering::Relaxed) {
                if wearing {
                    wearing = false;
                    beat_capture(false);
                    emit(&app, false);
                }
                raw_prev = false;
                raw_since = Instant::now();
                continue;
            }
            let raw = sample().unwrap_or(false);
            let now = Instant::now();
            if raw != raw_prev {
                raw_prev = raw;
                raw_since = now;
            }
            // 持续出声 3 秒才戴，静音 8 秒才摘；戴上时开始采波形估节拍，摘下时停
            let hold = if raw { ON_HOLD } else { OFF_HOLD };
            if raw != wearing && now.duration_since(raw_since) >= hold {
                wearing = raw;
                beat_capture(wearing);
                emit(&app, wearing);
            }
            if wearing {
                let beat = crate::beat_detect::beat_ms();
                if beat != 0 && (beat_emitted == 0 || beat.abs_diff(beat_emitted) >= BEAT_DELTA) {
                    beat_emitted = beat;
                    emit(&app, true);
                }
            } else {
                beat_emitted = 0;
            }
        }
    });
}

#[tauri::command]
pub fn user_music_active() -> bool {
    is_music_active()
}

/// 设置里关掉「电脑出声时戴耳机」后停止采样（省电，也不让耳机再冒出来）
#[tauri::command]
pub fn set_user_music_enabled(app: AppHandle, enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
    if !enabled && MUSIC_ACTIVE.swap(false, Ordering::Relaxed) {
        beat_capture(false);
        let _ = app.emit_to(
            "main",
            "silly:user-music",
            UserMusicPayload {
                active: false,
                beat_ms: 0,
            },
        );
    }
}
