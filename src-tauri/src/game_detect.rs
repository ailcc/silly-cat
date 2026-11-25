//! 游戏模式检测：每 2 秒看一眼前台窗口，发现全屏游戏就把「silly:game-mode」事件发给前端，
//! 猫自动戴上耳机趴下打盹；游戏退到后台（连续 4 个周期，约 8 秒的 Alt-Tab 宽限）再叫醒它。
//!
//! - 只读前台窗口 / 进程的元数据（Windows 用 PROCESS_QUERY_LIMITED_INFORMATION），
//!   不注入、不读游戏内存，对反作弊安全；轮询间隔 2 秒，CPU 占用约等于零。
//! - 浏览器、播放器、办公聊天软件全屏看视频不触发（排除名单）。
//! - 猫自己的前端不感知设置：这个能力默认开启，检测不到就什么都不发生。

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static GAME_ACTIVE: AtomicBool = AtomicBool::new(false);

#[allow(dead_code)]
pub fn is_game_active() -> bool {
    GAME_ACTIVE.load(Ordering::Relaxed)
}

#[derive(Debug, Clone, Serialize)]
pub struct GameModePayload {
    pub active: bool,
    pub name: Option<String>,
}

/// 永远不当作游戏的程序（浏览器、播放器、办公、聊天、系统壳、游戏启动器本身……全屏放视频也不算）
const EXCLUDED_EXES: &[&str] = &[
    "silly-cat.exe",
    "explorer.exe",
    "searchhost.exe",
    "shellexperiencehost.exe",
    "startmenuexperiencehost.exe",
    "lockapp.exe",
    "applicationframehost.exe",
    "dwm.exe",
    "taskmgr.exe",
    // 浏览器
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "brave.exe",
    "opera.exe",
    "vivaldi.exe",
    "arc.exe",
    "360chrome.exe",
    "360chromex.exe",
    "qqbrowser.exe",
    "sogouexplorer.exe",
    "quark.exe",
    // 播放器 / 音乐
    "vlc.exe",
    "potplayermini64.exe",
    "potplayermini.exe",
    "mpv.exe",
    "mpc-hc64.exe",
    "mpc-be64.exe",
    "wmplayer.exe",
    "bilibili.exe",
    "douyin.exe",
    "qiyi.exe",
    "iqiyi.exe",
    "qqlive.exe",
    "cloudmusic.exe",
    "qqmusic.exe",
    "spotify.exe",
    // 办公 / 聊天 / 直播 / 开发
    "powerpnt.exe",
    "winword.exe",
    "excel.exe",
    "wps.exe",
    "wpp.exe",
    "et.exe",
    "acrobat.exe",
    "code.exe",
    "cursor.exe",
    "devenv.exe",
    "idea64.exe",
    "wechat.exe",
    "weixin.exe",
    "qq.exe",
    "tim.exe",
    "dingtalk.exe",
    "feishu.exe",
    "lark.exe",
    "slack.exe",
    "discord.exe",
    "zoom.exe",
    "wemeetapp.exe",
    "obs64.exe",
    "obs32.exe",
    "mstsc.exe",
    "windowsterminal.exe",
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe",
    // 游戏启动器本体（要等真正的游戏起来才算）
    "steam.exe",
    "steamwebhelper.exe",
    "epicgameslauncher.exe",
    "wegame.exe",
    "tgp_daemon.exe",
    "riotclientservices.exe",
    "riotclientux.exe",
    "battle.net.exe",
    "hyp.exe",
    "hoyoplay.exe",
    "launcher.exe",
    "upc.exe",
    "eadesktop.exe",
];

