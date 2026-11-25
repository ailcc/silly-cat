//! MCP 外观接口（设置开关默认关）：本地回环 HTTP 服务 `http://127.0.0.1:<mcpPort>/mcp`，
//! 让 Claude / Cursor 这类 AI 助手直接给桌面猫「换装」——换品种、换画风、调大小，改完
//! 立刻热重载到屏幕上的猫。只监听 127.0.0.1，外面连不上。
//!
//! 服务在应用启动时就开始监听（常驻）：开关关着时所有请求都回 403；开关热切换不用重启
//! 应用。注意端口在启动时绑定一次，改 mcpPort 要重启应用才生效。
//!
//! 工具：
//! - get_appearance：读当前猫品种 / 画风 / 大小，附可用值清单
//! - set_appearance：改 cat / artStyle / size（校验规则和设置页完全一致）
//!
//! 传输是轻量 Streamable HTTP（JSON-RPC 2.0），不引额外依赖；GET /health 给探活。

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

const SERVER_NAME: &str = "silly-cat";
const DEFAULT_PORT: u16 = 48620;

/// 和前端 settings.js 的 CATS 列表保持一致
const CATS: &[&str] = &["cow", "orange", "lihua", "siamese", "black", "calico", "blue", "white", "maine", "sphynx"];
const SIZE_MIN: f64 = 0.5;
const SIZE_MAX: f64 = 2.0;

/// 开关和端口由设置页控制（save_settings 每次写盘都会同步过来）
static ENABLED: AtomicBool = AtomicBool::new(false);
static PORT: Mutex<u16> = Mutex::new(DEFAULT_PORT);

pub fn update_state(settings: &Value) {
    ENABLED.store(settings["mcpServer"].as_bool().unwrap_or(false), Ordering::Relaxed);
    if let Some(p) = settings["mcpPort"].as_u64() {
        if (1024..=65535).contains(&p) {
            if let Ok(mut port) = PORT.lock() {
                *port = p as u16;
            }
        }
    }
}

/// 常驻监听线程：绑一个回环端口，请求进来时按当时的开关决定放不放行（热开关不用重启服务）
pub fn start(settings_path: PathBuf) {
    std::thread::spawn(move || {
        let port = PORT.lock().map(|p| *p).unwrap_or(DEFAULT_PORT);
        let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) else {
            eprintln!("[silly-cat] MCP 接口绑定 127.0.0.1:{port} 失败（端口被占用？），本次不起服务");
            return;
        };
        for stream in listener.incoming().flatten() {
            let path = settings_path.clone();
            std::thread::spawn(move || {
                handle_conn(stream, &path);
            });
        }
    });
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "get_appearance",
            "description": "Read the desktop cat's current appearance: breed (cat), art style (fur plush / line drawing), and size. Also lists all valid values.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "set_appearance",
            "description": "Change the desktop cat's appearance live (hot-reloads instantly). Pick from the built-in breeds — cow 奶牛猫, orange 大橘, lihua 狸花, siamese 暹罗, black 黑猫, calico 三花, blue 蓝猫, white 白猫, maine 缅因, sphynx 无毛猫; art style 'fur' (毛绒) or 'line' (线条); size 0.5–2.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "cat": { "type": "string", "enum": CATS, "description": "Breed ID, e.g. 'orange' for 大橘" },
                    "artStyle": { "type": "string", "enum": ["fur", "line"], "description": "'fur' = 毛绒画风, 'line' = 线条画风" },
                    "size": { "type": "number", "minimum": SIZE_MIN, "maximum": SIZE_MAX, "description": "Size multiplier, 1 = 100%" }
                },
                "additionalProperties": false
            }
        }
    ])
}

fn ok_text(payload: Value) -> Value {
    let text = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| payload.to_string());
    json!({ "content": [{ "type": "text", "text": text }], "isError": false })
}

fn err_text(msg: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": msg }], "isError": true })
}

/// 读盘上的 settings.json（字段和校验在前端 settings.js，这里只做同样的兜底校验）
fn read_settings(path: &PathBuf) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .filter(|v| v.is_object())
        .unwrap_or_else(|| json!({}))
}

