#[derive(serde::Serialize)]
struct OpenApplication {
    id: String,
    title: String,
}

#[cfg(windows)]
#[tauri::command]
fn list_open_applications() -> Result<Vec<OpenApplication>, String> {
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::EnumWindows;

    unsafe extern "system" fn collect_window(
        hwnd: HWND,
        data: LPARAM,
    ) -> windows_sys::core::BOOL {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
            IsWindowVisible, GW_OWNER,
        };

        if IsWindowVisible(hwnd) == 0 || !GetWindow(hwnd, GW_OWNER).is_null() {
            return 1;
        }

        let length = GetWindowTextLengthW(hwnd);
        if length <= 0 {
            return 1;
        }

        let mut title = vec![0u16; length as usize + 1];
        let copied = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32);
        if copied <= 0 {
            return 1;
        }
        title.truncate(copied as usize);
        let title = String::from_utf16_lossy(&title).trim().to_owned();
        if title.is_empty() {
            return 1;
        }

        let mut process_id = 0;
        GetWindowThreadProcessId(hwnd, &mut process_id);
        if process_id == std::process::id() {
            return 1;
        }

        let applications = &mut *(data as *mut Vec<OpenApplication>);
        applications.push(OpenApplication {
            id: format!("{:x}", hwnd as usize),
            title,
        });
        1
    }

    let mut applications: Vec<OpenApplication> = Vec::new();
    let enumerated = unsafe {
        EnumWindows(
            Some(collect_window),
            &mut applications as *mut Vec<OpenApplication> as LPARAM,
        )
    };
    if enumerated == 0 {
        return Err("o Windows não conseguiu listar as janelas abertas.".to_owned());
    }
    applications.sort_by_key(|application| application.title.to_lowercase());
    Ok(applications)
}

#[cfg(not(windows))]
#[tauri::command]
fn list_open_applications() -> Result<Vec<OpenApplication>, String> {
    Err("a seleção de aplicativos está disponível apenas no Windows.".to_owned())
}

#[cfg(windows)]
#[tauri::command]
fn focus_application(window_id: String) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IsWindow, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    let raw_id = usize::from_str_radix(&window_id, 16)
        .map_err(|_| "identificador de janela inválido.".to_owned())?;
    let hwnd = raw_id as windows_sys::Win32::Foundation::HWND;
    unsafe {
        if IsWindow(hwnd) == 0 {
            return Err("o aplicativo selecionado não está mais aberto.".to_owned());
        }
        ShowWindow(hwnd, SW_RESTORE);
        if SetForegroundWindow(hwnd) == 0 {
            return Err("o Windows não permitiu trazer o aplicativo para frente.".to_owned());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
fn focus_application(_window_id: String) -> Result<(), String> {
    Err("o foco de aplicativos está disponível apenas no Windows.".to_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_open_applications,
            focus_application
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
