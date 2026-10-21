# Gera o app local e o servidor do encarte no smd-gerencia e copia pra dist/ e
# src-tauri/encarte-pc/ (o que o programa empacota).
# Rodar antes de subir versao nova sempre que o front mudar:
#   powershell -File scripts\atualizar-app-local.ps1 [-Gerencia <clone do smd-gerencia>]
param([string]$Gerencia = "D:\Claude Code Projetos Locais\smd-gerencia")
$ErrorActionPreference = "Stop"
Push-Location $Gerencia
try {
  npm run build:local; if ($LASTEXITCODE -ne 0) { throw "build:local falhou" }
  npm run build:encarte-pc; if ($LASTEXITCODE -ne 0) { throw "build:encarte-pc falhou" }
} finally { Pop-Location }
$destino = Join-Path $PSScriptRoot "..\dist"
Remove-Item -Recurse -Force $destino -ErrorAction SilentlyContinue
Copy-Item -Recurse (Join-Path $Gerencia "dist-local") $destino
# servidor do editor de encarte no PC (SMD-1146), vai como recurso do programa
$enc = Join-Path $PSScriptRoot "..\src-tauri\encarte-pc"
Remove-Item -Recurse -Force $enc -ErrorAction SilentlyContinue
Copy-Item -Recurse (Join-Path $Gerencia "dist-encarte-pc") $enc
$commit = git -C $Gerencia rev-parse --short HEAD
Set-Content -Encoding utf8 (Join-Path $destino "VERSAO-DO-APP.txt") "smd-gerencia $commit"
Write-Host "dist/ atualizado com o app local do smd-gerencia $commit"
