use cef::*;
use std::io::{self, Write};
use url::Url;

fn report_startup_error(message: &str) {
    let mut stdout = io::stdout().lock();
    let _ = writeln!(stdout, "MANTIQUARIUS_CEF_ERROR={message}");
    let _ = stdout.flush();
}

#[derive(Clone)]
struct BrowserConfig {
    parent: usize,
    bounds: Rect,
    url: String,
    cache_path: String,
}

wrap_client! {
    struct BrowserClient;

    impl Client {
        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(BrowserLifeSpanHandler::new())
        }
    }
}

wrap_life_span_handler! {
    struct BrowserLifeSpanHandler;

    impl LifeSpanHandler {
        fn on_after_created(&self, browser: Option<&mut Browser>) {
            let Some(handle) = browser
                .and_then(|browser| browser.host())
                .map(|host| host.window_handle().0)
            else {
                report_startup_error("o Chromium não conseguiu criar a janela do navegador.");
                return;
            };

            let mut stdout = io::stdout().lock();
            let _ = writeln!(stdout, "MANTIQUARIUS_CEF_HWND={:x}", handle as usize);
            let _ = stdout.flush();
        }
    }
}

wrap_app! {
    struct BrowserApp {
        config: BrowserConfig,
    }

    impl App {
        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(CefBrowserProcessHandler::new(self.config.clone()))
        }
    }
}

wrap_browser_process_handler! {
    struct CefBrowserProcessHandler {
        config: BrowserConfig,
    }

    impl BrowserProcessHandler {
        fn on_context_initialized(&self) {
            let window_info = WindowInfo::default().set_as_child(
                cef::sys::HWND(self.config.parent as _),
                &self.config.bounds,
            );
            let browser_settings = BrowserSettings::default();
            let url = CefString::from(self.config.url.as_str());
            let mut client = BrowserClient::new();

            if browser_host_create_browser(
                Some(&window_info),
                Some(&mut client),
                Some(&url),
                Some(&browser_settings),
                None,
                None,
            ) == 0
            {
                report_startup_error("o CEF recusou a criação da janela do navegador.");
            }
        }
    }
}

fn switch_value(command_line: &CommandLine, switch: &str) -> String {
    let switch = CefString::from(switch);
    CefString::from(&command_line.switch_value(Some(&switch))).to_string()
}

fn read_config(command_line: &CommandLine) -> Result<BrowserConfig, String> {
    let parse_switch = |name: &str| -> Result<i32, String> {
        switch_value(command_line, name)
            .parse()
            .map_err(|_| format!("Invalid --{name} value."))
    };

    let parent = usize::from_str_radix(
        &switch_value(command_line, "parent-hwnd").trim_start_matches("0x"),
        16,
    )
    .map_err(|_| "Invalid parent window handle.".to_owned())?;
    let url = switch_value(command_line, "url");
    let parsed_url = Url::parse(&url).map_err(|_| "Invalid website URL.".to_owned())?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("Only HTTP and HTTPS websites can be opened.".to_owned());
    }

    let cache_path = switch_value(command_line, "cache-path");
    if cache_path.is_empty() {
        return Err("Missing CEF profile directory.".to_owned());
    }

    Ok(BrowserConfig {
        parent,
        bounds: Rect {
            x: parse_switch("x")?,
            y: parse_switch("y")?,
            width: parse_switch("width")?.max(1),
            height: parse_switch("height")?.max(1),
        },
        url,
        cache_path,
    })
}

fn run_cef(instance: cef::sys::HINSTANCE, sandbox_info: *mut u8) -> i32 {
    let _ = api_hash(sys::CEF_API_VERSION_LAST, 0);
    let args = cef::args::Args::from(MainArgs { instance });
    let Some(command_line) = args.as_cmd_line() else {
        return 1;
    };

    let process_type = CefString::from("type");
    let is_browser_process = command_line.has_switch(Some(&process_type)) != 1;
    let result = execute_process(Some(args.as_main_args()), None, sandbox_info);
    if !is_browser_process || result >= 0 {
        return result;
    }

    let config = match read_config(&command_line) {
        Ok(config) => config,
        Err(error) => {
            report_startup_error(&error);
            return 1;
        }
    };
    let mut app = BrowserApp::new(config.clone());
    let settings = Settings {
        cache_path: CefString::from(config.cache_path.as_str()),
        persist_session_cookies: 1,
        ..Default::default()
    };
    if initialize(
        Some(args.as_main_args()),
        Some(&settings),
        Some(&mut app),
        sandbox_info,
    ) != 1
    {
        report_startup_error("a inicialização do CEF falhou.");
        return 1;
    }

    run_message_loop();
    shutdown();
    0
}

#[no_mangle]
pub unsafe extern "C" fn RunWinMain(
    instance: cef::sys::HINSTANCE,
    _command_line: *const u8,
    _command_show: i32,
    sandbox_info: *mut u8,
) -> i32 {
    run_cef(instance, sandbox_info)
}