fn write_settings(path: &PathBuf, s: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

fn execute_tool(name: &str, args: &Value, path: &PathBuf) -> Value {
    match name {
        "get_appearance" => {
            let s = read_settings(path);
            ok_text(json!({
                "cat": s["cat"].as_str().unwrap_or("cow"),
                "artStyle": s["artStyle"].as_str().unwrap_or("fur"),
                "size": s["size"].as_f64().unwrap_or(1.0),
                "availableCats": CATS,
                "availableArtStyles": ["fur", "line"],
                "sizeRange": { "min": SIZE_MIN, "max": SIZE_MAX },
                "settingsPath": path.to_string_lossy(),
                "mcpEnabled": ENABLED.load(Ordering::Relaxed)
            }))
        }
        "set_appearance" => {
            let mut s = read_settings(path);
            let mut changed: Vec<&str> = Vec::new();
            if let Some(cat) = args.get("cat").and_then(|v| v.as_str()) {
                if !CATS.contains(&cat) {
                    return err_text(&format!("Unknown cat '{}'. Available: {:?}", cat, CATS));
                }
                s["cat"] = json!(cat);
                changed.push("cat");
            }
            if let Some(style) = args.get("artStyle").and_then(|v| v.as_str()) {
                if style != "fur" && style != "line" {
                    return err_text("artStyle must be 'fur' or 'line'");
                }
                s["artStyle"] = json!(style);
                changed.push("artStyle");
            }
            if let Some(size) = args.get("size").and_then(|v| v.as_f64()) {
                if !size.is_finite() || !(SIZE_MIN..=SIZE_MAX).contains(&size) {
                    return err_text(&format!("size must be between {SIZE_MIN} and {SIZE_MAX}"));
                }
                s["size"] = json!(size);
                changed.push("size");
            }
            if changed.is_empty() {
                return err_text("Nothing to change: pass 'cat', 'artStyle' and/or 'size'.");
            }
            if let Err(e) = write_settings(path, &s) {
                return err_text(&format!("Failed to save settings: {e}"));
            }
            // 热重载：通知主窗口按新设置刷新（和设置页的保存广播走同一条路）
            if let Some(h) = APP_HANDLE.get() {
                let _ = h.emit_to("main", "silly:settings", s.clone());
            }
            ok_text(json!({ "status": "applied", "changed": changed, "cat": s["cat"], "artStyle": s["artStyle"], "size": s["size"] }))
        }
        _ => err_text(&format!("Unknown tool: {name}")),
    }
}

fn handle_jsonrpc(req: &Value, path: &PathBuf) -> Option<Value> {
    let id = req.get("id")?;
    let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
    if method.starts_with("notifications/") {
        return None;
    }
    let params = req.get("params").cloned().unwrap_or_else(|| json!({}));

    let result = match method {
        "initialize" => {
            let client_ver = params.get("protocolVersion").and_then(|v| v.as_str()).unwrap_or("2024-11-05");
            let ver = match client_ver {
                "2025-06-18" | "2025-03-26" | "2024-11-05" => client_ver,
                _ => "2024-11-05",
            };
            Ok(json!({
                "protocolVersion": ver,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
                "instructions": "Use get_appearance to read the desktop cat's current look, then set_appearance to change breed / art style / size live."
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => {
            let tool = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            Ok(execute_tool(tool, &args, path))
        }
        _ => Err((-32601, format!("Method not found: {method}"))),
    };

    Some(match result {
        Ok(res) => json!({ "jsonrpc": "2.0", "id": id, "result": res }),
        Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
    })
}

fn http_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &str) {
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: http://localhost:1420\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Accept\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn handle_conn(mut stream: TcpStream, path: &PathBuf) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() || request_line.is_empty() {
        return;
    }
    let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0];
    let route = parts[1];

    let mut content_length: usize = 0;
    let mut content_type = String::new();
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).is_err() {
            return;
        }
        let trimmed = header.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            if k.eq_ignore_ascii_case("content-length") {
                content_length = v.trim().parse().unwrap_or(0);
            } else if k.eq_ignore_ascii_case("content-type") {
                content_type = v.trim().to_ascii_lowercase();
            }
        }
    }

    if method == "OPTIONS" {
        http_response(&mut stream, "204 No Content", "text/plain", "");
        return;
    }
    if !ENABLED.load(Ordering::Relaxed) {
        http_response(&mut stream, "403 Forbidden", "application/json; charset=utf-8",
            r#"{"error":"MCP 接口在设置里是关闭的"}"#);
        return;
    }
    if method == "GET" && (route == "/health" || route == "/") {
        let body = json!({
            "ok": true,
            "name": SERVER_NAME,
            "version": env!("CARGO_PKG_VERSION"),
            "mcpEndpoint": "/mcp"
        }).to_string();
        http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &body);
        return;
    }
    if method == "POST" && (route == "/mcp" || route == "/") {
        // 防 CSRF：要求 application/json。浏览器里跨站页面只能发 text/plain 这类「简单请求」
        // （application/json 会先触发预检，预检的 CORS 白名单只放行本应用），所以这一条
        // 就能挡住恶意网页静默调用换装接口；正经 MCP 客户端本来就发 application/json。
        if !content_type.starts_with("application/json") {
            http_response(&mut stream, "415 Unsupported Media Type", "application/json; charset=utf-8",
                r#"{"error":"Content-Type must be application/json"}"#);
            return;
        }
        if content_length > 512 * 1024 {
            http_response(&mut stream, "413 Payload Too Large", "application/json", r#"{"error":"Payload too large"}"#);
            return;
        }
        let mut buf = vec![0u8; content_length];
        if content_length > 0 && reader.read_exact(&mut buf).is_err() {
            return;
        }
        // AppHandle 存在全局 APP_HANDLE 里（setup 时写入），execute_tool 发事件用；
        // 没跑过 setup（纯测试环境）也能响应只读请求
        let parsed: Value = match serde_json::from_slice(&buf) {
            Ok(v) => v,
            Err(e) => {
                let err = json!({
                    "jsonrpc": "2.0", "id": Value::Null,
                    "error": { "code": -32700, "message": format!("Parse error: {e}") }
                }).to_string();
                http_response(&mut stream, "400 Bad Request", "application/json; charset=utf-8", &err);
                return;
            }
        };
        if let Some(resp) = handle_jsonrpc(&parsed, path) {
            let body = resp.to_string();
            http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &body);
        } else {
            http_response(&mut stream, "202 Accepted", "application/json", "");
        }
        return;
    }
    http_response(&mut stream, "404 Not Found", "application/json; charset=utf-8",
        r#"{"error":"Not found. Use POST /mcp or GET /health"}"#);
}

/// setup 里把主窗口的 AppHandle 存进来，HTTP 线程发事件用
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// setup 时调用：记下 AppHandle，按当前设置决定要不要起 HTTP 服务
pub fn setup(app: tauri::AppHandle, settings_path: PathBuf) {
    let _ = APP_HANDLE.set(app);
    let s = read_settings(&settings_path);
    update_state(&s);
    start(settings_path);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_settings(tag: &str, cat: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("silly-cat-mcp-test-{}-{tag}.json", std::process::id()));
        let mut f = std::fs::File::create(&p).unwrap();
        writeln!(f, r#"{{"cat":"{}","artStyle":"fur","size":1.0,"mcpServer":false}}"#, cat).unwrap();
        p
    }

    #[test]
    fn jsonrpc_handshake_and_tool_list() {
        let path = temp_settings("handshake", "cow");
        let req = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}});
        let resp = handle_jsonrpc(&req, &path).unwrap();
        assert_eq!(resp["result"]["protocolVersion"], "2025-03-26");

        let req = json!({"jsonrpc":"2.0","id":2,"method":"tools/list"});
        let resp = handle_jsonrpc(&req, &path).unwrap();
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0]["name"], "get_appearance");
        assert_eq!(tools[1]["name"], "set_appearance");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn get_and_set_appearance() {
        let path = temp_settings("appearance", "cow");
        // 读
        let req = json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_appearance","arguments":{}}});
        let resp = handle_jsonrpc(&req, &path).unwrap();
        assert_eq!(resp["result"]["isError"], false);
        assert!(resp["result"]["content"][0]["text"].as_str().unwrap().contains(r#""cat": "cow""#));
        // 改：合法值写盘（APP_HANDLE 未设置时 emit 是 no-op）
        let req = json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"set_appearance","arguments":{"cat":"blue","size":1.4}}});
        let resp = handle_jsonrpc(&req, &path).unwrap();
        assert_eq!(resp["result"]["isError"], false, "{}", resp);
        let s = read_settings(&path);
        assert_eq!(s["cat"], "blue");
        assert_eq!(s["size"], 1.4);
        // 改：非法值报错且不写盘
        let req = json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"set_appearance","arguments":{"cat":"dragon"}}});
        let resp = handle_jsonrpc(&req, &path).unwrap();
        assert_eq!(resp["result"]["isError"], true);
        assert_eq!(read_settings(&path)["cat"], "blue");
        let _ = std::fs::remove_file(&path);
    }
}
