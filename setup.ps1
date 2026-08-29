# Prepara o projeto do zero no Windows.
#
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
#
# Se a deteccao automatica do Python falhar, aponte o caminho na mao:
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Python "C:\Python312\python.exe"

param(
    [string]$Python = "",
    [switch]$PularFrontend
)

$ErrorActionPreference = "Stop"

function Parar($mensagem) {
    Write-Host ""
    Write-Host $mensagem -ForegroundColor Red
    Write-Host ""
    exit 1
}

# ---------------------------------------------------------------------------
# Localizar o projeto
# ---------------------------------------------------------------------------

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path

# O script pode estar na raiz do projeto ou um nivel acima dele (caso comum
# quando o zip e extraido para dentro de outra pasta). Procura nos dois.
if (-not (Test-Path (Join-Path $raiz "backend"))) {
    $candidato = Get-ChildItem -Path $raiz -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName "backend") } |
        Select-Object -First 1
    if ($candidato) {
        $raiz = $candidato.FullName
        Write-Host "Projeto encontrado em $raiz"
    }
}

foreach ($pasta in @("backend", "frontend")) {
    if (-not (Test-Path (Join-Path $raiz $pasta))) {
        Parar @"
Nao encontrei a pasta '$pasta' em $raiz

O projeto inteiro precisa estar extraido nesta pasta. O conteudo esperado e:
  backend\  frontend\  docs\  dados\  setup.ps1  README.md

Se voce baixou apenas alguns arquivos soltos, baixe o zip completo e extraia
tudo antes de rodar de novo.
"@
    }
}

# Arquivos que so fazem sentido dentro de subpastas. Soltos na raiz, sao
# duplicatas de quem baixou arquivos avulsos em vez do zip.
$soltos = @(
    "vite.config.ts", "ARQUITETURA.md", "API.md", "BarraStatus.tsx",
    "fila.ts", "fila.test.ts", "useSincronizacao.ts", "api.ts",
    "ferramentas.py", "cliente.py", "models.py", "views.py"
) | Where-Object { Test-Path (Join-Path $raiz $_) }

