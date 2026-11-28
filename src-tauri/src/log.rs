//! 错误日志：出问题时把带时间戳的一行写进日志文件，内存里同时留最近几条。
//! 文件在系统日志目录（macOS: ~/Library/Logs/com.drew.sillycat/；Windows:
//! %LOCALAPPDATA%\com.drew.sillycat\logs），超过 256KB 自动轮转成 .old.log，
//! 不会无限膨胀。设置页显示路径 + 导出按钮，方便发给开发者排查问题。
//! 只记错误事件和一句描述，不记用户输入内容、不上传任何东西。

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
};

use serde::Serialize;
use tauri::Manager;
use time::OffsetDateTime;

/// 单个日志文件上限，超过就轮转
const MAX_BYTES: u64 = 256 * 1024;
/// 内存里最多留多少条（导出走文件拷贝，这份 tail 留给以后页面内展示用）
const TAIL_LINES: usize = 200;

struct Log {
    file: Option<PathBuf>,
    lines: Vec<String>,
}

static LOG: Mutex<Log> = Mutex::new(Log {
    file: None,
    lines: Vec::new(),
});

fn timestamp() -> String {
    let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    now.format(&time::macros::format_description!(
        "[year]-[month]-[day] [hour]:[minute]:[second]"
    ))
    .unwrap_or_default()
}

/// 记一条日志。任何线程都能调；自身失败静默——日志系统不能反过来把应用搞挂。
pub fn write(tag: &str, msg: &str) {
    let line = format!("{} [{tag}] {msg}", timestamp());
    let mut log = LOG.lock().unwrap_or_else(|e| e.into_inner());
    log.lines.push(line.clone());
    if log.lines.len() > TAIL_LINES {
        log.lines.remove(0);
    }
    let Some(file) = log.file.clone() else {
        return;
    };
    // 文件超限就轮转：silly-cat.log → silly-cat.old.log（旧的一次留档被顶掉）
    if let Ok(meta) = fs::metadata(&file) {
        if meta.len() >= MAX_BYTES {
            let _ = fs::rename(&file, file.with_file_name("silly-cat.old.log"));
        }
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&file) {
        let _ = writeln!(f, "{line}");
    }
}

/// 启动时调用：定位日志目录；拿不到就只留内存 tail，不写文件
pub fn init(app: &tauri::AppHandle) {
    let Some(dir) = app.path().app_log_dir().ok() else {
        return;
    };
    let _ = fs::create_dir_all(&dir);
    LOG.lock()
        .unwrap_or_else(|e| e.into_inner())
        .file = Some(dir.join("silly-cat.log"));
}

pub fn copy_to(dest: &std::path::Path) -> std::io::Result<()> {
    let file = LOG
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .file
        .clone();
    match file {
        Some(f) => fs::copy(f, dest).map(|_| ()),
        None => Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "日志文件未初始化",
        )),
    }
}

#[derive(Serialize)]
pub struct LogInfo {
    pub path: String,
    pub lines: usize,
}

#[tauri::command]
pub fn log_info() -> LogInfo {
    let log = LOG.lock().unwrap_or_else(|e| e.into_inner());
    LogInfo {
        path: log
            .file
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        lines: log.lines.len(),
    }
}

/// 设置页「导出日志」：弹系统保存对话框让用户选位置，把日志文件拷过去。
/// 返回 None = 用户取消了对话框。
#[tauri::command]
pub async fn export_log(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(dest) = app
        .dialog()
        .file()
        .set_file_name("silly-cat.log")
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let dest = dest.into_path().map_err(|e| e.to_string())?;
    copy_to(&dest).map_err(|e| e.to_string())?;
    write("log", &format!("日志已导出到 {}", dest.display()));
    Ok(Some(dest.display().to_string()))
}
