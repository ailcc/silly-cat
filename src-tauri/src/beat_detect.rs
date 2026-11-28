//! 实时节拍估计（DSP）：各平台的音频采集线程把「系统正在播放的声音」按单声道喂进来，
//! 这里只做一件事——算出当前音乐的节拍周期（毫秒），供猫摇头晃脑跟着打拍子。
//!
//! - 波形只进内存、只算能量包络，不落盘、不外传、不存任何音频内容。
//! - 方法：单声道 → 低通（只留低频，鼓/贝斯最强）→ 10ms 一帧的响度包络 →
//!   6 秒窗口求 onset 强度 → 对 300–1000ms 的周期做自相关 → 取主峰。
//! - 置信度不够（钢琴独奏、清唱、静音）就不出数，前端回退到默认 460ms。
//! - 换歌时旧节拍会平滑过渡：估计值和上一拍接近就用滑动平均黏住，差得远（换歌）才直接跳。
//! - beat_ms() 返回 0 表示「没把握」，别拿 0 去算拍子。
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Mutex,
};

/// 包络帧长：10ms 一帧（约 100Hz），对节拍检测足够细
const FRAME_MS: u32 = 10;
/// 自相关窗口：640 帧 ≈ 6.4 秒（一首歌至少 6 秒才能出节拍）
const WINDOW: usize = 640;
/// 自相关的周期搜索范围：30–100 帧 = 300–1000ms ≈ 60–200 BPM
const MIN_LAG: usize = 30;
const MAX_LAG: usize = 100;
/// 主峰置信度门槛：峰比平均高这么多倍才算「有节拍」
const CONFIDENCE_MIN: f32 = 1.8;

static BEAT_MS: AtomicU32 = AtomicU32::new(0);

struct Dsp {
    /// 单声道采样率（首次 feed 时记录）
    rate: u32,
    /// 低通状态（一阶 IIR）
    lp: f32,
    /// 当前帧的能量累计（|低通输出| 的和）与帧内已累计的采样数
    acc: f64,
    acc_n: u32,
    /// 帧长对应的采样数（rate 重建时更新）
    frame_samples: u32,
    /// 包络环形缓冲（旧→新），env_frames 是有效长度
    env: Vec<f32>,
    env_frames: usize,
    head: usize,
    pushed: usize,
    last_beat: Option<f32>,
}

impl Dsp {
    fn new() -> Self {
        Self {
            rate: 0,
            lp: 0.0,
            acc: 0.0,
            acc_n: 0,
            frame_samples: 0,
            env: vec![0.0; WINDOW],
            env_frames: 0,
            head: 0,
            pushed: 0,
            last_beat: None,
        }
    }
}

static DSP: Mutex<Option<Dsp>> = Mutex::new(None);

/// 当前估计出的节拍周期（毫秒）；0 = 没检测出来（前端回退默认节拍）
pub fn beat_ms() -> u32 {
    BEAT_MS.load(Ordering::Relaxed)
}

