// Somado Tarefas na bandeja do Windows. Desde a v0.2.0 (SMD-1133) a janela
// carrega o APP LOCAL empacotado (dist/, gerado pelo `npm run build:local` do
// smd-gerencia), que lê e grava direto no Supabase: o programa funciona com a
// VPS fora do ar. É a página que pergunta as notificações e chama os comandos
// daqui (definir_nao_lidas, notificar, abrir_na_web).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// A web: só pra abrir no navegador as telas que não existem no app local.
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

// ---------- notificações: a página (app local) avisa o programa ----------

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

/// Número de não lidas (aba Principal) pro ícone da bandeja.
#[tauri::command]
fn definir_nao_lidas(app: AppHandle, n: u32) {
    atualizar_icone(&app, n);
}

/// Toast nativo de um aviso novo. `url` é um caminho do app ("/?task=<id>").
#[tauri::command]
fn notificar_aviso(app: AppHandle, titulo: String, corpo: String, url: String) {
    notificar(&app, &titulo, &corpo, url);
}

/// Telas que só existem na web (encarte, configurações de admin) abrem no
/// navegador padrão. Só aceita endereço da própria web.
#[tauri::command]
fn abrir_na_web(app: AppHandle, url: String) {
    use tauri_plugin_opener::OpenerExt;
    if url.starts_with(&format!("{SITE}/")) {
        let _ = app.opener().open_url(url, None::<&str>);
    }
}

// ---------- links somado-tarefas:// (botão "Abrir pasta" do editor de encarte) ----------

const ESQUEMA: &str = "somado-tarefas";

/// somado-tarefas://abrir-pasta?caminho=<pasta> abre a pasta no Explorer. Só
/// pasta que existe (nunca arquivo nem programa): o link pode vir de qualquer
/// página, então o pior que ele faz é abrir uma janela do Explorer.
fn tratar_link(app: &AppHandle, link: &str) {
    let Ok(url) = tauri::Url::parse(link) else { return };
    if url.scheme() != ESQUEMA || url.host_str() != Some("abrir-pasta") {
        return;
    }
    let Some(caminho) = url.query_pairs().find(|(k, _)| k == "caminho").map(|(_, v)| v.into_owned()) else {
        return;
    };
    if std::path::Path::new(&caminho).is_dir() {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().open_path(caminho, None::<&str>);
    } else {
        notificar(app, "Pasta não encontrada", &caminho, "/".to_string());
    }
}

fn eh_link(arg: &str) -> bool {
    arg.starts_with(&format!("{ESQUEMA}:"))
}

// ---------- atualização automática ----------

async fn procurar_atualizacao(app: AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    // Só sobe de versão. Sem isso, uma versão de teste mais nova que a última
    // Release "atualizava" pra trás: o programa fechava pra rodar o instalador
    // antigo, que desistia (não instala por cima de versão maior).
    let Ok(builder) = app
        .updater_builder()
        .version_comparator(|atual, nova| nova.version > atual)
        .build()
    else {
        return;
    };
    let updater = builder;
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
        // Link somado-tarefas:// com o programa aberto chega como 2ª instância:
        // trata o link sem trazer a janela pra frente.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let links: Vec<&String> = args.iter().filter(|a| eh_link(a)).collect();
            if links.is_empty() {
                mostrar(app);
            }
            for l in links {
                tratar_link(app, l);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![ARG_MINIMIZADO]),
        ))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![definir_nao_lidas, notificar_aviso, abrir_na_web])
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

            // Programa aberto PELO link (estava fechado): trata e segue normal.
            for l in std::env::args().filter(|a| eh_link(a)) {
                tratar_link(&handle, &l);
            }
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                // Garante o registro do esquema no Windows (o instalador também faz).
                let _ = app.deep_link().register_all();
            }
            let minimizado = std::env::args().any(|a| a == ARG_MINIMIZADO);

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
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
