// Disposable native MediaPlayer. No shell, application profile or hardware volume changes.
use std::{
    io::{self, BufRead},
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc,
    },
};
use windows::{
    core::{Result, HSTRING},
    Foundation::{TypedEventHandler, Uri},
    Media::{
        Core::MediaSource, MediaPlaybackStatus, MediaPlaybackType, Playback::MediaPlayer,
        SystemMediaTransportControls, SystemMediaTransportControlsButton,
        SystemMediaTransportControlsButtonPressedEventArgs,
    },
    Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
};

fn title(controls: &SystemMediaTransportControls, prefix: &str, index: u32) -> Result<()> {
    let updater = controls.DisplayUpdater()?;
    updater.SetType(MediaPlaybackType::Music)?;
    updater
        .MusicProperties()?
        .SetTitle(&HSTRING::from(format!("{prefix} {index}")))?;
    updater
        .MusicProperties()?
        .SetArtist(&HSTRING::from("PAM disposable native test"))?;
    updater.Update()
}
fn run() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    assert_eq!(args.len(), 3);
    assert!(args[1].starts_with("file:///"));
    assert!(args[2].starts_with("PAM-25 fixture "));
    let player = MediaPlayer::new()?;
    player.SetVolume(0.0)?;
    player.SetIsLoopingEnabled(true)?;
    player.CommandManager()?.SetIsEnabled(false)?;
    let controls = player.SystemMediaTransportControls()?;
    controls.SetIsEnabled(true)?;
    controls.SetIsPlayEnabled(true)?;
    controls.SetIsPauseEnabled(true)?;
    controls.SetIsNextEnabled(true)?;
    let index = Arc::new(AtomicU32::new(1));
    let observed = index.clone();
    let target = player.clone();
    let smtc = controls.clone();
    let prefix = args[2].clone();
    let token = controls.ButtonPressed(&TypedEventHandler::<
        SystemMediaTransportControls,
        SystemMediaTransportControlsButtonPressedEventArgs,
    >::new(move |_, event| {
        match event.as_ref().unwrap().Button()? {
            SystemMediaTransportControlsButton::Play => {
                target.Play()?;
                smtc.SetPlaybackStatus(MediaPlaybackStatus::Playing)?;
                smtc.SetIsPlayEnabled(false)?;
                smtc.SetIsPauseEnabled(true)?;
            }
            SystemMediaTransportControlsButton::Pause => {
                target.Pause()?;
                smtc.SetPlaybackStatus(MediaPlaybackStatus::Paused)?;
                smtc.SetIsPlayEnabled(true)?;
                smtc.SetIsPauseEnabled(false)?;
            }
            SystemMediaTransportControlsButton::Next => {
                let next = observed.fetch_add(1, Ordering::SeqCst) + 1;
                title(&smtc, &prefix, next)?;
            }
            _ => {}
        }
        Ok(())
    }))?;
    player.SetSource(&MediaSource::CreateFromUri(&Uri::CreateUri(
        &HSTRING::from(&args[1]),
    )?)?)?;
    player.Play()?;
    controls.SetPlaybackStatus(MediaPlaybackStatus::Playing)?;
    controls.SetIsPlayEnabled(false)?;
    title(&controls, &args[2], 1)?;
    println!("ready");
    for line in io::stdin().lock().lines() {
        if line.unwrap_or_default() == "quit" {
            break;
        }
    }
    controls.RemoveButtonPressed(token)?;
    controls.SetPlaybackStatus(MediaPlaybackStatus::Closed)?;
    controls.SetIsEnabled(false)?;
    player.Close()
}
fn main() {
    unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.expect("WinRT");
    let result = run();
    unsafe { RoUninitialize() };
    result.expect("Disposable MediaPlayer");
}