/// 常见游戏主程序（严格匹配文件名）
const KNOWN_GAME_EXES: &[(&str, &str)] = &[
    ("league of legends.exe", "英雄联盟"),
    ("leagueclientux.exe", "英雄联盟客户端"),
    ("valorant-win64-shipping.exe", "无畏契约"),
    ("cs2.exe", "Counter-Strike 2"),
    ("dota2.exe", "Dota 2"),
    ("r5apex.exe", "Apex 英雄"),
    ("r5apex_dx12.exe", "Apex 英雄"),
    ("tslgame.exe", "绝地求生"),
    ("overwatch.exe", "守望先锋"),
    ("narakabladepoint.exe", "永劫无间"),
    ("deltaforceclient-win64-shipping.exe", "三角洲行动"),
    ("df_client.exe", "三角洲行动"),
    ("crossfire.exe", "穿越火线"),
    ("crossfire_x64.exe", "穿越火线"),
    ("dnf.exe", "地下城与勇士"),
    ("fortniteclient-win64-shipping.exe", "堡垒之夜"),
    ("cod.exe", "使命召唤"),
    ("genshinimpact.exe", "原神"),
    ("yuanshen.exe", "原神"),
    ("starrail.exe", "崩坏：星穹铁道"),
    ("zenlesszonezero.exe", "绝区零"),
    ("bh3.exe", "崩坏3"),
    ("client-win64-shipping.exe", "鸣潮"),
    ("b1-win64-shipping.exe", "黑神话：悟空"),
    ("eldenring.exe", "艾尔登法环"),
    ("sekiro.exe", "只狼"),
    ("cyberpunk2077.exe", "赛博朋克 2077"),
    ("gta5.exe", "GTA V"),
    ("gta5_enhanced.exe", "GTA V"),
    ("rdr2.exe", "荒野大镖客 2"),
    ("witcher3.exe", "巫师 3"),
    ("bg3.exe", "博德之门 3"),
    ("bg3_dx11.exe", "博德之门 3"),
    ("monsterhunterwilds.exe", "怪物猎人：荒野"),
    ("monsterhunterworld.exe", "怪物猎人：世界"),
    ("monsterhunterrise.exe", "怪物猎人：崛起"),
    ("palworld-win64-shipping.exe", "幻兽帕鲁"),
    ("helldivers2.exe", "绝地潜兵 2"),
    ("wow.exe", "魔兽世界"),
    ("wowclassic.exe", "魔兽世界"),
    ("ffxiv_dx11.exe", "最终幻想 14"),
    ("diablo iv.exe", "暗黑破坏神 IV"),
    ("pathofexile.exe", "流放之路"),
    ("pathofexile2.exe", "流放之路 2"),
    ("pathofexilesteam.exe", "流放之路"),
    ("lostark.exe", "命运方舟"),
    ("jx3client.exe", "剑网 3"),
    ("jx3clientx64.exe", "剑网 3"),
    ("nsh.exe", "逆水寒"),
    ("hearthstone.exe", "炉石传说"),
    ("nikke.exe", "NIKKE"),
    ("identityv.exe", "第五人格"),
    ("yys.exe", "阴阳师"),
    ("javaw.exe", "Minecraft"),
    ("java.exe", "Minecraft"),
    ("robloxplayerbeta.exe", "Roblox"),
    ("osu!.exe", "osu!"),
    ("terraria.exe", "泰拉瑞亚"),
    ("stardew valley.exe", "星露谷物语"),
    ("hollow_knight.exe", "空洞骑士"),
    ("celeste.exe", "蔚蓝"),
    ("hades.exe", "Hades"),
    ("hades2.exe", "Hades II"),
    ("balatro.exe", "小丑牌"),
    ("among us.exe", "Among Us"),
    ("lethal company.exe", "致命公司"),
    ("partyanimals.exe", "猛兽派对"),
    ("factorio.exe", "异星工厂"),
    ("rimworldwin64.exe", "边缘世界"),
    ("civilizationvi.exe", "文明 6"),
    ("civilizationvii.exe", "文明 7"),
    ("forzahorizon5.exe", "极限竞速：地平线 5"),
    ("fc24.exe", "EA SPORTS FC 24"),
    ("fc25.exe", "EA SPORTS FC 25"),
    ("nba2k25.exe", "NBA 2K25"),
    ("splitfiction.exe", "双影奇境"),
    ("ittakestwo.exe", "双人成行"),
    ("dontstarve_steam_x64.exe", "饥荒联机版"),
    ("human.exe", "人类一败涂地"),
    ("fallguys_client_game.exe", "糖豆人"),
    ("rocketleague.exe", "火箭联盟"),
    ("deadbydaylight-win64-shipping.exe", "黎明杀机"),
    ("phasmophobia.exe", "恐鬼症"),
    ("rustclient.exe", "Rust"),
    ("valheim.exe", "英灵神殿"),
    ("left4dead2.exe", "求生之路 2"),
    ("hl2.exe", "半条命 2"),
    ("tf_win64.exe", "军团要塞 2"),
    ("destiny2.exe", "命运 2"),
    ("warframe.x64.exe", "Warframe"),
];

