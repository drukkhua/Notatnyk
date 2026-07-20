use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Первый запуск — кладём демо-сметы, чтобы продукт был не пустой.
            // Ошибки не фатальны: приложение работает и без демо.
            if let Err(e) = seed_demo_notes(app.handle()) {
                eprintln!("[notatnyk] demo seed skipped: {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Notatnyk");
}

// Демонстрационные заметки при первом запуске.
// Фронтенд по умолчанию хранит заметки в `app_data_dir()/notatnyk` (см. DIR в main.js).
// Если этой папки ещё нет — это первый запуск: создаём её и копируем в неё демо-сметы,
// упакованные в ресурсы бандла (bundle.resources → `demo/`). При повторных запусках
// (папка уже есть) НИЧЕГО не трогаем — данные пользователя неприкосновенны.
//
// На десктопе ресурсы лежат на файловой системе и читаются напрямую. На мобильных
// ресурсы упакованы в APK/бандл и через std::fs недоступны — там сид тихо пропускается
// (демо всё равно физически поставляются внутри приложения).
fn seed_demo_notes<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> std::io::Result<()> {
    let io_err = |e: tauri::Error| std::io::Error::new(std::io::ErrorKind::Other, e.to_string());

    let notes_dir = app.path().app_data_dir().map_err(io_err)?.join("notatnyk");
    if notes_dir.exists() {
        return Ok(()); // не первый запуск
    }

    let demo_dir = match app.path().resource_dir() {
        Ok(dir) => dir.join("demo"),
        Err(_) => return Ok(()),
    };
    if !demo_dir.is_dir() {
        return Ok(()); // демо не упакованы / недоступны (мобильные) — молча выходим
    }

    std::fs::create_dir_all(&notes_dir)?;
    for entry in std::fs::read_dir(&demo_dir)?.flatten() {
        let src = entry.path();
        if src.extension().and_then(|s| s.to_str()) == Some("md") {
            if let Some(name) = src.file_name() {
                std::fs::copy(&src, notes_dir.join(name))?;
            }
        }
    }
    Ok(())
}