/// 清空状态：摘耳机 / 关开关时调用，避免上一首歌的节拍残留
pub fn reset() {
    BEAT_MS.store(0, Ordering::Relaxed);
    *DSP.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// 喂一段交错多声道的采样（调用方已混音好也行，这里再混一次单声道），采样率不变时随便喂。
/// 每次喂完顺手判断要不要跑一次自相关（每 50 帧 ≈ 500ms 一次）。
pub fn feed(interleaved: &[f32], channels: u32, rate: u32) {
    let mut guard = DSP.lock().unwrap_or_else(|e| e.into_inner());
    let dsp = guard.get_or_insert_with(Dsp::new);
    if dsp.rate != rate {
        dsp.rate = rate;
        dsp.frame_samples = (rate * FRAME_MS / 1000).max(1);
    }
    // 一阶低通：只留 ~150Hz 以下（鼓点、贝斯最清楚），系数按采样率换算
    let alpha = ((2.0 * std::f64::consts::PI * 150.0 / rate as f64).min(0.9)) as f32;
    let ch = channels.max(1) as usize;
    for chunk in interleaved.chunks(ch) {
        let mut mono = 0.0f32;
        for s in chunk {
            mono += s;
        }
        mono /= chunk.len() as f32;
        dsp.lp += alpha * (mono - dsp.lp);
        dsp.acc += (dsp.lp as f64).abs();
        dsp.acc_n += 1;
        if dsp.acc_n >= dsp.frame_samples {
            // 帧响度：|低通| 的均值；再压一下动态范围（dB-ish），onset 对比更明显
            let loud = (dsp.acc / dsp.acc_n as f64).sqrt() as f32;
            push_frame(dsp, loud);
            dsp.acc = 0.0;
            dsp.acc_n = 0;
        }
    }
    if dsp.env_frames >= MIN_LAG * 3 && dsp.pushed % 50 == 0 {
        analyze(dsp);
    }
}

fn push_frame(dsp: &mut Dsp, loud: f32) {
    dsp.env[dsp.head] = loud;
    dsp.head = (dsp.head + 1) % WINDOW;
    dsp.env_frames = (dsp.env_frames + 1).min(WINDOW);
    dsp.pushed += 1;
}

fn analyze(dsp: &mut Dsp) {
    let n = dsp.env_frames;
    // 有效窗口按时间序取出来（旧→新）
    let start = if n == WINDOW {
        (dsp.head + WINDOW - n) % WINDOW
    } else {
        0
    };
    let env_at = |i: usize| -> f32 { dsp.env[(start + i) % WINDOW] };

    // onset：响度上升沿（鼓点），负的忽略
    let mut onset = vec![0.0f32; n];
    for i in 1..n {
        let d = env_at(i) - env_at(i - 1);
        if d > 0.0 {
            onset[i] = d;
        }
    }
    let mean = onset.iter().sum::<f32>() / n as f32;
    if mean <= 1e-6 {
        BEAT_MS.store(0, Ordering::Relaxed); // 全程静音（暂停了）
        return;
    }
    for v in onset.iter_mut() {
        *v = (*v - mean).max(0.0);
    }

    // 自相关：候选周期 300–1000ms，找主峰
    let usable = n - MAX_LAG; // 留出最大滞后，保证所有 lag 的样本数一致
    if usable < MIN_LAG * 2 {
        return;
    }
    let scores: Vec<f32> = (MIN_LAG..=MAX_LAG)
        .map(|lag| {
            (0..usable)
                .map(|i| onset[i] * onset[i + lag])
                .sum::<f32>()
        })
        .collect();
    let avg = scores.iter().sum::<f32>() / scores.len() as f32;
    let (best_idx, best) = scores
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map(|(i, s)| (i, *s))
        .unwrap_or((0, 0.0));
    if avg <= 1e-9 || best / avg < CONFIDENCE_MIN {
        return; // 没把握：保留旧值或保持无节拍，不乱跳
    }
    // 抛物线插值细化峰位（把 10ms 一格的粒度磨平）
    let lag = best_idx + MIN_LAG;
    let frame_ms = FRAME_MS as f32;
    let y_l = scores.get(best_idx.wrapping_sub(1)).copied().unwrap_or(best);
    let y_r = scores.get(best_idx + 1).copied().unwrap_or(best);
    let denom = y_l - 2.0 * best + y_r;
    let shift = if denom.abs() > 1e-12 {
        (0.5 * (y_l - y_r) / denom).clamp(-0.5, 0.5)
    } else {
        0.0
    };
    let mut beat = (lag as f32 + shift) * frame_ms;

    // 平滑：和上一拍接近（±20%）就黏住，换歌（差得远）才直接切
    if let Some(prev) = dsp.last_beat {
        if (beat - prev).abs() / prev < 0.2 {
            beat = prev * 0.6 + beat * 0.4;
        }
    }
    dsp.last_beat = Some(beat);
    BEAT_MS.store(beat.round().clamp(200.0, 1500.0) as u32, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 合成一段「每 700ms 一记 100ms 的 100Hz 鼓点」喂进去，应该测出 ~700ms
    #[test]
    fn detects_700ms_click_train() {
        reset();
        let rate = 48000u32;
        let secs = 9.0f64;
        let mut samples = Vec::with_capacity((rate as f64 * secs) as usize);
        for n in 0..(rate as f64 * secs) as usize {
            let t = n as f64 / rate as f64;
            let v = if (t / 0.7).fract() < 0.1 {
                (t * 2.0 * std::f64::consts::PI * 100.0).sin() as f32 * 0.8
            } else {
                0.0
            };
            samples.push(v);
        }
        // 模拟 IOProc 一块块喂（1024 样本一块，双声道同值）
        for chunk in samples.chunks(1024) {
            feed(chunk, 2, rate);
        }
        let beat = beat_ms();
        assert!(beat >= 680 && beat <= 720, "beat = {}ms（期望 ~700）", beat);
        reset();
    }

    /// 纯静音不该给出节拍（保持 0，前端回退默认）
    #[test]
    fn silence_gives_no_beat() {
        reset();
        let zeros = vec![0.0f32; 48000];
        for _ in 0..9 {
            feed(&zeros, 2, 48000);
        }
        assert_eq!(beat_ms(), 0);
    }
}