/// 大型游戏平台的游戏库目录（进程在这些目录下八成是游戏）。仅 Windows 分类用得到
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const GAME_LIBRARY_PATH_MARKERS: &[&str] = &[
    "\\steamapps\\common\\",
    "\\epic games\\",
    "\\riot games\\",
    "\\wegameapps\\",
    "\\rail_apps\\",
    "\\hoyoplay\\games\\",
    "\\mihoyo\\",
    "\\ubisoft game launcher\\games\\",
    "\\ea games\\",
    "\\xboxgames\\",
    "\\gog galaxy\\games\\",
    "\\blizzard\\",
];

/// 启动器周边进程的常见字样（库目录命中但文件名带这些字样时不算游戏）。仅 Windows 分类用得到
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const NON_GAME_HELPER_WORDS: &[&str] = &[
    "launcher", "updater", "update", "crash", "reporter", "unins", "setup", "install",
    "redist", "vcredist", "anticheat", "helper", "cef", "webhelper", "config", "overlay",
    "patcher", "eac", "easyanticheat",
];

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn clean_display_name(exe_name: &str, window_title: &str) -> String {
    let title = window_title.trim();
    if !title.is_empty() && title.chars().count() <= 48 {
        return title.to_string();
    }
    exe_name.trim_end_matches(".exe").to_string()
}

/// Windows 前台窗口分类：命中返回游戏名，否则 None
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn classify_windows_foreground(
    exe_path: &str,
    window_title: &str,
    is_d3d_fullscreen: bool,
) -> Option<String> {
    let path_lower = exe_path.trim().replace('/', "\\").to_ascii_lowercase();
    let exe_name = path_lower.rsplit('\\').next().unwrap_or("");
    if exe_name.is_empty() || EXCLUDED_EXES.contains(&exe_name) {
        return None;
    }
    // 1) 已知游戏主程序
    for &(known_exe, display) in KNOWN_GAME_EXES {
        if exe_name == known_exe {
            // Java 程序只有标题里带 Minecraft / 我的世界才算（java.exe 可能是任何东西）
            if exe_name == "javaw.exe" || exe_name == "java.exe" {
                let t = window_title.to_ascii_lowercase();
                if t.contains("minecraft") || window_title.contains("我的世界") {
                    return Some("Minecraft".to_string());
                }
                continue;
            }
            return Some(display.to_string());
        }
    }
    let helper = NON_GAME_HELPER_WORDS.iter().any(|w| exe_name.contains(w));
    // 2) 虚幻引擎 shipping 命名规则（*-Win64-Shipping.exe 等）
    if !helper
        && (exe_name.ends_with("-win64-shipping.exe")
            || exe_name.ends_with("-wingdk-shipping.exe")
            || exe_name.ends_with("_shipping.exe"))
    {
        return Some(clean_display_name(exe_name, window_title));
    }
    // 3) 进程在游戏平台的库目录里
    if !helper && GAME_LIBRARY_PATH_MARKERS.iter().any(|m| path_lower.contains(m)) {
        return Some(clean_display_name(exe_name, window_title));
    }
    // 4) 系统「正在运行独占全屏（D3D）」状态：未知的全屏程序大概率是游戏
    if is_d3d_fullscreen && !helper {
        return Some(clean_display_name(exe_name, window_title));
    }
    None
}

