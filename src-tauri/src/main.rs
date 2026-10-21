// Somado Tarefas na bandeja do Windows: uma janela que carrega
// https://tarefas.somado.com.br, fica do lado do relógio e avisa com
// notificação nativa. O próprio programa consulta /api/desktop/notificacoes
// com o login da janela (vigiar_notificacoes).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const SITE: &str = "https://tarefas.somado.com.br";
const ARG_MINIMIZADO: &str = "--minimizado";
const ICONE: &[u8] = include_bytes!("../icons/32x32.png");

struct Estado {
    nao_lidas: Mutex<u32>,
}

fn janela(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("main")
}

fn mostrar(app: &AppHandle) {
    if let Some(w) = janela(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn alternar(app: &AppHandle) {
    if let Some(w) = janela(app) {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
            let _ = w.hide();
        } else {
            mostrar(app);
        }
    }
}

/// Roda um trecho fixo na página (o dado vai escapado por JSON).
fn na_pagina(app: &AppHandle, js: &str) {
    if let Some(w) = janela(app) {
        let _ = w.eval(js);
    }
}

/// Leva a janela pra um caminho do app (ex. "/?task=<uuid>").
fn abrir_caminho(app: &AppHandle, caminho: &str) {
    if !caminho.starts_with('/') {
        return;
    }
    mostrar(app);
    let alvo = serde_json::to_string(caminho).unwrap_or_default();
    na_pagina(app, &format!("window.__smdIr ? window.__smdIr({alvo}) : (location.href = {alvo});"));
}

fn nova_tarefa(app: &AppHandle) {
    mostrar(app);
    na_pagina(app, "document.dispatchEvent(new CustomEvent('smd:open-quick-add'));");
}

// ---------- ícone da bandeja com o número de não lidas ----------

/// Dígitos 3×5 (bit 4 = coluna da esquerda); o índice 10 é o "+".
const DIGITOS: [[u8; 5]; 11] = [
    [7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1],
    [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 1, 1, 1], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7],
    [0, 2, 7, 2, 0],
];

