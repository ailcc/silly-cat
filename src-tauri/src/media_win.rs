// Windows 音频活动检测：只读 WASAPI 的音量电平（IAudioMeterInformation），
// 判断「现在有没有软件真的在出声」。不录音、不读音频内容。
// - 排除系统提示音（IsSystemSoundsSession）。
// - 排除通话 / 会议 / 语音软件（按 exe 名），它们出声不算听歌。
// 所有 COM 对象都留在创建它的线程上。
use std::{
    ffi::c_void,
    ptr,
    time::{Duration, Instant},
};

type Raw = *mut c_void;
type Hr = i32;
type Result<T> = std::result::Result<T, Hr>;
const CLSCTX_ALL: u32 = 23;
// 音乐软件白名单：只有这些在播放才算「用户在听歌」。2026-11-28 从黑名单改成白名单——
// IDE、浏览器等其它任何软件出声都不该让猫戴耳机（比如浏览器网页放歌、IDE 内嵌预览）。
// 精确匹配进程 exe 文件名（不分大小写）。
const MUSIC_APPS: &[&str] = &[
    "cloudmusic.exe", // 网易云音乐
    "qqmusic.exe",    // QQ音乐
    "spotify.exe",    // Spotify
    "kugou.exe",      // 酷狗音乐
    "kuwo.exe",       // 酷我音乐
    "kwmusic.exe",    // 酷我音乐（另一版本）
    "migu.exe",       // 咪咕音乐
    "migumusic.exe",  // 咪咕音乐（另一版本）
    "applemusic.exe", // Apple Music
    "itunes.exe",     // iTunes（老版）
    "foobar2000.exe", // foobar2000
    "aimp.exe",       // AIMP
];

#[repr(C)]
struct Guid(u32, u16, u16, [u8; 8]);
const fn guid(value: u128) -> Guid {
    Guid(
        (value >> 96) as u32,
        (value >> 80) as u16,
        (value >> 64) as u16,
        (value as u64).to_be_bytes(),
    )
}
const ENUM_CLASS: Guid = guid(0xbcde0395_e52f_467c_8e3d_c4579291692e);
const ENUM: Guid = guid(0xa95664d2_9614_4f35_a746_de8db63617e6);
const ENDPOINT_VOLUME: Guid = guid(0x5cdf2c82_841e_4546_9722_0cf74078229a);
const MANAGER: Guid = guid(0x77aa99a0_1bd6_484f_8bc7_2c654c9a9b6f);
const CONTROL2: Guid = guid(0xbfb7ff88_7239_4fc9_8fa2_07c950be9c6d);
const SIMPLE_VOLUME: Guid = guid(0x87ce5498_68d6_44e5_9215_6da47ef883d8);
const METER: Guid = guid(0xc02216f6_8c67_4b5b_9d00_d008e73e0064);

#[link(name = "ole32")]
extern "system" {
    fn CoInitializeEx(reserved: Raw, flags: u32) -> Hr;
    fn CoUninitialize();
    fn CoCreateInstance(
        class: *const Guid,
        outer: Raw,
        context: u32,
        iid: *const Guid,
        out: *mut Raw,
    ) -> Hr;
}
#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Raw;
    fn QueryFullProcessImageNameW(handle: Raw, flags: u32, name: *mut u16, len: *mut u32) -> i32;
    fn CloseHandle(handle: Raw) -> i32;
}

fn music_process(pid: u32) -> bool {
    unsafe {
        let handle = OpenProcess(0x1000, 0, pid); // PROCESS_QUERY_LIMITED_INFORMATION
        if handle.is_null() {
            return false;
        }
        let mut name = vec![0u16; 32768];
        let mut len = name.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, name.as_mut_ptr(), &mut len);
        CloseHandle(handle);
        if ok == 0 {
            return false;
        }
        let path = String::from_utf16_lossy(&name[..len as usize]);
        let exe = path.rsplit('\\').next().unwrap_or("");
        MUSIC_APPS
            .iter()
            .any(|entry| exe.eq_ignore_ascii_case(entry))
    }
}

fn check(hr: Hr) -> Result<()> {
    if hr < 0 {
        Err(hr)
    } else {
        Ok(())
    }
}