/// macOS 前台应用分类：按 bundle id / 应用名关键词
#[cfg(target_os = "macos")]
pub fn classify_macos_foreground(bundle_id: &str, app_name: &str) -> Option<String> {
    let bid = bundle_id.trim().to_ascii_lowercase();
    let name = app_name.trim();
    let name_lower = name.to_ascii_lowercase();
    if bid.is_empty() && name_lower.is_empty() {
        return None;
    }
    // 系统与日常应用不触发
    if bid.starts_with("com.apple.")
        || bid.contains("google.chrome")
        || bid.contains("microsoft.edgemac")
        || bid.contains("mozilla.firefox")
        || bid.contains("brave")
        || bid.contains("vscode")
        || bid.contains("com.tencent.wechat")
        || bid.contains("com.qq")
        || bid.contains("obsproject")
        || bid.contains("videolan.vlc")
        || bid.contains("com.kaonashi.iina")
        || bid.contains("silly-cat")
    {
        return None;
    }
    const MAC_GAME_KEYWORDS: &[&str] = &[
        "riotgames",
        "leagueoflegends",
        "blizzard",
        "hearthstone",
        "worldofwarcraft",
        "mihoyo",
        "hoyoverse",
        "genshin",
        "starrail",
        "minecraft",
        "roblox",
        "dota2",
        "csgo",
        "baldursgate3",
        "larian",
        "stardewvalley",
        "hollowknight",
        "hades",
        "balatro",
        "factorio",
        "rimworld",
        "civilization",
        "osu!",
        "unity.player",
        "unrealengine",
        "valvesoftware.source",
    ];
    if MAC_GAME_KEYWORDS
        .iter()
        .any(|k| bid.contains(k) || name_lower.contains(k))
    {
        return Some(if name.is_empty() { bid } else { name.to_string() });
    }
    None
}

/// 后台轮询线程：发现游戏 -> 发事件；游戏退场连续 4 个周期（约 8 秒，Alt-Tab 宽限）才撤
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut active = false;
        let mut active_name: Option<String> = None;
        let mut clear_streak: u8 = 0;
        const CLEAR_GRACE_TICKS: u8 = 4;

        loop {
            std::thread::sleep(Duration::from_millis(2000));

            #[cfg(target_os = "windows")]
            let detected = win_impl::detect_foreground_game();
            #[cfg(target_os = "macos")]
            let detected = mac_impl::detect_foreground_game();
            #[cfg(all(not(windows), not(target_os = "macos")))]
            let detected: Option<String> = None;

            if let Some(game_name) = detected {
                clear_streak = 0;
                if !active || active_name.as_deref() != Some(game_name.as_str()) {
                    active = true;
                    active_name = Some(game_name.clone());
                    GAME_ACTIVE.store(true, Ordering::Relaxed);
                    let _ = app.emit_to(
                        "main",
                        "silly:game-mode",
                        GameModePayload { active: true, name: Some(game_name) },
                    );
                }
            } else if active {
                clear_streak = clear_streak.saturating_add(1);
                if clear_streak >= CLEAR_GRACE_TICKS {
                    active = false;
                    active_name = None;
                    clear_streak = 0;
                    GAME_ACTIVE.store(false, Ordering::Relaxed);
                    let _ = app.emit_to(
                        "main",
                        "silly:game-mode",
                        GameModePayload { active: false, name: None },
                    );
                }
            }
        }
    });
}

