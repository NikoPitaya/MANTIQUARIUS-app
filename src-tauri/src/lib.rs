#[derive(serde::Serialize)]
struct OpenApplication {
    id: String,
    title: String,
}

#[cfg(windows)]
struct EmbeddedBrowser {
    url: String,
    child: std::process::Child,
    hwnd: isize,
}

#[cfg(windows)]
#[derive(Default)]
struct EmbeddedBrowserState {
    active: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, EmbeddedBrowser>>>,
    shutting_down: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

#[cfg(windows)]
impl Drop for EmbeddedBrowserState {
    fn drop(&mut self) {
        close_embedded_browsers(self);
    }
}

#[cfg(windows)]
fn stop_direct_child(child: &mut std::process::Child) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|error| format!("não foi possível verificar o Chromium: {error}"))?
        .is_none()
    {
        child
            .kill()
            .map_err(|error| format!("não foi possível fechar o Chromium: {error}"))?;
    }
    child
        .wait()
        .map_err(|error| format!("não foi possível aguardar o Chromium: {error}"))?;
    Ok(())
}

#[cfg(windows)]
fn stop_child_process_tree(child: &mut std::process::Child) -> Result<(), String> {
    use std::process::Command;

    if child
        .try_wait()
        .map_err(|error| format!("não foi possível verificar o Chromium: {error}"))?
        .is_none()
    {
        let process_id = child.id().to_string();
        let result = Command::new("taskkill")
            .args(["/PID", process_id.as_str(), "/T", "/F"])
            .output();

        match result {
            Ok(output) if output.status.success() => {}
            Ok(output) => {
                stop_direct_child(child)?;
                return Err(format!(
                    "não foi possível fechar todos os processos do Chromium: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ));
            }
            Err(error) => {
                stop_direct_child(child)?;
                return Err(format!(
                    "não foi possível encerrar os processos do Chromium: {error}"
                ));
            }
        }
    }
    stop_direct_child(child)
}

#[cfg(windows)]
fn stop_embedded_browser(browser: &mut EmbeddedBrowser) -> Result<(), String> {
    stop_child_process_tree(&mut browser.child)
}

#[cfg(windows)]
fn close_embedded_browsers(state: &EmbeddedBrowserState) {
    use std::sync::atomic::Ordering;

    state.shutting_down.store(true, Ordering::Release);
    match state.active.lock() {
        Ok(mut browsers) => {
            for browser in browsers.values_mut() {
                if let Err(error) = stop_embedded_browser(browser) {
                    eprintln!("{error}");
                }
            }
            browsers.clear();
        }
        Err(_) => eprintln!("o estado do navegador está indisponível durante o fechamento."),
    }
}

#[cfg(windows)]
fn set_embedded_browser_bounds(
    hwnd: isize,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IsWindow, SetWindowPos, ShowWindow, SWP_NOACTIVATE, SWP_NOZORDER, SW_HIDE, SW_SHOWNA,
    };

    if width < 0 || height < 0 || width > 8192 || height > 8192 {
        return Err("as dimensões do painel Chromium são inválidas.".to_owned());
    }
    let hwnd = hwnd as windows_sys::Win32::Foundation::HWND;
    unsafe {
        if IsWindow(hwnd) == 0 {
            return Err("a janela Chromium não está mais aberta.".to_owned());
        }
        if width == 0 || height == 0 {
            ShowWindow(hwnd, SW_HIDE);
            return Ok(());
        }
        if SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOZORDER,
        ) == 0
        {
            return Err("o Windows não conseguiu redimensionar o painel Chromium.".to_owned());
        }
        ShowWindow(hwnd, SW_SHOWNA);
    }
    Ok(())
}

#[cfg(windows)]
fn cef_host_executable(_app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    #[cfg(not(debug_assertions))]
    use tauri::Manager;

    #[cfg(debug_assertions)]
    let directory = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("cef-runtime");
    #[cfg(not(debug_assertions))]
    let directory = _app
        .path()
        .resource_dir()
        .map_err(|error| format!("não foi possível localizar os arquivos do app: {error}"))?
        .join("cef-runtime");

    let executable = directory.join("cefbrowser.exe");
    if !executable.is_file() {
        return Err(
            "o Chromium integrado não foi preparado. Execute `npm run tauri:dev` para baixar e preparar o CEF."
                .to_owned(),
        );
    }
    Ok(executable)
}

