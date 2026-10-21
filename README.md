# Somado Tarefas — programa do Windows

Fica na bandeja (do lado do relógio), como o do ClickUp, e abre
https://tarefas.somado.com.br numa janela própria. Feito com Tauri 2 (usa o
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

A janela carrega o site em produção. O próprio programa (thread
`vigiar_notificacoes` em `src-tauri/src/main.rs`) lê o login da janela (cookies
do WebView2) e, a cada 30 s, consulta `GET /api/desktop/notificacoes?desde=<ISO>`
(rota do smd-gerencia, PR #204): atualiza o número no ícone e mostra um toast
pra cada nova. A página não fala com o programa (sem IPC aberto pro site).

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

Rodar o `.exe` (instala só pro usuário, sem pedir admin). No PC do Matheus foi
instalado em `D:\Somado Tarefas` com `"Somado Tarefas_x.y.z_x64-setup.exe" /S /D=D:\Somado Tarefas`.
