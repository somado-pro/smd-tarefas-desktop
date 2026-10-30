# Publica versão nova do programa quando o front do smd-gerencia mudou (SMD-1134).
#
# Chamado pelo atualiza-somado-tarefas.ps1 do cofre (a cada 15 min, depois de puxar o
# smd-gerencia) — só no PC do Matheus, onde estão os dois clones e o gh logado. Compara o
# commit que está dentro do programa (dist/VERSAO-DO-APP.txt) com a master do smd-gerencia;
# se mudou algo que vai no app (app/, components/, lib/, local/, public/, types/), roda o
# atualizar-app-local.ps1, sobe a versão (patch), faz o commit, a tag e o push. O GitHub
# Actions gera a Release e os programas instalados se atualizam sozinhos.
#
# Desde 30/10/2026 usa um clone SÓ DELE do smd-gerencia ($Gerencia, sempre a master do GitHub,
# com node_modules próprio). Antes usava o clone de trabalho: quando ele estava num branch de PR,
# a publicação desistia calada e o programa ficava dias com o front velho (v0.3.14 → v0.3.15).
param(
  [string]$Gerencia = "D:\Claude Code Projetos Locais\smd-gerencia-publicar",
  [string]$Log = ""
)
$ErrorActionPreference = "Stop"
$desk = Split-Path $PSScriptRoot -Parent

function Escrever([string]$m) {
  $linha = "{0} [programa] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  if ($Log) { Add-Content -Path $Log -Encoding UTF8 -Value $linha } else { Write-Host $linha }
}
function GitX {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & git @args } finally { $ErrorActionPreference = $old }
}

$marca = Join-Path $desk "dist\VERSAO-DO-APP.txt"
if (-not (Test-Path $marca)) { return }
$dentro = ((Get-Content $marca -Raw) -split '\s+')[1]
if (-not $dentro) { return }

# clone só da publicação: nasce na 1ª vez e fica sempre igual à master do GitHub (ninguém
# trabalha nele, então pode descartar o que tiver)
if (-not (Test-Path (Join-Path $Gerencia ".git"))) {
  Escrever "criando o clone da publicação em $Gerencia"
  GitX clone -q --branch master https://github.com/somado-pro/smd-gerencia.git $Gerencia
  if ($LASTEXITCODE -ne 0) { Escrever "ERRO: clone do smd-gerencia falhou"; return }
}
GitX -C $Gerencia fetch -q origin master
if ($LASTEXITCODE -ne 0) { Escrever "AVISO: fetch do smd-gerencia falhou (sem rede?)"; return }
GitX -C $Gerencia checkout -q -B master origin/master
GitX -C $Gerencia reset -q --hard origin/master
$agora = (GitX -C $Gerencia rev-parse --short HEAD).Trim()
if ($agora -eq $dentro) { return }
$mudou = @(GitX -C $Gerencia diff --name-only $dentro HEAD -- app components lib local public types package.json)
if (-not $mudou.Count) { return }

# programa: na main, limpo e em dia
if ((GitX -C $desk rev-parse --abbrev-ref HEAD).Trim() -ne 'main') { Escrever "PULANDO: programa fora da main"; return }
if (@(GitX -C $desk status --porcelain --untracked-files=no).Count) { Escrever "PULANDO: programa com mudança local"; return }
GitX -C $desk pull -q --ff-only
if ($LASTEXITCODE -ne 0) { Escrever "PULANDO: pull do programa falhou"; return }

Escrever "front mudou ($dentro → $agora, $($mudou.Count) arquivo(s)): gerando versão nova"
try {
  # processo próprio pelo Start-Process: com ErrorActionPreference Stop, qualquer aviso no stderr
  # (chunk > 500 kB do Vite, "npm warn deprecated") virava "ERRO no build" e a versão nunca saía,
  # até com `& powershell ... *> log`. Aqui só vale o código de saída.
  $build = Join-Path $env:TEMP "smd-publicar-build.log"
  $p = Start-Process powershell.exe -Wait -PassThru -NoNewWindow `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$(Join-Path $PSScriptRoot 'atualizar-app-local.ps1')`"", "-Gerencia", "`"$Gerencia`"") `
    -RedirectStandardOutput $build -RedirectStandardError "$build.err"
  if ($p.ExitCode -ne 0) { Escrever "ERRO no build (log em $build e $build.err)"; return }
} catch {
  Escrever "ERRO no build: $_"
  return
} finally {
  # o build regera a tabela de rotas do servidor do encarte: não deixa o clone "sujo"
  GitX -C $Gerencia checkout -q -- local/encarte-pc/rotas.gerado.ts 2>$null
}

# versão: sobe o último número nos três arquivos
$conf = Join-Path $desk "src-tauri\tauri.conf.json"
$atual = ([regex]'"version":\s*"(\d+)\.(\d+)\.(\d+)"').Match((Get-Content $conf -Raw))
$nova = "{0}.{1}.{2}" -f $atual.Groups[1].Value, $atual.Groups[2].Value, ([int]$atual.Groups[3].Value + 1)
$velha = "{0}.{1}.{2}" -f $atual.Groups[1].Value, $atual.Groups[2].Value, $atual.Groups[3].Value
foreach ($arq in @("package.json", "src-tauri\tauri.conf.json")) {
  $p = Join-Path $desk $arq
  [IO.File]::WriteAllText($p, ((Get-Content $p -Raw) -replace "`"version`": `"$velha`"", "`"version`": `"$nova`""))
}
$cargo = Join-Path $desk "src-tauri\Cargo.toml"
[IO.File]::WriteAllText($cargo, ((Get-Content $cargo -Raw) -replace "(?m)^version = `"$velha`"", "version = `"$nova`""))

GitX -C $desk add -A dist src-tauri package.json
GitX -C $desk commit -q -m "v${nova}: app atualizado com o smd-gerencia $agora (automático)"
GitX -C $desk push -q
GitX -C $desk tag "v$nova"
GitX -C $desk push -q origin "v$nova"
if ($LASTEXITCODE -ne 0) { Escrever "ERRO: push da tag v$nova falhou"; return }
Escrever "publicado v$nova (smd-gerencia $agora); a Release sai em ~10 min"