#[cfg(windows)]
#[tauri::command]
async fn cef_open_browser(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, EmbeddedBrowserState>,
    media_id: String,
    url: String,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    use tauri::Manager;

    let parsed = url::Url::parse(&url).map_err(|_| "o endereço do site é inválido.".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("o Chromium integrado aceita apenas sites HTTP ou HTTPS.".to_owned());
    }
    if width <= 0 || height <= 0 || width > 8192 || height > 8192 {
        return Err("as dimensões do painel Chromium são inválidas.".to_owned());
    }

    let parent = window
        .hwnd()
        .map_err(|error| format!("não foi possível anexar o Chromium à janela: {error}"))?
        .0 as usize;
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("não foi possível localizar os dados do app: {error}"))?
        .join("cef-profile");
    std::fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("não foi possível criar o perfil Chromium: {error}"))?;
    let executable = cef_host_executable(&app)?;
    let active = state.active.clone();
    let shutting_down = state.shutting_down.clone();
    let url = parsed.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        cef_open_browser_blocking(
            active,
            shutting_down,
            media_id,
            url,
            x,
            y,
            width,
            height,
            parent,
            cache_dir,
            executable,
        )
    })
    .await
    .map_err(|error| format!("a tarefa de inicialização do Chromium falhou: {error}"))?
}

#[cfg(windows)]
fn cef_open_browser_blocking(
    active: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, EmbeddedBrowser>>>,
    shutting_down: std::sync::Arc<std::sync::atomic::AtomicBool>,
    media_id: String,
    url: String,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    parent: usize,
    cache_dir: std::path::PathBuf,
    executable: std::path::PathBuf,
) -> Result<(), String> {
    use std::{
        hash::{Hash, Hasher},
        io::{BufRead, BufReader},
        process::{Command, Stdio},
        sync::atomic::Ordering,
        sync::mpsc,
        time::Duration,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::IsWindow;

    {
        let mut browsers = active
            .lock()
            .map_err(|_| "o estado do navegador está indisponível.".to_owned())?;
        if shutting_down.load(Ordering::Acquire) {
            return Err("o MANTIQUARIUS está sendo fechado.".to_owned());
        }
        if let Some(browser) = browsers.get_mut(&media_id) {
            if browser.url == url {
                return set_embedded_browser_bounds(browser.hwnd, x, y, width, height);
            }
            stop_embedded_browser(browser)?;
        }
        browsers.remove(&media_id);
    }

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    media_id.hash(&mut hasher);
    let profile_dir = cache_dir.join(format!("{:016x}", hasher.finish()));
    std::fs::create_dir_all(&profile_dir)
        .map_err(|error| format!("não foi possível criar o perfil Chromium: {error}"))?;

    let mut child = Command::new(&executable)
        .current_dir(
            executable
                .parent()
                .expect("CEF executable has a parent directory"),
        )
        .arg(format!("--parent-hwnd={parent:x}"))
        .arg(format!("--x={x}"))
        .arg(format!("--y={y}"))
        .arg(format!("--width={width}"))
        .arg(format!("--height={height}"))
        .arg(format!("--url={url}"))
        .arg(format!("--cache-path={}", profile_dir.display()))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("não foi possível iniciar o Chromium: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "não foi possível conectar ao Chromium.".to_owned())?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if let Some(raw) = line.strip_prefix("MANTIQUARIUS_CEF_HWND=") {
                        let hwnd = isize::from_str_radix(raw, 16).map_err(|_| {
                            "o Chromium retornou um identificador inválido.".to_owned()
                        });
                        let _ = sender.send(hwnd);
                        return;
                    }
                    if let Some(error) = line.strip_prefix("MANTIQUARIUS_CEF_ERROR=") {
                        let _ = sender.send(Err(error.to_owned()));
                        return;
                    }
                }
                Err(error) => {
                    let _ = sender.send(Err(format!(
                        "não foi possível ler a resposta do Chromium: {error}"
                    )));
                    return;
                }
            }
        }
        let _ = sender.send(Err("o Chromium fechou antes de carregar o site.".to_owned()));
    });

    let hwnd = match receiver.recv_timeout(Duration::from_secs(60)) {
        Ok(Ok(hwnd)) => hwnd,
        Ok(Err(error)) => {
            if let Err(cleanup_error) = stop_child_process_tree(&mut child) {
                eprintln!("{cleanup_error}");
            }
            return Err(error);
        }
        Err(_) => {
            if let Err(cleanup_error) = stop_child_process_tree(&mut child) {
                eprintln!("{cleanup_error}");
            }
            return Err("o Chromium não concluiu a inicialização em 60 segundos.".to_owned());
        }
    };
    unsafe {
        if IsWindow(hwnd as windows_sys::Win32::Foundation::HWND) == 0 {
            if let Err(error) = stop_child_process_tree(&mut child) {
                eprintln!("{error}");
            }
            return Err("o Windows não criou a janela Chromium.".to_owned());
        }
    }

    let mut browsers = active
        .lock()
        .map_err(|_| "o estado do navegador está indisponível.".to_owned())?;
    if shutting_down.load(Ordering::Acquire) {
        let mut browser = EmbeddedBrowser { url, child, hwnd };
        if let Err(error) = stop_embedded_browser(&mut browser) {
            eprintln!("{error}");
        }
        return Err("o MANTIQUARIUS está sendo fechado.".to_owned());
    }
    if let Some(mut previous) = browsers.remove(&media_id) {
        stop_embedded_browser(&mut previous)?;
    }
    browsers.insert(media_id, EmbeddedBrowser { url, child, hwnd });
    Ok(())
}