#[cfg(target_os = "windows")]
mod win_impl {
    use super::{classify_windows_foreground, NON_GAME_HELPER_WORDS};
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    pub fn detect_foreground_game() -> Option<String> {
        unsafe {
            let fg = GetForegroundWindow();
            if fg.is_null() {
                return None;
            }
            let mut quns: i32 = 0;
            let is_d3d_fs = SHQueryUserNotificationState(&mut quns) == 0
                && quns == QUNS_RUNNING_D3D_FULL_SCREEN;
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(fg, &mut pid);
            if pid == 0 {
                return None;
            }
            let hproc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if hproc.is_null() {
                return None;
            }
            let mut path_buf = [0u16; 512];
            let mut path_len: u32 = path_buf.len() as u32;
            let ok = QueryFullProcessImageNameW(hproc, 0, path_buf.as_mut_ptr(), &mut path_len);
            CloseHandle(hproc);
            if ok == 0 || path_len == 0 {
                return None;
            }
            let exe_path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
            let mut title_buf = [0u16; 160];
            let title_len = GetWindowTextW(fg, title_buf.as_mut_ptr(), title_buf.len() as i32);
            let window_title = if title_len > 0 {
                String::from_utf16_lossy(&title_buf[..title_len as usize])
            } else {
                String::new()
            };
            let _ = NON_GAME_HELPER_WORDS;
            classify_windows_foreground(&exe_path, &window_title, is_d3d_fs)
        }
    }
}

#[cfg(target_os = "macos")]
mod mac_impl {
    use super::classify_macos_foreground;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use std::os::raw::c_void;

    type CFStringRef = *const c_void;

    extern "C" {
        fn CFStringGetLength(s: CFStringRef) -> isize;
        fn CFStringGetCString(s: CFStringRef, buf: *mut u8, size: isize, encoding: u32) -> bool;
    }

    const K_CFSTRING_ENCODING_UTF8: u32 = 0x0800_0100;

    unsafe fn nsstr_to_string(p: CFStringRef) -> String {
        if p.is_null() {
            return String::new();
        }
        let len = CFStringGetLength(p);
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u8; (len as usize + 1) * 4];
        if CFStringGetCString(p, buf.as_mut_ptr(), buf.len() as isize, K_CFSTRING_ENCODING_UTF8) {
            let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
            String::from_utf8_lossy(&buf[..end]).into_owned()
        } else {
            String::new()
        }
    }

    pub fn detect_foreground_game() -> Option<String> {
        unsafe {
            let cls = AnyClass::get(c"NSWorkspace")?;
            let ws: *mut AnyObject = msg_send![cls, sharedWorkspace];
            if ws.is_null() {
                return None;
            }
            let app: *mut AnyObject = msg_send![ws, frontmostApplication];
            if app.is_null() {
                return None;
            }
            let bid: CFStringRef = msg_send![app, bundleIdentifier];
            let name: CFStringRef = msg_send![app, localizedName];
            classify_macos_foreground(&nsstr_to_string(bid), &nsstr_to_string(name))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{classify_macos_foreground, classify_windows_foreground};

    #[cfg(target_os = "windows")]
    #[test]
    fn recognizes_known_games_and_engine_paths() {
        assert_eq!(
            classify_windows_foreground(
                r"C:\Riot Games\VALORANT\live\ShooterGame\Binaries\Win64\VALORANT-Win64-Shipping.exe",
                "VALORANT", false
            )
            .as_deref(),
            Some("VALORANT")
        );
        assert_eq!(
            classify_windows_foreground(r"D:\SteamLibrary\steamapps\common\Hollow Knight Silksong\Silksong.exe", "Silksong", false).as_deref(),
            Some("Silksong")
        );
        assert!(classify_windows_foreground(r"D:\Games\SpaceRacer.exe", "Space Racer", true).is_some());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn rejects_browsers_video_players_and_launchers() {
        assert!(classify_windows_foreground(r"C:\Program Files\Google\Chrome\Application\chrome.exe", "YouTube", true).is_none());
        assert!(classify_windows_foreground(r"C:\Program Files\VideoLAN\VLC\vlc.exe", "Movie.mp4", true).is_none());
        assert!(classify_windows_foreground(r"C:\Program Files (x86)\Steam\steam.exe", "Steam", false).is_none());
        assert!(classify_windows_foreground(r"C:\Program Files\Java\bin\javaw.exe", "IntelliJ Helper", false).is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_classification() {
        assert!(classify_macos_foreground("com.google.Chrome", "Google Chrome").is_none());
        assert!(classify_macos_foreground("com.riotgames.LeagueOfLegends", "League of Legends").is_some());
    }
}
