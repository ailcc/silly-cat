//! 用户听歌检测：每 4 秒扫一遍系统进程列表，发现音乐软件在跑就发「silly:user-music」
//! 事件给前端，猫戴上耳机陪用户一起听。
//!
//! - 只读进程名做匹配，不碰音频接口、不读窗口内容，CPU 占用约等于零。
//! - 音乐软件**暂停**时进程还在——耳机照戴；**退出**时进程消失——才摘耳机。
//!   正好和「猫自己空闲听歌」的判断解耦：这里只管软件开没开。
//! - 猫戴着耳机期间一切照常：打字、睡觉、玩彩蛋都不受影响（前端只是多挂一个外观）。

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static MUSIC_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn is_music_active() -> bool {
    MUSIC_ACTIVE.load(Ordering::Relaxed)
}

#[derive(Debug, Clone, Serialize)]
pub struct UserMusicPayload {
    pub active: bool,
}

/// 常见音乐软件的进程名（小写、去掉 .exe 后严格匹配）。
/// 有漏掉的软件不影响功能——只是猫不戴耳机，别的照常。
const MUSIC_APPS: &[&str] = &[
    // 网易云音乐（Windows: cloudmusic.exe / macOS: NeteaseMusic）
    "cloudmusic", "neteasemusic",
    // QQ 音乐
    "qqmusic",
    // 酷狗 / 酷我
    "kugou", "kwmusic", "kuwo",
    // Apple Music（macOS 进程名就是 Music；微软商店版是 AppleMusic.exe）
    "music", "applemusic",
    // 汽水音乐（字节）
    "sodamusic",
    // Spotify / Tidal / Deezer
    "spotify", "tidal", "deezer",
    // 洛雪音乐 / Listen1
    "lx-music", "listen1",
    // 老牌本地播放器
    "foobar2000", "aimp", "musicbee",
];

/// 进程名（原样，含 .exe / 路径）是否是音乐软件：取末段、去 .exe、转小写后查表
fn is_music_process(raw: &str) -> bool {
    let name = raw.trim().replace('\\', "/");
    let name = name.rsplit('/').next().unwrap_or("");
    let name = name.strip_suffix(".exe").unwrap_or(name);
    let name = name.trim().to_ascii_lowercase();
    !name.is_empty() && MUSIC_APPS.contains(&name.as_str())
}

#[cfg(target_os = "macos")]
fn scan_music_process() -> bool {
    let ok = std::process::Command::new("ps")
        .args(["-axo", "comm="])
        .output();
    match ok {
        Ok(out) => String::from_utf8_lossy(&out.stdout)
            .lines()
            .any(is_music_process),
        Err(_) => false,
    }
}

#[cfg(target_os = "windows")]
fn scan_music_process() -> bool {
    use std::os::windows::process::CommandExt;
    // tasklist /fo csv /nh：每行 "名称","PID",... 取第一个引号字段
    let ok = std::process::Command::new("tasklist")
        .args(["/fo", "csv", "/nh"])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW，不闪黑框
        .output();
    match ok {
        Ok(out) => String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|line| line.split('"').nth(1))
            .any(is_music_process),
        Err(_) => false,
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn scan_music_process() -> bool {
    false
}

/// 后台轮询线程：状态变化才发事件（前端按事件开关耳机，不轮询）
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut active = false;
        loop {
            std::thread::sleep(Duration::from_millis(4000));
            let now = scan_music_process();
            if now != active {
                active = now;
                MUSIC_ACTIVE.store(now, Ordering::Relaxed);
                let _ = app.emit_to("main", "silly:user-music", UserMusicPayload { active: now });
            }
        }
    });
}

#[tauri::command]
pub fn user_music_active() -> bool {
    is_music_active()
}

#[cfg(test)]
mod tests {
    use super::is_music_process;

    #[test]
    fn matches_common_music_apps() {
        assert!(is_music_process("cloudmusic.exe"));
        assert!(is_music_process("/Applications/NeteaseMusic.app/Contents/MacOS/NeteaseMusic"));
        assert!(is_music_process("QQMusic.exe"));
        assert!(is_music_process("Music")); // Apple Music
        assert!(is_music_process("Spotify"));
        assert!(is_music_process("kugou.exe"));
        assert!(is_music_process("sodamusic.exe"));
    }

    #[test]
    fn rejects_non_music_and_partial_matches() {
        assert!(!is_music_process("chrome.exe"));
        assert!(!is_music_process("vlc.exe"));
        assert!(!is_music_process("MuseScore.exe")); // 带 music 但不是音乐软件
        assert!(!is_music_process("explorer.exe"));
        assert!(!is_music_process(""));
        assert!(!is_music_process("cloudmusic_helper.exe")); // 严格匹配，不认衍生进程
    }
}