// COM 接口开头是 vtable 指针；每个调用点按 SDK 槽位和 ABI 声明。
// 下面所有接口都继承 IUnknown（0 QueryInterface, 1 AddRef, 2 Release）。
macro_rules! method {
    ($object:expr, $slot:expr, $ty:ty) => {{
        let table = *($object.0 as *const *const Raw);
        std::mem::transmute::<Raw, $ty>(*table.add($slot))
    }};
}
struct Interface(Raw);
impl Interface {
    fn obtain(call: impl FnOnce(*mut Raw) -> Hr) -> Result<Self> {
        let mut raw = ptr::null_mut();
        check(call(&mut raw))?;
        if raw.is_null() {
            Err(0x80004003u32 as Hr)
        } else {
            Ok(Self(raw))
        }
    }
    fn query(&self, iid: &Guid) -> Result<Self> {
        unsafe {
            let query = method!(
                self,
                0,
                unsafe extern "system" fn(Raw, *const Guid, *mut Raw) -> Hr
            );
            Self::obtain(|out| query(self.0, iid, out))
        }
    }
    // IMMDevice : IUnknown, 3 Activate
    unsafe fn activate(&self, iid: &Guid) -> Result<Self> {
        let activate = method!(
            self,
            3,
            unsafe extern "system" fn(Raw, *const Guid, u32, Raw, *mut Raw) -> Hr
        );
        Self::obtain(|out| activate(self.0, iid, CLSCTX_ALL, ptr::null_mut(), out))
    }
    unsafe fn value<T: Default>(&self, slot: usize) -> Result<T> {
        let get = method!(self, slot, unsafe extern "system" fn(Raw, *mut T) -> Hr);
        let mut value = T::default();
        check(get(self.0, &mut value))?;
        Ok(value)
    }
}
impl Drop for Interface {
    fn drop(&mut self) {
        unsafe {
            method!(self, 2, unsafe extern "system" fn(Raw) -> u32)(self.0);
        }
    }
}
struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub struct Prober {
    enumerator: Interface,
    _apartment: Apartment, // 字段 drop 顺序：先释放 enumerator
}
impl Prober {
    pub fn new() -> Result<Self> {
        unsafe {
            check(CoInitializeEx(ptr::null_mut(), 0))?; // COINIT_MULTITHREADED
            let apartment = Apartment;
            let enumerator = Interface::obtain(|out| {
                CoCreateInstance(&ENUM_CLASS, ptr::null_mut(), CLSCTX_ALL, &ENUM, out)
            })?;
            Ok(Self {
                enumerator,
                _apartment: apartment,
            })
        }
    }
    pub fn sample(&mut self, exclude_pids: &[u32]) -> Result<bool> {
        unsafe {
            // IMMDeviceEnumerator : IUnknown, 3 EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            let enumerate = method!(
                self.enumerator,
                3,
                unsafe extern "system" fn(Raw, i32, u32, *mut Raw) -> Hr
            );
            let devices = Interface::obtain(|out| enumerate(self.enumerator.0, 0, 1, out))?;
            // IMMDeviceCollection : IUnknown, 3 GetCount, 4 Item
            let count: u32 = devices.value(3)?;
            let item = method!(
                devices,
                4,
                unsafe extern "system" fn(Raw, u32, *mut Raw) -> Hr
            );
            let mut checked_device = false;
            let mut result = Ok(false);
            for i in 0..count {
                match Interface::obtain(|out| item(devices.0, i, out))
                    .and_then(|device| device_active(&device, exclude_pids))
                {
                    Ok(true) => return Ok(true),
                    Ok(false) => checked_device = true,
                    Err(hr) => result = Err(hr),
                }
            }
            if checked_device {
                Ok(false)
            } else {
                result
            }
        }
    }
}

