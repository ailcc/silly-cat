use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::PublicKey;
use serde::Serialize;
use serde_json::Value;
use std::{io, path::Path, process::Command, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Error, Update, UpdaterExt};
use tokio::sync::{watch, Mutex as AsyncMutex};

const RELEASES: &str = "https://github.com/ailcc/silly-cat/releases";

#[derive(Clone, Serialize)]
#[serde(rename_all = "lowercase")]
enum NoticeKind {
    Checking,
    Result,
    Offer,
    Progress,
    Failed,
}

#[derive(Clone, Serialize)]
pub struct Notice {
    kind: NoticeKind,
    title: String,
    detail: String,
    installable: bool,
}

struct Offer {
    update: Update,
    manual: bool,
}

struct Updates {
    configured: bool,
    auto: watch::Sender<bool>,
    // Holding this guard serializes manifest checks with downloads and installation.
    candidate: AsyncMutex<Option<Offer>>,
    notice: Mutex<Option<Notice>>,
}

fn valid_key(config: Option<&Value>) -> bool {
    let Some(key) = config.and_then(|c| c.get("pubkey")).and_then(Value::as_str) else {
        return false;
    };
    STANDARD
        .decode(key)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .is_some_and(|s| PublicKey::decode(&s).is_ok())
}

fn auto_enabled(settings: &Value) -> bool {
    settings["autoUpdate"].as_bool().unwrap_or(true)
}

pub fn set_auto(app: &AppHandle, settings: &Value) {
    let enabled = auto_enabled(settings);
    let changed = app.state::<Updates>().auto.send_if_modified(|value| {
        let changed = *value != enabled;
        *value = enabled;
        changed
    });
    if changed && !enabled {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<Updates>();
            let mut offer = state.candidate.lock().await;
            if offer.as_ref().is_some_and(|o| !o.manual) && !*state.auto.borrow() {
                *offer = None;
                clear_notice(&app);
            }
        });
    }
}

fn clear_notice(app: &AppHandle) {
    *app.state::<Updates>().notice.lock().unwrap() = None;
    let _ = app.emit("silly:update", Option::<Notice>::None);
}

pub fn setup(app: &AppHandle) {
    let configured = valid_key(app.config().plugins.0.get("updater"))
        && app
            .plugin(tauri_plugin_updater::Builder::new().build())
            .is_ok();
    let settings = super::load_settings(app.clone()).unwrap_or_default();
    let (auto, mut enabled) = watch::channel(auto_enabled(&settings));
    app.manage(Updates {
        configured,
        auto,
        candidate: AsyncMutex::new(None),
        notice: Mutex::new(None),
    });
    if configured {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                if enabled.wait_for(|on| *on).await.is_err() {
                    return;
                }
                // Restart the initial delay whenever the user enables checks.
                let schedule = async {
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    loop {
                        check(&app, false).await;
                        tokio::time::sleep(Duration::from_secs(24 * 3600)).await;
                    }
                };
                tokio::select! {
                    biased;
                    _ = enabled.changed() => {}
                    _ = schedule => {}
                }
            }
        });
    }
}

#[tauri::command]
pub fn updater_configured(app: AppHandle) -> bool {
    app.state::<Updates>().configured
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> Option<Notice> {
    app.state::<Updates>().notice.lock().unwrap().clone()
}

fn notify(
    app: &AppHandle,
    kind: NoticeKind,
    title: impl Into<String>,
    detail: impl Into<String>,
    installable: bool,
) {
    let notice = Notice {
        kind,
        title: title.into(),
        detail: detail.into(),
        installable,
    };
    *app.state::<Updates>().notice.lock().unwrap() = Some(notice.clone());
    let _ = app.emit("silly:update", notice);
}

pub fn manual_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move { check(&app, true).await });
}

