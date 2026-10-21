# Deixa um computador novo pronto pro Somado Tarefas (notebook da Bianca, outro PC):
#   1. confere o Google Drive (banco de fotos, clientes, "Somado\Encarte - sistema")
#   2. instala o Node LTS se faltar (o editor de encarte local precisa; sem ele cai na web)
#   3. baixa e instala a última versão do programa (C:, %LOCALAPPDATA%\Somado Tarefas)
# Rodar no PowerShell da própria máquina:
#   irm https://raw.githubusercontent.com/somado-pro/smd-tarefas-desktop/main/scripts/instalar-computador.ps1 | iex
$ErrorActionPreference = "Stop"

function Passo([string]$t) { Write-Host "`n== $t" -ForegroundColor Cyan }

Passo "Google Drive"
$achou = @{}
foreach ($l in [char[]](68..90) + 'C') {
  foreach ($meu in "Meu Drive", "My Drive") {
    $raiz = "${l}:\$meu"
    if (-not (Test-Path $raiz)) { continue }
    if (Test-Path "$raiz\Somado\SMD Fotos dos produtos") { $achou.banco = "$raiz\Somado\SMD Fotos dos produtos" }
    if (Test-Path "$raiz\Backup_Drive_Antigo\CLIENTES\SUPERMERCADOS") { $achou.clientes = "$raiz\Backup_Drive_Antigo\CLIENTES\SUPERMERCADOS" }
    if (Test-Path "$raiz\Somado\Encarte - sistema") { $achou.sistema = "$raiz\Somado\Encarte - sistema" }
  }
}
foreach ($k in "banco", "clientes", "sistema") {
  if ($achou[$k]) { Write-Host "  ok  $k -> $($achou[$k])" }
  else { Write-Host "  FALTA $k (o Google Drive para computador está logado na conta certa? as pastas estão em 'Meu Drive'?)" -ForegroundColor Yellow }
}

Passo "Node"
if (Get-Command node -ErrorAction SilentlyContinue) {
  Write-Host "  ok  $(node -v)"
} else {
  Write-Host "  instalando o Node LTS (winget)…"
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  Write-Host "  ok  (vale depois de abrir o programa de novo)"
}

Passo "Programa Somado Tarefas"
$dest = Join-Path $env:TEMP "somado-tarefas-instalador"
New-Item -ItemType Directory -Force $dest | Out-Null
$rel = Invoke-RestMethod "https://api.github.com/repos/somado-pro/smd-tarefas-desktop/releases/latest"
$asset = $rel.assets | Where-Object { $_.name -like "*x64-setup.exe" } | Select-Object -First 1
$exe = Join-Path $dest $asset.name
Invoke-WebRequest $asset.browser_download_url -OutFile $exe
Get-Process smd-tarefas-desktop -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process $exe -ArgumentList "/S", "/D=$env:LOCALAPPDATA\Somado Tarefas" -Wait
Write-Host "  ok  $($rel.tag_name) instalado"

Passo "Pronto"
Write-Host @"
  1. Abra 'Somado Tarefas' pelo menu Iniciar e entre com o seu login.
  2. As pastas do encarte o programa acha sozinho (bandeja -> Configurações do encarte).
  3. Conferir o editor no PC: abra http://127.0.0.1:47831/saude no navegador -> {"ok":true}
"@
