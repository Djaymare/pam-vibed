use std::{env, fs, thread, time::Duration};
fn main() {
    let args: Vec<_> = env::args().skip(1).collect();
    fs::write(
        &args[0],
        format!("{}\n{}", std::process::id(), args[1..].join("\n")),
    )
    .unwrap();
    loop {
        thread::sleep(Duration::from_secs(1));
    }
}
