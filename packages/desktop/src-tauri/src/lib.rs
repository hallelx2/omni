use std::sync::Mutex;
use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Shared handle to the running sidecar + its resolved port.
#[derive(Default)]
struct ServerState {
    port: Mutex<Option<u16>>,
    child: Mutex<Option<CommandChild>>,
}

#[derive(Serialize, Clone)]
struct ServerInfo {
    port: u16,
    token: Option<String>,
}

/// The frontend calls this to learn where the sidecar is listening.
#[tauri::command]
fn server_info(state: State<ServerState>) -> Result<ServerInfo, String> {
    match *state.port.lock().unwrap() {
        Some(port) => Ok(ServerInfo { port, token: None }),
        None => Err("omni server is not ready yet".into()),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_pty::init())
        .manage(ServerState::default())
        .invoke_handler(tauri::generate_handler![server_info])
        .setup(|app| {
            let handle = app.handle().clone();

            // Spawn the Bun sidecar; OMNI_DESKTOP_PORT=0 lets the OS pick a free
            // port, which the sidecar reports back on stdout.
            let command = handle
                .shell()
                .sidecar("omni-desktop-server")
                .expect("failed to create sidecar command")
                .env("OMNI_DESKTOP_PORT", "0");
            let (mut rx, child) = command.spawn().expect("failed to spawn omni sidecar");

            handle
                .state::<ServerState>()
                .child
                .lock()
                .unwrap()
                .replace(child);

            let (tx, ready_rx) = mpsc::channel::<u16>();
            let task_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut announced = false;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            let chunk = String::from_utf8_lossy(&bytes);
                            for line in chunk.lines() {
                                if !line.contains("omni-ready") {
                                    continue;
                                }
                                if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
                                    if let Some(port) = value.get("port").and_then(|p| p.as_u64()) {
                                        let port = port as u16;
                                        task_handle
                                            .state::<ServerState>()
                                            .port
                                            .lock()
                                            .unwrap()
                                            .replace(port);
                                        if !announced {
                                            let _ = tx.send(port);
                                            announced = true;
                                        }
                                        let _ = task_handle.emit("omni://ready", port);
                                    }
                                }
                            }
                        }
                        CommandEvent::Stderr(bytes) => {
                            eprintln!("[omni-server] {}", String::from_utf8_lossy(&bytes));
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[omni-server] exited: {:?}", payload.code);
                        }
                        _ => {}
                    }
                }
            });

            // Give the sidecar a moment to bind before the webview asks for the port.
            let _ = ready_rx.recv_timeout(Duration::from_secs(10));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                if let Some(child) = window
                    .app_handle()
                    .state::<ServerState>()
                    .child
                    .lock()
                    .unwrap()
                    .take()
                {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Omni");
}