if ($soltos) {
    Write-Host ""
    Write-Host "Aviso: estes arquivos estao soltos na raiz e nao deveriam estar:" -ForegroundColor Yellow
    $soltos | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Write-Host "Sao duplicatas do que ja existe nas subpastas. Pode apagar." -ForegroundColor Yellow
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Encontrar o Python
# ---------------------------------------------------------------------------

# Escrita para se comportar igual no Windows PowerShell 5.1 e no PowerShell 7.
# Evita de proposito tres coisas que divergem entre as versoes ou dependem do
# ambiente do usuario:
#   - fatiar array com $x[1..$x.Length], que trata array de 1 item diferente
#   - invocar pelo nome, que o perfil do usuario pode sombrear com funcao/alias
#   - confiar so em $LASTEXITCODE, em vez de conferir tambem o texto da saida
function Resolver-Python {
    param([string]$Preferido = "")

    $tentativas = @()
    $stubs = 0       # executaveis que so abrem a Microsoft Store
    $reais = 0       # executaveis que rodaram e responderam outra coisa
    $candidatos = @()

    if ($Preferido) { $candidatos += , @{ Exe = $Preferido; Args = @() } }
    $candidatos += , @{ Exe = "py";      Args = @("-3") }
    $candidatos += , @{ Exe = "python";  Args = @() }
    $candidatos += , @{ Exe = "python3"; Args = @() }

    foreach ($c in $candidatos) {
        $rotulo = (@($c.Exe) + $c.Args) -join " "

        # -CommandType Application ignora alias e funcao do perfil do usuario.
        # -All testa TODAS as ocorrencias no PATH, nao so a primeira: e comum
        # haver um stub antes de um Python real.
        $encontrados = @(
            Get-Command $c.Exe -CommandType Application -All -ErrorAction SilentlyContinue
        )
        if ($encontrados.Count -eq 0) {
            $tentativas += "$rotulo -> nao esta no PATH"
            continue
        }

        foreach ($encontrado in $encontrados) {
            $caminho = $encontrado.Source
            if (-not $caminho) { continue }

            # Nao ha heuristica de caminho aqui, de proposito. Quando o Python
            # vem da Microsoft Store, o executavel REAL tambem fica em
            # 'WindowsApps' — no mesmo lugar dos atalhos que so abrem a loja.
            # Descartar pelo caminho rejeitava instalacoes que funcionam.
            # A unica forma confiavel de distinguir e executar e olhar a saida.
            try {
                $saida = (& $caminho @($c.Args) --version 2>&1 | Out-String).Trim()
            } catch {
                $tentativas += "$rotulo [$caminho] -> erro ao executar: $($_.Exception.Message)"
                continue
            }

            if ($saida -match "Python\s+3\.(\d+)") {
                if ([int]$Matches[1] -ge 10) {
                    return @{ Caminho = $caminho; Args = $c.Args; Versao = $saida }
                }
                $reais += 1
                $tentativas += "$rotulo [$caminho] -> $saida (o projeto precisa de 3.10 ou maior)"
            } elseif ($saida -match "Microsoft Store|was not found") {
                $stubs += 1
                $tentativas += "$rotulo [$caminho] -> atalho da Microsoft Store, nao executa nada"
            } else {
                $reais += 1
                $tentativas += "$rotulo [$caminho] -> resposta inesperada: '$saida'"
            }
        }
    }

    # Falha dizendo o que foi tentado e onde, em vez de chutar a causa.
    $lista = ($tentativas | ForEach-Object { "  $_" }) -join [Environment]::NewLine

    # "Nao tem Python" so vale se TUDO que executou foi atalho da loja. Um
    # candidato ausente do PATH nao conta como evidencia — a versao anterior
    # somava o 'py -3 nao esta no PATH' e a mensagem certa nunca aparecia.
    if ($stubs -gt 0 -and $reais -eq 0) {
        Parar @"
Voce nao tem o Python instalado.

O que foi tentado:
$lista

Os comandos encontrados sao apenas atalhos da Microsoft Store: eles abrem a
loja e nao executam nada.

Instale e rode este script de novo:

    winget install Python.Python.3.12

Feche e reabra o PowerShell depois de instalar (o PATH so atualiza em
terminal novo) e confirme com:

    py -3 --version
"@
    }

    Parar @"
Nao encontrei um Python 3.10 ou superior utilizavel.

O que foi tentado:
$lista

Se algum dos caminhos acima e o seu Python e mesmo assim foi recusado,
aponte direto:

    .\setup.ps1 -Python "CAMINHO\python.exe"

Para descobrir o caminho:

    python -c "import sys; print(sys.executable)"
"@
}

$py = Resolver-Python -Preferido $Python
Write-Host "Python: $($py.Versao)  [$($py.Caminho)]"

if (-not $PularFrontend) {
    if (-not (Get-Command npm -CommandType Application -ErrorAction SilentlyContinue)) {
        Parar @"
'npm' nao esta no PATH. Instale o Node 18+ em https://nodejs.org

Para preparar so o backend por enquanto:
  .\setup.ps1 -PularFrontend
"@
    }
}

# ---------------------------------------------------------------------------
# Backend
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "==> Backend"
Set-Location (Join-Path $raiz "backend")

$pythonVenv = Join-Path (Get-Location) ".venv\Scripts\python.exe"

if (-not (Test-Path $pythonVenv)) {
    if (Test-Path ".venv") {
        Write-Host "    virtualenv incompleto encontrado; recriando"
        Remove-Item -Recurse -Force ".venv"
    }

    Write-Host "    criando virtualenv..."
    & $py.Caminho @($py.Args) -m venv .venv

    # $ErrorActionPreference nao captura falha de programa externo, so de
    # cmdlet. Sem checar aqui, o script seguia adiante e estourava depois em
    # 'Activate.ps1 nao encontrado', escondendo a causa real.
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $pythonVenv)) {
        Parar @"
A criacao do virtualenv falhou.

Rode manualmente para ver a mensagem completa:
    cd "$(Get-Location)"
    & "$($py.Caminho)" -m venv .venv

Causa comum: instalacao do Python sem o modulo 'venv'. Reinstale pelo
python.org, que ja o inclui.
"@
    }
    Write-Host "    virtualenv criado em backend\.venv"
}

# Chamar o python do venv direto e mais confiavel que ativar e torcer para o
# PATH da sessao ter mudado: Activate.ps1 depende da politica de execucao, que
# e justamente o que costuma estar travado numa maquina de trabalho.
& $pythonVenv -m pip install --upgrade pip --quiet
if ($LASTEXITCODE -ne 0) { Parar "Falha ao atualizar o pip." }

& $pythonVenv -m pip install -r requirements.txt --quiet
if ($LASTEXITCODE -ne 0) { Parar "Falha ao instalar as dependencias do backend." }
Write-Host "    dependencias instaladas"

& $pythonVenv manage.py migrate --noinput
if ($LASTEXITCODE -ne 0) { Parar "Falha ao migrar o banco." }

$planilha = Join-Path $raiz "dados\entrada_e_saida.xlsx"
if (Test-Path $planilha) {
    & $pythonVenv manage.py preparar_ambiente --planilha $planilha
} else {
    & $pythonVenv manage.py preparar_ambiente
}
if ($LASTEXITCODE -ne 0) { Parar "Falha ao preparar o ambiente." }

# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------

if (-not $PularFrontend) {
    Write-Host ""
    Write-Host "==> Frontend"
    Set-Location (Join-Path $raiz "frontend")

    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Parar "Falha ao instalar as dependencias do frontend." }
    Write-Host "    node_modules instalado"
}

Write-Host ""
Write-Host "Pronto. Suba os dois servicos em terminais separados:" -ForegroundColor Green
Write-Host "  Terminal 1: cd backend; .\.venv\Scripts\python.exe manage.py runserver"
Write-Host "  Terminal 2: cd frontend; npm run dev"
Write-Host ""
Write-Host "Depois abra http://localhost:5173"