fn reason(error: &Error) -> String {
    match error {
        Error::ReleaseNotFound => "未找到更新清单".into(),
        Error::Reqwest(e) if e.is_timeout() => "网络超时".into(),
        Error::Reqwest(_) | Error::Network(_) => "网络请求失败".into(),
        Error::TargetNotFound(_) | Error::TargetsNotFound(_) => "没有适用此平台的更新包".into(),
        Error::Serialization(_) => "更新清单格式错误".into(),
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) => "更新签名无效".into(),
        _ => error.to_string().chars().take(60).collect(),
    }
}

async fn check(app: &AppHandle, manual: bool) {
    let state = app.state::<Updates>();
    if !state.configured {
        if manual {
            notify(app, NoticeKind::Result, "检查失败", "未配置更新密钥", false);
        }
        return;
    }
    let mut candidate = state.candidate.lock().await;
    if manual {
        notify(app, NoticeKind::Checking, "正在检查更新…", "", false);
    } else if !*state.auto.borrow() {
        return;
    }
    let result = match app
        .updater_builder()
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };
    match result {
        Ok(Some(mut update)) => {
            // The archive may be much larger than its manifest.
            update.timeout = Some(Duration::from_secs(10 * 60));
            let title = format!("有新版本 v{}", update.version);
            *candidate = Some(Offer { update, manual });
            notify(app, NoticeKind::Offer, title, "点这里更新", true);
        }
        Ok(None) => {
            let had_update = candidate.take().is_some();
            if manual || had_update {
                notify(app, NoticeKind::Result, "已是最新版本", "", false);
            }
        }
        Err(e) if manual => {
            *candidate = None;
            notify(app, NoticeKind::Result, "检查失败", reason(&e), false);
        }
        Err(_) => {}
    }
}

// macOS replaces the entire .app in its parent directory. A current-user NSIS
// installation replaces files in the executable's directory.
fn probe_install_dir(exe: &Path) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    let target = exe
        .ancestors()
        .find(|p| p.extension().is_some_and(|ext| ext == "app"));
    #[cfg(not(target_os = "macos"))]
    let target = Some(exe);
    let dir = target
        .and_then(Path::parent)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "找不到已安装的应用"))?;
    tempfile::tempfile_in(dir).map(drop)
}

pub(crate) fn open_in_browser(url: &str) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("/usr/bin/open");
    #[cfg(target_os = "windows")]
    let mut cmd = Command::new("explorer.exe");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = Command::new("xdg-open");
    cmd.arg(url).spawn().map(|_| ())
}

fn fallback(app: &AppHandle) {
    let detail = if open_in_browser(RELEASES).is_ok() {
        "请到发布页下载安装包"
    } else {
        RELEASES
    };
    notify(app, NoticeKind::Failed, "安装目录不可写", detail, false);
}

fn unwritable(e: &io::Error) -> bool {
    // ErrorKind::ReadOnlyFilesystem 要 Rust 1.83 才稳定，Win7 版用 Rust 1.77.2 构建，
    // 所以直接比对 EROFS（macOS 和 Linux 上都是 30）。
    let read_only = cfg!(unix) && e.raw_os_error() == Some(30);
    read_only || e.kind() == io::ErrorKind::PermissionDenied
}

