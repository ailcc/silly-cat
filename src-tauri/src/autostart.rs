use serde::Serialize;

#[derive(Serialize)]
pub struct AutostartStatus {
    enabled: bool,
    needs_approval: bool,
    platform: &'static str,
}

#[tauri::command]
pub fn autostart_status() -> Result<AutostartStatus, String> {
    system::status()
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<AutostartStatus, String> {
    system::set(enabled)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_login_items() -> Result<(), String> {
    system::open_login_items()
}

#[cfg(target_os = "macos")]
mod system {
    use super::AutostartStatus;
    use objc2::rc::autoreleasepool;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2::{msg_send, MainThreadMarker};
    use std::{ffi::CStr, ptr};

    #[link(name = "ServiceManagement", kind = "framework")]
    extern "C" {}

    const ENABLED: isize = 1;
    const REQUIRES_APPROVAL: isize = 2;

    fn service_class() -> Result<&'static AnyClass, String> {
        // Tauri 同步命令在主线程执行。检查线程，避免其他入口误用。
        MainThreadMarker::new().ok_or("登录项命令需要在主线程运行")?;
        AnyClass::get(c"SMAppService").ok_or_else(|| "系统找不到 SMAppService".into())
    }

    fn with_service<T>(action: impl FnOnce(&AnyObject) -> Result<T, String>) -> Result<T, String> {
        let class = service_class()?;
        autoreleasepool(|_| {
            // SAFETY: mainAppService 返回的对象在当前自动释放池内有效。
            let service: *mut AnyObject = unsafe { msg_send![class, mainAppService] };
            let service = unsafe { service.as_ref() }.ok_or("系统找不到 SillyCat 的登录服务")?;
            action(service)
        })
    }

    fn read_status(service: &AnyObject) -> AutostartStatus {
        // SAFETY: service 来自 mainAppService，status 的 ABI 类型是 NSInteger。
        let status: isize = unsafe { msg_send![service, status] };
        AutostartStatus {
            enabled: matches!(status, ENABLED | REQUIRES_APPROVAL),
            needs_approval: status == REQUIRES_APPROVAL,
            platform: "macos",
        }
    }

    pub fn status() -> Result<AutostartStatus, String> {
        with_service(|service| Ok(read_status(service)))
    }

    pub fn set(enabled: bool) -> Result<AutostartStatus, String> {
        with_service(|service| {
            let before = read_status(service);
            if before.enabled == enabled {
                return Ok(before);
            }

            let mut error: *mut AnyObject = ptr::null_mut();
            let out_error = &mut error as *mut *mut AnyObject;
            // SAFETY: 两个方法都接受可写的 NSError ** 并返回 Objective-C BOOL。
            let ok: Bool = unsafe {
                if enabled {
                    msg_send![service, registerAndReturnError: out_error]
                } else {
                    msg_send![service, unregisterAndReturnError: out_error]
                }
            };
            let after = read_status(service);
            // 系统可能已记录注册请求，因尚未获批而返回错误。
            if ok.as_bool() || (enabled && after.needs_approval) {
                return Ok(after);
            }

            // SAFETY: NSError 和描述字符串都只在当前自动释放池内使用。
            let message = unsafe {
                error.as_ref().and_then(|error| {
                    let description: *mut AnyObject = msg_send![error, localizedDescription];
                    let description = description.as_ref()?;
                    let utf8: *const std::ffi::c_char = msg_send![description, UTF8String];
                    (!utf8.is_null()).then(|| CStr::from_ptr(utf8).to_string_lossy().into_owned())
                })
            };
            Err(message.unwrap_or_else(|| "系统未能修改登录项".into()))
        })
    }

    pub fn open_login_items() -> Result<(), String> {
        let class = service_class()?;
        // SAFETY: 已确认在主线程，且 macOS 13 起提供此类方法。
        let _: () = unsafe { msg_send![class, openSystemSettingsLoginItems] };
        Ok(())
    }
}

#[cfg(target_os = "windows")]
mod system {
    use super::AutostartStatus;
    use std::{io, mem::size_of_val, os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::Foundation::{
        ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_SUCCESS, WIN32_ERROR,
    };
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW,
        RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_BINARY,
        REG_SZ,
    };

    const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const APPROVAL_KEY: &str =
        "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
    const VALUE_NAME: &str = "SillyCat";
    const QUOTE: u16 = b'"' as u16;

    struct Key(HKEY);

    impl Drop for Key {
        fn drop(&mut self) {
            // SAFETY: Key 拥有 RegOpenKeyExW 或 RegCreateKeyW 打开的句柄。
            unsafe { RegCloseKey(self.0) };
        }
    }

    fn registry_error(code: WIN32_ERROR) -> String {
        io::Error::from_raw_os_error(code as i32).to_string()
    }

    fn open_key(path: &str, access: u32, create: bool) -> Result<Option<Key>, String> {
        let name: Vec<u16> = path.encode_utf16().chain([0]).collect();
        let mut key = ptr::null_mut();
        // SAFETY: name 以 NUL 结尾，key 是可写的句柄输出参数。
        let mut result =
            unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, name.as_ptr(), 0, access, &mut key) };
        if result == ERROR_FILE_NOT_FOUND && create {
            // SAFETY: 参数与上面的 RegOpenKeyExW 相同。
            result = unsafe { RegCreateKeyW(HKEY_CURRENT_USER, name.as_ptr(), &mut key) };
        }
        match result {
            ERROR_SUCCESS => Ok(Some(Key(key))),
            ERROR_FILE_NOT_FOUND if !create => Ok(None),
            code => Err(registry_error(code)),
        }
    }

    fn exe_path() -> Result<Vec<u16>, String> {
        let exe = std::env::current_exe().map_err(|err| format!("无法取得程序路径：{err}"))?;
        Ok(exe.as_os_str().encode_wide().collect())
    }

    fn windows_status(enabled: bool) -> AutostartStatus {
        AutostartStatus {
            enabled,
            needs_approval: false,
            platform: "windows",
        }
    }

    fn disabled_in_task_manager(name: &[u16]) -> Result<bool, String> {
        let Some(key) = open_key(APPROVAL_KEY, KEY_QUERY_VALUE, false)? else {
            return Ok(false);
        };
        // 任务管理器禁用启动项时保留 Run 值，另写一条 12 字节的禁用记录。
        // Win7 没有这条记录。只识别已知的禁用格式。
        let mut data = [0u8; 12];
        let mut bytes = data.len() as u32;
        let mut kind = 0;
        // SAFETY: name 是以 NUL 结尾的值名，data 缓冲区大小见 bytes。
        let result = unsafe {
            RegQueryValueExW(
                key.0,
                name.as_ptr(),
                ptr::null(),
                &mut kind,
                data.as_mut_ptr(),
                &mut bytes,
            )
        };
        match result {
            ERROR_SUCCESS => Ok(kind == REG_BINARY
                && bytes as usize == data.len()
                && matches!(&data[..4], [3 | 7, 0, 0, 0])),
            ERROR_FILE_NOT_FOUND | ERROR_MORE_DATA => Ok(false),
            code => Err(registry_error(code)),
        }
    }

    pub fn status() -> Result<AutostartStatus, String> {
        let Some(key) = open_key(RUN_KEY, KEY_QUERY_VALUE, false)? else {
            return Ok(windows_status(false));
        };
        let path = exe_path()?;
        let name: Vec<u16> = VALUE_NAME.encode_utf16().chain([0]).collect();
        // 匹配的值最多容纳当前路径、一对引号和末尾的 NUL。
        let mut data = vec![0u16; path.len() + 3];
        let mut bytes = size_of_val(data.as_slice()) as u32;
        let mut kind = 0;
        // SAFETY: data 缓冲区可写，bytes 以字节为单位给出容量。
        let result = unsafe {
            RegQueryValueExW(
                key.0,
                name.as_ptr(),
                ptr::null(),
                &mut kind,
                data.as_mut_ptr().cast(),
                &mut bytes,
            )
        };
        match result {
            ERROR_SUCCESS => {
                let value = &data[..bytes as usize / 2];
                let value = value.strip_suffix(&[0]).unwrap_or(value);
                let value = value
                    .strip_prefix(&[QUOTE])
                    .and_then(|value| value.strip_suffix(&[QUOTE]))
                    .unwrap_or(value);
                let matches_exe = kind == REG_SZ && bytes & 1 == 0 && value == path;
                Ok(windows_status(
                    matches_exe && !disabled_in_task_manager(&name)?,
                ))
            }
            ERROR_FILE_NOT_FOUND | ERROR_MORE_DATA => Ok(windows_status(false)),
            code => Err(registry_error(code)),
        }
    }

    pub fn set(enabled: bool) -> Result<AutostartStatus, String> {
        let Some(key) = open_key(RUN_KEY, KEY_SET_VALUE, enabled)? else {
            return Ok(windows_status(false));
        };
        let name: Vec<u16> = VALUE_NAME.encode_utf16().chain([0]).collect();
        let approval = if enabled && disabled_in_task_manager(&name)? {
            open_key(APPROVAL_KEY, KEY_SET_VALUE, false)?
        } else {
            None
        };
        let result = if enabled {
            let mut data = vec![QUOTE];
            data.extend(exe_path()?);
            data.extend([QUOTE, 0]);
            // SAFETY: data 是以 NUL 结尾的 UTF-16 字符串，长度以字节计。
            unsafe {
                RegSetValueExW(
                    key.0,
                    name.as_ptr(),
                    0,
                    REG_SZ,
                    data.as_ptr().cast(),
                    size_of_val(data.as_slice()) as u32,
                )
            }
        } else {
            // SAFETY: key 在调用期间有效，值名以 NUL 结尾。
            unsafe { RegDeleteValueW(key.0, name.as_ptr()) }
        };
        if result != ERROR_SUCCESS && (enabled || result != ERROR_FILE_NOT_FOUND) {
            return Err(registry_error(result));
        }
        if let Some(approval) = approval {
            // SAFETY: 只在用户主动开启时移除 SillyCat 的禁用记录。
            let result = unsafe { RegDeleteValueW(approval.0, name.as_ptr()) };
            if result != ERROR_SUCCESS && result != ERROR_FILE_NOT_FOUND {
                return Err(registry_error(result));
            }
        }
        Ok(windows_status(enabled))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod system {
    use super::AutostartStatus;

    pub fn status() -> Result<AutostartStatus, String> {
        Ok(AutostartStatus {
            enabled: false,
            needs_approval: false,
            platform: "other",
        })
    }

    pub fn set(_enabled: bool) -> Result<AutostartStatus, String> {
        Err("当前平台不支持开机自动启动".into())
    }
}
