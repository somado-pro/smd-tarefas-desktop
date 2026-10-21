# Somado Tarefas — programa do Windows

Fica na bandeja (do lado do relógio), como o do ClickUp, e abre o Somado
Tarefas numa janela própria. Desde a v0.2.0 o app vem EMPACOTADO (não depende
da VPS: fala direto com o Supabase). Feito com Tauri 2 (usa o
WebView2 do Windows; instalador de poucos MB). Tarefa: SMD-1109.

## O que faz

- Ícone na bandeja: clique esquerdo mostra/esconde a janela; botão direito
  tem **Abrir**, **Nova tarefa**, **Iniciar com o Windows** (liga/desliga) e
  **Sair**. O X da janela só esconde.
- Inicia com o Windows (ligado na 1ª vez), já escondido na bandeja.
- Login e sessão ficam guardados; tamanho e posição da janela também.
- Notificação nativa do Windows pra cada notificação nova do Somado Tarefas
  (menção, atribuição, comentário, prazo…). Clicar abre a tarefa.
- Número de não lidas (aba Principal) desenhado no ícone da bandeja.
- Atalhos globais: **Ctrl+Shift+Espaço** mostra/esconde; **Ctrl+Alt+Espaço**
  abre a nova tarefa rápida.
- Se atualiza sozinho ao abrir, pela última Release do GitHub.

## Como funciona

A janela carrega `dist/`, que é o **app local** do smd-gerencia
(`npm run build:local`, SMD-1132): o mesmo front da web, que lê e grava direto
no Supabase com o login da pessoa (sessão guardada no próprio programa). Com a
VPS fora do ar ele continua abrindo, editando e avisando.

A página é quem pergunta as notificações (de 30 em 30 s) e chama os comandos do
programa (`src-tauri/src/main.rs`): `definir_nao_lidas` (número no ícone),
`notificar_aviso` (toast nativo; o clique volta pra página por
`window.__smdIr`) e `abrir_na_web` (telas que só existem na web, como o
encarte, abrem no navegador).

### Atualizar o app que vai dentro

`dist/` é gerado, não se edita à mão. Quando o front do smd-gerencia mudar:

```powershell
powershell -File scripts/atualizar-app-local.ps1
```

Isso roda o `build:local` no clone do smd-gerencia e copia pra `dist/`
(`dist/VERSAO-DO-APP.txt` diz de qual commit veio). Depois, versão nova como
abaixo. O pacote é público junto com o instalador: só leva a chave pública
(anon) do Supabase; quem protege os dados é a RLS.

## Gerar o instalador

Ninguém precisa de Rust na máquina: o GitHub Actions compila.

- **Teste:** push na `main` → aba Actions → "Instalador Windows" → artefato
  `instalador` (o `.exe`).
- **Versão nova (com atualização automática):**
  1. subir a versão em `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` e
     `package.json` (as três iguais);
  2. `git tag v0.2.0 && git push --tags`.
  A Release sai com o instalador, a assinatura e o `latest.json`. Quem já tem
  o programa recebe na próxima vez que ele abrir.

A assinatura usa a chave do segredo `TAURI_SIGNING_PRIVATE_KEY` do repo (sem
senha). Cópia em `%USERPROFILE%\.somado\smd-tarefas-desktop.key` no PC do
Matheus. **Perder essa chave = os instalados param de aceitar atualização**
(aí tem que reinstalar na mão com uma chave nova).

Compilar local (opcional): instalar Rust + Build Tools do Visual Studio, depois
`npm ci && npx tauri build`.

## Instalar

Rodar o `.exe` (instala só pro usuário, sem pedir admin, em
`%LOCALAPPDATA%\Somado Tarefas` — é onde fica no PC do Matheus, a pedido dele).
Silencioso: `& "Somado Tarefas_x.y.z_x64-setup.exe" /S`. Pra outra pasta,
`/D=<caminho>` por último e sem aspas (o instalador lembra da última pasta).