#[tauri::command]
pub async fn install_update(app: AppHandle) {
    let state = app.state::<Updates>();
    let mut candidate = state.candidate.lock().await;
    let Some(Offer { update, manual }) = candidate.take() else {
        return;
    };
    if !manual && !*state.auto.borrow() {
        clear_notice(&app);
        return;
    }
    if let Err(e) = std::env::current_exe().and_then(|path| probe_install_dir(&path)) {
        if unwritable(&e) {
            fallback(&app);
        } else {
            *candidate = Some(Offer { update, manual });
            notify(
                &app,
                NoticeKind::Failed,
                "无法开始安装",
                e.to_string(),
                true,
            );
        }
        return;
    }
    notify(
        &app,
        NoticeKind::Progress,
        "正在下载更新",
        "准备下载…",
        false,
    );
    let mut received = 0u64;
    let mut last_progress = None;
    let result = update
        .download_and_install(
            |chunk, total| {
                received += chunk as u64;
                let progress = if let Some(total) = total.filter(|&n| n > 0) {
                    format!("{}%", received.saturating_mul(100) / total)
                } else {
                    format!("{} KiB", (received / 65536) * 64)
                };
                if last_progress.as_ref() != Some(&progress) {
                    notify(&app, NoticeKind::Progress, "正在下载更新", &progress, false);
                    last_progress = Some(progress);
                }
            },
            || {
                notify(
                    &app,
                    NoticeKind::Progress,
                    "正在校验并安装",
                    "完成后自动重启",
                    false,
                )
            },
        )
        .await;
    match result {
        Ok(()) => app.restart(),
        Err(Error::Io(e)) if unwritable(&e) => fallback(&app),
        Err(e) => {
            *candidate = Some(Offer { update, manual });
            notify(&app, NoticeKind::Failed, "更新失败", reason(&e), true);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn incomplete_keys_disable_plugin() {
        assert!(!valid_key(None));
        for config in [
            json!({}),
            json!({"pubkey":null}),
            json!({"pubkey":"REPLACE_WITH_UPDATER_PUBLIC_KEY"}),
            json!({"pubkey":STANDARD.encode("not a minisign key")}),
        ] {
            assert!(!valid_key(Some(&config)));
        }
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert!(valid_key(config.pointer("/plugins/updater")));
    }

    #[test]
    fn auto_setting_matches_frontend() {
        for settings in [
            json!({}),
            json!(null),
            json!({"autoUpdate":"false"}),
            json!({"autoUpdate":true}),
        ] {
            assert!(auto_enabled(&settings));
        }
        assert!(!auto_enabled(&json!({"autoUpdate":false})));
    }

    // Requires loopback bind, which is disabled in some build sandboxes.
    #[test]
    #[ignore = "requires a local TCP listener"]
    fn check_loopback_manifest() {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;
        use tauri::test::{mock_builder, mock_context, noop_assets};

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/latest.json", listener.local_addr().unwrap());
        let mut context = mock_context(noop_assets());
        let current = context.package_info().version.to_string();
        context.config_mut().plugins.0.insert(
            "updater".into(),
            json!({
                "endpoints": [endpoint], "pubkey": "", "dangerousInsecureTransportProtocol": true
            }),
        );
        let builder = mock_builder();
        #[cfg(target_os = "macos")]
        let builder = builder.enable_macos_default_menu(false);
        let app = builder.build(context).unwrap();
        app.handle()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .unwrap();
        let checker = app
            .updater_builder()
            .executable_path("Mock.app/Contents/MacOS/test")
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let server = std::thread::spawn(move || {
            for version in ["9.0.0", &current] {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut lines = BufReader::new(&stream).lines();
                assert_eq!(lines.next().unwrap().unwrap(), "GET /latest.json HTTP/1.1");
                for line in lines {
                    if line.unwrap().is_empty() {
                        break;
                    }
                }
                let manifest =
                    json!({"version":version, "signature":"test", "url":"http://127.0.0.1/test"})
                        .to_string();
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    manifest.len(),
                    manifest
                )
                .unwrap();
            }
        });
        tauri::async_runtime::block_on(async {
            assert_eq!(checker.check().await.unwrap().unwrap().version, "9.0.0");
            assert!(checker.check().await.unwrap().is_none());
        });
        server.join().unwrap();
    }

    #[cfg(target_os = "macos")]
    mod install {
        use super::*;
        use flate2::{write::GzEncoder, Compression};
        use ring::{
            rand::SystemRandom,
            signature::{Ed25519KeyPair, KeyPair},
        };
        use std::{
            collections::BTreeMap,
            fs,
            io::{BufRead, BufReader, Write},
            net::TcpListener,
            os::unix::fs::PermissionsExt,
            path::PathBuf,
        };
        use tauri::test::{mock_builder, mock_context, noop_assets};

        const BUNDLE: &str = "SillyCat.app";
        const EXE: &str = "Contents/MacOS/silly-cat";
        const ARCHIVE: &str = "SillyCat.app.tar.gz";
        const OLD: &str = "0.0.4";
        const NEW: &str = "0.0.5";

        fn bundle(parent: &Path, version: &str) -> PathBuf {
            let app = parent.join(BUNDLE);
            fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
            let plist = format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.drew.sillycat.updatertest</string>
<key>CFBundleShortVersionString</key><string>{version}</string>
</dict></plist>"#
            );
            fs::write(app.join("Contents/Info.plist"), plist).unwrap();
            fs::write(app.join(EXE), format!("inert test file {version}")).unwrap();
            app
        }

        // Include directories so an empty leftover directory also fails equality.
        fn tree(root: &Path) -> BTreeMap<PathBuf, Option<Vec<u8>>> {
            let mut entries = BTreeMap::new();
            for entry in fs::read_dir(root).unwrap() {
                let entry = entry.unwrap();
                let name = PathBuf::from(entry.file_name());
                let kind = entry.file_type().unwrap();
                if kind.is_dir() {
                    entries.insert(name.clone(), None);
                    entries.extend(
                        tree(&entry.path())
                            .into_iter()
                            .map(|(p, bytes)| (name.join(p), bytes)),
                    );
                } else {
                    assert!(kind.is_file());
                    entries.insert(name, Some(fs::read(entry.path()).unwrap()));
                }
            }
            entries
        }

        fn keypair() -> Ed25519KeyPair {
            let secret = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
            Ed25519KeyPair::from_pkcs8(secret.as_ref()).unwrap()
        }

        // Minisign's direct Ed25519 ("Ed") packet: algorithm, 8-byte key id, payload.
        fn packet(key: &Ed25519KeyPair, payload: &[u8]) -> String {
            STANDARD.encode([b"Ed", &key.public_key().as_ref()[..8], payload].concat())
        }

        fn signature(key: &Ed25519KeyPair, bytes: &[u8], comment: &str) -> String {
            let sig = key.sign(bytes);
            let global = key.sign(&[sig.as_ref(), comment.as_bytes()].concat());
            STANDARD.encode(format!(
                "untrusted comment: test\n{}\ntrusted comment: {comment}\n{}\n",
                packet(key, sig.as_ref()),
                STANDARD.encode(global.as_ref())
            ))
        }

        enum Scenario {
            Valid,
            WrongKey,
            MissingVersion,
            Tampered,
        }

        fn exercise(scenario: Scenario) {
            let temp = tempfile::tempdir().unwrap();
            let old = temp.path().join("Old");
            let installed = bundle(&old, OLD);
            let new = temp.path().join("New");
            let replacement = bundle(&new, NEW);
            let before = tree(&old);
            let mut archive = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
            archive.append_dir_all(BUNDLE, replacement).unwrap();
            let mut bytes = archive.into_inner().unwrap().finish().unwrap();

            let trusted = keypair();
            let pubkey = STANDARD.encode(format!(
                "untrusted comment: test\n{}\n",
                packet(&trusted, trusted.public_key().as_ref())
            ));
            let mut comment = format!("timestamp:1\tfile:{ARCHIVE}");
            if !matches!(scenario, Scenario::MissingVersion) {
                comment.push_str(&format!("\tversion:{NEW}"));
            }
            let sig = match scenario {
                Scenario::WrongKey => signature(&keypair(), &bytes, &comment),
                _ => signature(&trusted, &bytes, &comment),
            };
            if matches!(scenario, Scenario::Tampered) {
                bytes[0] ^= 1;
            }

            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let origin = format!("http://{}", listener.local_addr().unwrap());
            let target = format!("darwin-{}", std::env::consts::ARCH);
            let artifact = json!({"url": format!("{origin}/{ARCHIVE}"), "signature":sig});
            let manifest = json!({"version":NEW, "platforms":{
                (format!("{target}-app")):artifact, (target):artifact
            }})
            .to_string()
            .into_bytes();
            let server = std::thread::spawn(move || {
                for (path, body) in [("latest.json", manifest), (ARCHIVE, bytes)] {
                    let (mut stream, _) = listener.accept().unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(5)))
                        .unwrap();
                    let mut lines = BufReader::new(&stream).lines();
                    assert_eq!(
                        lines.next().unwrap().unwrap(),
                        format!("GET /{path} HTTP/1.1")
                    );
                    for line in lines {
                        if line.unwrap().is_empty() {
                            break;
                        }
                    }
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .unwrap();
                    stream.write_all(&body).unwrap();
                }
            });

            // mock_app's default package version is 0.1.0; configure the same mock runtime as 0.0.4.
            let mut context = mock_context(noop_assets());
            context.package_info_mut().version = OLD.parse().unwrap();
            context.config_mut().plugins.0.insert(
                "updater".into(),
                json!({
                    "dangerousInsecureTransportProtocol":true, "requireSignedVersion":true,
                    "pubkey":pubkey, "endpoints":[format!("{origin}/latest.json")]
                }),
            );
            let app = mock_builder().build(context).unwrap();
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .unwrap();
            let updater = app
                .updater_builder()
                .executable_path(installed.join(EXE))
                .no_proxy()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap();
            let result = tauri::async_runtime::block_on(async {
                let update = updater.check().await.unwrap().unwrap();
                assert_eq!(update.version, NEW);
                update.download_and_install(|_, _| {}, || {}).await
            });
            match scenario {
                Scenario::Valid => {
                    result.unwrap();
                    assert_eq!(tree(&old), tree(&new));
                }
                Scenario::MissingVersion => {
                    assert!(
                        matches!(result, Err(Error::MissingSignedVersion)),
                        "{result:?}"
                    );
                    assert_eq!(tree(&old), before);
                }
                Scenario::WrongKey | Scenario::Tampered => {
                    assert!(matches!(result, Err(Error::Minisign(_))), "{result:?}");
                    assert_eq!(tree(&old), before);
                }
            }
            server.join().unwrap();
        }

        #[test]
        #[ignore = "requires a local TCP listener"]
        fn signed_archive_replaces_bundle() {
            // Isolate the plugin's system-temp backup and extraction paths from parallel tests.
            const CHILD: &str = "SILLY_CAT_UPDATER_CLEANUP_TEST_CHILD";
            if std::env::var_os(CHILD).is_some() {
                exercise(Scenario::Valid);
                return;
            }
            let temp = tempfile::tempdir().unwrap();
            let test = std::thread::current();
            let output = Command::new(std::env::current_exe().unwrap())
                .args(["--ignored", "--exact", test.name().unwrap()])
                .env("TMPDIR", temp.path())
                .env(CHILD, "1")
                .output()
                .unwrap();
            let stdout = String::from_utf8_lossy(&output.stdout);
            assert!(
                output.status.success() && stdout.contains("1 passed"),
                "{stdout}\n{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(tree(temp.path()).is_empty());
        }

        #[test]
        #[ignore = "requires a local TCP listener"]
        fn wrong_signing_key_preserves_bundle() {
            exercise(Scenario::WrongKey);
        }

        #[test]
        #[ignore = "requires a local TCP listener"]
        fn missing_signed_version_preserves_bundle() {
            exercise(Scenario::MissingVersion);
        }

        #[test]
        #[ignore = "requires a local TCP listener"]
        fn tampered_archive_preserves_bundle() {
            exercise(Scenario::Tampered);
        }

        #[test]
        #[ignore = "requires a local TCP listener"]
        fn read_only_install_parent_is_unwritable() {
            let temp = tempfile::tempdir().unwrap();
            let old = temp.path().join("Old");
            let exe = bundle(&old, OLD).join(EXE);
            let original = fs::metadata(&old).unwrap().permissions();
            fs::set_permissions(&old, fs::Permissions::from_mode(0o555)).unwrap();
            let result = probe_install_dir(&exe);
            fs::set_permissions(&old, original).unwrap();
            let error = result.unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
            assert!(unwritable(&error));
        }
    }
}
