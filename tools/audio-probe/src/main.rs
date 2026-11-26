#[cfg(windows)]
#[path = "../../../src-tauri/src/media_win.rs"]
mod media_win;

#[cfg(not(windows))]
fn main() {
    println!("{{\"supported\":false}}");
}

#[cfg(windows)]
fn main() {
    use std::io::{self, Write};
    use std::{env, process, thread, time::Duration};

    let mut excluded = vec![process::id()];
    let mut args = env::args().skip(1);
    while let Some(flag) = args.next() {
        if flag != "--exclude-pid" {
            process::exit(2);
        }
        match args.next().and_then(|s| s.parse::<u32>().ok()) {
            Some(pid) => excluded.push(pid),
            None => process::exit(2),
        }
    }
    thread::spawn(|| {
        let _ = io::copy(&mut io::stdin().lock(), &mut io::sink());
        process::exit(0);
    });

    let mut probe = media_win::RetryProbe::new();
    let mut stdout = io::stdout().lock();
    loop {
        let written = match probe.poll(&excluded) {
            Ok(Some(active)) => writeln!(stdout, "{{\"active\":{active}}}"),
            Ok(None) => {
                let _ = writeln!(stdout, "{{\"supported\":false}}").and_then(|_| stdout.flush());
                return;
            }
            Err(hr) => {
                writeln!(
                    stdout,
                    "{{\"active\":false,\"error\":\"HRESULT {hr:#010x}\"}}"
                )
            }
        };
        if written.and_then(|_| stdout.flush()).is_err() {
            break;
        }
        thread::sleep(Duration::from_secs(1));
    }
}
