// Servidor do editor de encarte no PC (SMD-1146). O programa sobe
// `node encarte-pc/servidor.mjs` (gerado pelo `npm run build:encarte-pc` do
// smd-gerencia) só em 127.0.0.1:47831, com os caminhos da configuração. O
// editor abre de lá e lê/grava direto no G:, sem a VPS. Sem Node instalado, o
// app cai pra versão web do editor sozinho.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub const PORTA: u16 = 47831;

#[derive(Serialize, Deserialize, Clone)]
pub struct Config {
    pub banco: String,
    pub clientes: String,
    pub fontes: String,
    pub padroes: String,
}

impl Default for Config {
    fn default() -> Self {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        Config {
            banco: r"G:\Meu Drive\Somado\SMD Fotos dos produtos".into(),
            clientes: r"G:\Meu Drive\Backup_Drive_Antigo\CLIENTES\SUPERMERCADOS".into(),
            fontes: format!(r"{local}\Microsoft\Windows\Fonts;C:\Windows\Fonts"),
            padroes: String::new(),
        }
    }
}

/// O Tauri devolve caminhos no formato longo do Windows (\\?\C:\...). O Node não
/// entende esse prefixo (lê só "C:" e morre com EISDIR): tira antes de passar.
fn sem_prefixo(p: &std::path::Path) -> PathBuf {
    let s = p.to_string_lossy();
    PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string())
}

#[derive(Default)]
pub struct Servidor(pub Mutex<Option<Child>>);

fn arquivo_config(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("encarte.json"))
}

pub fn ler(app: &AppHandle) -> Config {
    arquivo_config(app)
        .and_then(|a| std::fs::read_to_string(a).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn parar(app: &AppHandle) {
    let estado = app.state::<Servidor>();
    let mut atual = estado.0.lock().unwrap();
    if let Some(mut filho) = atual.take() {
        let _ = filho.kill();
        let _ = filho.wait();
    }
}

/// (Re)sobe o servidor com a configuração atual. Falha (sem Node, sem o
/// script) só fica no log: o app usa a web nesse caso.
pub fn subir(app: &AppHandle) {
    parar(app);
    let Ok(recursos) = app.path().resource_dir() else { return };
    let script = sem_prefixo(&recursos.join("encarte-pc").join("servidor.mjs"));
    let Ok(dados) = app.path().app_local_data_dir() else { return };
    let pasta = sem_prefixo(&dados.join("encarte"));
    let _ = std::fs::create_dir_all(&pasta);
    let cfg = ler(app);

    let log = std::fs::File::create(pasta.join("servidor.log")).ok();
    let mut cmd = Command::new("node");
    cmd.arg(&script)
        .env("ENCARTE_DIRETO", "1")
        .env("ENCARTE_PORTA", PORTA.to_string())
        .env("ENCARTE_DIR", &pasta)
        .env("ENCARTE_BANCO", &cfg.banco)
        .env("ENCARTE_CLIENTES", &cfg.clientes)
        .env("ENCARTE_FONTES", &cfg.fontes)
        .env("ENCARTE_APP", "http://tauri.localhost/")
        .stdin(Stdio::null());
    if !cfg.padroes.trim().is_empty() {
        cmd.env("ENCARTE_PADROES", cfg.padroes.trim());
    }
    if let Some(l) = log {
        if let Ok(l2) = l.try_clone() {
            cmd.stdout(l).stderr(l2);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: sem janela preta
    }
    if let Ok(filho) = cmd.spawn() {
        *app.state::<Servidor>().0.lock().unwrap() = Some(filho);
    }
}

#[tauri::command]
pub fn ler_config_encarte(app: AppHandle) -> Config {
    ler(&app)
}

#[tauri::command]
pub fn salvar_config_encarte(app: AppHandle, config: Config) -> Result<(), String> {
    let arq = arquivo_config(&app).ok_or("sem pasta de configuração")?;
    if let Some(p) = arq.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    let texto = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&arq, texto).map_err(|e| e.to_string())?;
    subir(&app);
    Ok(())
}