unsafe fn device_active(device: &Interface, exclude_pids: &[u32]) -> Result<bool> {
    let volume = device.activate(&ENDPOINT_VOLUME)?;
    // IAudioEndpointVolume : IUnknown, 15 GetMute, 9 GetMasterVolumeLevelScalar
    if volume.value::<i32>(15)? != 0 || volume.value::<f32>(9)? < 0.01 {
        return Ok(false);
    }
    let manager = device.activate(&MANAGER)?;
    // IAudioSessionManager2 : IAudioSessionManager : IUnknown, 5 GetSessionEnumerator
    let enumerate = method!(manager, 5, unsafe extern "system" fn(Raw, *mut Raw) -> Hr);
    let sessions = Interface::obtain(|out| enumerate(manager.0, out))?;
    // IAudioSessionEnumerator : IUnknown, 3 GetCount, 4 GetSession
    let count: i32 = sessions.value(3)?;
    let get = method!(
        sessions,
        4,
        unsafe extern "system" fn(Raw, i32, *mut Raw) -> Hr
    );
    for i in 0..count {
        if Interface::obtain(|out| get(sessions.0, i, out))
            .and_then(|session| session_active(&session, exclude_pids))
            .unwrap_or(false)
        {
            return Ok(true);
        }
    }
    Ok(false)
}

unsafe fn session_active(session: &Interface, exclude_pids: &[u32]) -> Result<bool> {
    // IAudioSessionControl : IUnknown, 3 GetState (AudioSessionStateActive = 1)
    if session.value::<i32>(3)? != 1 {
        return Ok(false);
    }
    let control = session.query(&CONTROL2)?;
    // IAudioSessionControl2 : IAudioSessionControl, 15 IsSystemSoundsSession, 14 GetProcessId
    let system = method!(control, 15, unsafe extern "system" fn(Raw) -> Hr)(control.0);
    check(system)?;
    if system == 0 {
        return Ok(false);
    }
    let pid: u32 = control.value(14)?;
    // 白名单：只有音乐软件的 session 才算「用户在听歌」；exclude_pids 是猫自己
    // （探针场景是探针进程），白名单外的 pid 一律不算，猫自己的 pid 天然不在名单里
    if exclude_pids.contains(&pid) || !music_process(pid) {
        return Ok(false);
    }
    // ISimpleAudioVolume : IUnknown, 6 GetMute, 4 GetMasterVolume
    // 可选：报不出自己音量的 session 只看电平。
    if let Ok(volume) = session.query(&SIMPLE_VOLUME) {
        if volume.value::<i32>(6)? != 0 || volume.value::<f32>(4)? < 0.01 {
            return Ok(false);
        }
    }
    // IAudioMeterInformation : IUnknown, 3 GetPeakValue
    Ok(session.query(&METER)?.value::<f32>(3)? > 0.01)
}

fn permanent_init_error(hr: Hr) -> bool {
    hr == 0x80040154u32 as Hr // REGDB_E_CLASSNOTREG
}

// 采样线程里用；初始化失败按指数退避重试。
pub struct RetryProbe {
    probe: Option<Prober>,
    retry_at: Instant,
    delay_secs: u64,
    initialized_once: bool,
    permanent_failures: u8,
}

impl RetryProbe {
    pub fn new() -> Self {
        Self {
            probe: None,
            retry_at: Instant::now(),
            delay_secs: 1,
            initialized_once: false,
            permanent_failures: 0,
        }
    }

    // None 表示系统不支持；退避期间发布「静音」样本。
    pub fn poll(&mut self, excluded: &[u32]) -> Result<Option<bool>> {
        if Instant::now() < self.retry_at {
            return Ok(Some(false));
        }
        let probe = match self.probe.as_mut() {
            Some(probe) => probe,
            None => match Prober::new() {
                Ok(probe) => {
                    self.initialized_once = true;
                    self.probe.insert(probe)
                }
                Err(hr) => {
                    if !self.initialized_once && permanent_init_error(hr) {
                        self.permanent_failures += 1;
                        if self.permanent_failures == 3 {
                            return Ok(None);
                        }
                    } else {
                        self.permanent_failures = 0;
                    }
                    self.back_off();
                    return Err(hr);
                }
            },
        };
        match probe.sample(excluded) {
            Ok(active) => {
                self.delay_secs = 1;
                Ok(Some(active))
            }
            Err(hr) => {
                self.probe = None;
                self.back_off();
                Err(hr)
            }
        }
    }

    fn back_off(&mut self) {
        self.retry_at = Instant::now() + Duration::from_secs(self.delay_secs);
        self.delay_secs = (self.delay_secs * 2).min(30);
    }
}