fn icone_com_numero(n: u32) -> Image<'static> {
    let base = Image::from_bytes(ICONE).expect("ícone 32x32");
    let (w, h) = (base.width() as i32, base.height() as i32);
    let mut px = base.rgba().to_vec();
    if n > 0 {
        let mut pinta = |x: i32, y: i32, c: [u8; 4]| {
            if x >= 0 && y >= 0 && x < w && y < h {
                let i = ((y * w + x) * 4) as usize;
                px[i..i + 4].copy_from_slice(&c);
            }
        };
        // bolinha vermelha no canto de baixo à direita
        let (cx, cy, r) = (w - 10, h - 10, 10);
        for y in cy - r..=cy + r {
            for x in cx - r..=cx + r {
                if (x - cx).pow(2) + (y - cy).pow(2) <= r * r {
                    pinta(x, y, [220, 38, 38, 255]);
                }
            }
        }
        let glifos: Vec<usize> = if n > 9 { vec![9, 10] } else { vec![n as usize] };
        let escala = 2;
        let largura = glifos.len() as i32 * 4 * escala - escala;
        let x0 = cx - largura / 2;
        let y0 = cy - 5 * escala / 2;
        for (g, &d) in glifos.iter().enumerate() {
            for (linha, bits) in DIGITOS[d].iter().enumerate() {
                for col in 0..3 {
                    if bits & (4 >> col) != 0 {
                        for dy in 0..escala {
                            for dx in 0..escala {
                                pinta(
                                    x0 + (g as i32 * 4 + col) * escala + dx,
                                    y0 + linha as i32 * escala + dy,
                                    [255, 255, 255, 255],
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    Image::new_owned(px, w as u32, h as u32)
}

// ---------- notificações: o programa pergunta direto ao site ----------

fn atualizar_icone(app: &AppHandle, n: u32) {
    let estado = app.state::<Estado>();
    let mut atual = estado.nao_lidas.lock().unwrap();
    if *atual == n {
        return;
    }
    *atual = n;
    if let Some(tray) = app.tray_by_id("bandeja") {
        let _ = tray.set_icon(Some(icone_com_numero(n)));
        let dica = match n {
            0 => "Somado Tarefas".to_string(),
            1 => "Somado Tarefas · 1 não lida".to_string(),
            _ => format!("Somado Tarefas · {n} não lidas"),
        };
        let _ = tray.set_tooltip(Some(dica));
    }
}

fn notificar(app: &AppHandle, titulo: &str, corpo: &str, url: String) {
    #[cfg(windows)]
    {
        use tauri_winrt_notification::Toast;
        let aumid = app.config().identifier.clone();
        let app2 = app.clone();
        let _ = Toast::new(&aumid)
            .title(titulo)
            .text1(corpo)
            .on_activated(move |_| {
                let app3 = app2.clone();
                let url = url.clone();
                let _ = app2.run_on_main_thread(move || abrir_caminho(&app3, &url));
                Ok(())
            })
            .show();
    }
    #[cfg(not(windows))]
    let _ = (app, titulo, corpo, url);
}

/// Usa o login da própria janela (cookies do WebView2) pra consultar
/// /api/desktop/notificacoes de 30 em 30 s. Roda fora da thread principal,
/// porque ler cookies dela trava no Windows.
fn vigiar_notificacoes(app: AppHandle) {
    std::thread::spawn(move || {
        let mut desde: Option<String> = None;
        std::thread::sleep(std::time::Duration::from_secs(5));
        loop {
            if let Some(w) = janela(&app) {
                let site: tauri::Url = SITE.parse().unwrap();
                if let Ok(cookies) = w.cookies_for_url(site) {
                    let cabecalho = cookies
                        .iter()
                        .map(|c| format!("{}={}", c.name(), c.value()))
                        .collect::<Vec<_>>()
                        .join("; ");
                    let mut url = format!("{SITE}/api/desktop/notificacoes");
                    if let Some(d) = &desde {
                        url.push_str("?desde=");
                        url.push_str(&d.replace(':', "%3A").replace('+', "%2B"));
                    }
                    let resp = ureq::get(&url)
                        .set("Cookie", &cabecalho)
                        .timeout(std::time::Duration::from_secs(15))
                        .call();
                    if let Ok(r) = resp {
                        if let Ok(d) = r.into_json::<serde_json::Value>() {
                            desde = d["agora"].as_str().map(String::from).or(desde);
                            let n = d["naoLidas"].as_u64().unwrap_or(0) as u32;
                            let app2 = app.clone();
                            let _ = app.run_on_main_thread(move || atualizar_icone(&app2, n));
                            for nv in d["novas"].as_array().cloned().unwrap_or_default() {
                                notificar(
                                    &app,
                                    nv["titulo"].as_str().unwrap_or("Somado Tarefas"),
                                    nv["corpo"].as_str().unwrap_or(""),
                                    nv["url"].as_str().unwrap_or("/inbox").to_string(),
                                );
                            }
                        }
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(30));
        }
    });
}

// ---------- atualização automática ----------

async fn procurar_atualizacao(app: AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    let Ok(updater) = app.updater() else { return };
    if let Ok(Some(update)) = updater.check().await {
        if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
            app.restart();
        }
    }
}

fn main() {
    let atalho_janela = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
    let atalho_nova = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| mostrar(app)))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![ARG_MINIMIZADO]),
        ))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, atalho, ev| {
                    if ev.state() != ShortcutState::Pressed {
                        return;
                    }
                    if atalho == &atalho_janela {
                        alternar(app);
                    } else if atalho == &atalho_nova {
                        nova_tarefa(app);
                    }
                })
                .build(),
        )
        .manage(Estado { nao_lidas: Mutex::new(0) })
        .setup(move |app| {
            let handle = app.handle().clone();
            let minimizado = std::env::args().any(|a| a == ARG_MINIMIZADO);

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(SITE.parse().unwrap()))
                .title("Somado Tarefas")
                .inner_size(1280.0, 820.0)
                .min_inner_size(420.0, 500.0)
                .build()?;
            // Criar já escondida quebra o WebView2 ("identificador da janela é
            // inválido"): nasce visível e some logo em seguida no início com o Windows.
            if minimizado {
                if let Some(w) = janela(&handle) {
                    let _ = w.hide();
                }
            }

            // Inicia com o Windows: ligado na 1ª vez; depois vale o que a pessoa escolher.
            let marca = app.path().app_config_dir()?.join("autostart-configurado");
            let autostart = app.autolaunch();
            if !marca.exists() {
                let _ = autostart.enable();
                let _ = std::fs::create_dir_all(marca.parent().unwrap());
                let _ = std::fs::write(&marca, "1");
            }
            let ligado = autostart.is_enabled().unwrap_or(false);

            let abrir = MenuItem::with_id(app, "abrir", "Abrir", true, None::<&str>)?;
            let nova = MenuItem::with_id(app, "nova", "Nova tarefa", true, None::<&str>)?;
            let iniciar = CheckMenuItem::with_id(app, "iniciar", "Iniciar com o Windows", true, ligado, None::<&str>)?;
            let sair = MenuItem::with_id(app, "sair", "Sair", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&abrir, &nova, &sep1, &iniciar, &sep2, &sair])?;

            let iniciar2 = iniciar.clone();
            TrayIconBuilder::with_id("bandeja")
                .icon(icone_com_numero(0))
                .tooltip("Somado Tarefas")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, ev| match ev.id().as_ref() {
                    "abrir" => mostrar(app),
                    "nova" => nova_tarefa(app),
                    "iniciar" => {
                        let al = app.autolaunch();
                        let quer = !al.is_enabled().unwrap_or(false);
                        let _ = if quer { al.enable() } else { al.disable() };
                        let _ = iniciar2.set_checked(al.is_enabled().unwrap_or(quer));
                    }
                    "sair" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = ev
                    {
                        alternar(tray.app_handle());
                    }
                })
                .build(app)?;

            let gs = app.global_shortcut();
            let _ = gs.register(atalho_janela);
            let _ = gs.register(atalho_nova);

            vigiar_notificacoes(handle.clone());
            tauri::async_runtime::spawn(procurar_atualizacao(handle));
            Ok(())
        })
        .on_window_event(|w, ev| {
            // X só esconde; quem fecha de verdade é o "Sair" da bandeja.
            if let WindowEvent::CloseRequested { api, .. } = ev {
                api.prevent_close();
                let _ = w.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao abrir o Somado Tarefas");
}