#[cfg(windows)]
#[tauri::command]
fn cef_resize_browser(
    state: tauri::State<'_, EmbeddedBrowserState>,
    media_id: String,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| "o estado do navegador está indisponível.".to_owned())?;
    let exited = match active.get_mut(&media_id) {
        Some(browser) => browser
            .child
            .try_wait()
            .map_err(|error| format!("não foi possível verificar o Chromium: {error}"))?
            .is_some(),
        None => return Ok(()),
    };
    if exited {
        active.remove(&media_id);
        return Err("o processo Chromium foi encerrado.".to_owned());
    }
    let browser = active.get(&media_id).expect("browser was checked above");
    set_embedded_browser_bounds(browser.hwnd, x, y, width, height)
}

#[cfg(windows)]
#[tauri::command]
fn cef_close_browser(
    state: tauri::State<'_, EmbeddedBrowserState>,
    media_id: String,
) -> Result<(), String> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| "o estado do navegador está indisponível.".to_owned())?;
    if let Some(mut browser) = active.remove(&media_id) {
        stop_embedded_browser(&mut browser)?;
    }
    Ok(())
}

#[cfg(windows)]
#[tauri::command]
fn list_open_applications() -> Result<Vec<OpenApplication>, String> {
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::EnumWindows;

    unsafe extern "system" fn collect_window(hwnd: HWND, data: LPARAM) -> windows_sys::core::BOOL {
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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_vnidrop_fs::init());

    #[cfg(windows)]
    let builder = builder
        .manage(EmbeddedBrowserState::default())
        .invoke_handler(tauri::generate_handler![
            list_open_applications,
            focus_application,
            cef_open_browser,
            cef_resize_browser,
            cef_close_browser
        ]);

    #[cfg(not(windows))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        list_open_applications,
        focus_application
    ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building Tauri application");
    app.run(|app_handle, event| {
        #[cfg(windows)]
        if matches!(event, tauri::RunEvent::Exit) {
            use tauri::Manager;
            close_embedded_browsers(app_handle.state::<EmbeddedBrowserState>().inner());
        }
    });
}
