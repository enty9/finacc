mod ai;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ai::AiState::new())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            ai::ai_status,
            ai::ai_install_model,
            ai::ai_cancel_install,
            ai::ai_delete_model,
            ai::ai_unload_model,
            ai::ai_chat,
            ai::ai_stop_chat,
        ])
        .run(tauri::generate_context!())
        .expect("Не удалось запустить finacc");
}
