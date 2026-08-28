# Prepara o projeto do zero no Windows.
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = "Stop"

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path

# O script pode estar na raiz do projeto ou um nível acima dele (caso comum
# quando o zip é extraído para dentro de outra pasta). Procura nos dois.
if (-not (Test-Path (Join-Path $raiz "backend"))) {
    $candidato = Get-ChildItem -Path $raiz -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName "backend") } |
        Select-Object -First 1
    if ($candidato) {
        $raiz = $candidato.FullName
        Write-Host "Projeto encontrado em $raiz"
    }
}

# Falhar aqui, com uma mensagem clara, é melhor que um erro de Set-Location
# três linhas adiante.
foreach ($pasta in @("backend", "frontend")) {
    if (-not (Test-Path (Join-Path $raiz $pasta))) {
        Write-Host ""
        Write-Host "Nao encontrei a pasta '$pasta' em $raiz" -ForegroundColor Red
        Write-Host ""
        Write-Host "O projeto inteiro precisa estar extraido nesta pasta. O conteudo"
        Write-Host "esperado e:"
        Write-Host "  backend\   frontend\   dados\   setup.ps1   setup.sh   README.md"
        Write-Host ""
        Write-Host "Se voce baixou apenas alguns arquivos soltos, baixe o"
        Write-Host "sistema-financeiro.zip e extraia tudo antes de rodar de novo."
        exit 1
    }
}

# Python e Node precisam existir antes de tentarmos usa-los.
foreach ($cmd in @("python", "npm")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host ""
        Write-Host "'$cmd' nao esta no PATH." -ForegroundColor Red
        if ($cmd -eq "python") {
            Write-Host "Instale o Python 3.10+ em https://python.org e marque"
            Write-Host "'Add python.exe to PATH' durante a instalacao."
        } else {
            Write-Host "Instale o Node 18+ em https://nodejs.org"
        }
        exit 1
    }
}

$planilha = Join-Path $raiz "dados\entrada_e_saida.xlsx"

Write-Host "==> Backend"
Set-Location (Join-Path $raiz "backend")

if (-not (Test-Path ".venv")) {
    python -m venv .venv
    Write-Host "    virtualenv criado em backend\.venv"
}
& .\.venv\Scripts\Activate.ps1

python -m pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet
Write-Host "    dependencias instaladas"

python manage.py migrate --noinput

if (Test-Path $planilha) {
    python manage.py preparar_ambiente --planilha $planilha
} else {
    python manage.py preparar_ambiente
}

Write-Host ""
Write-Host "==> Frontend"
Set-Location (Join-Path $raiz "frontend")
npm install --no-audit --no-fund

Write-Host ""
Write-Host "Pronto. Suba os dois servicos em terminais separados:"
Write-Host "  Terminal 1: cd backend; .\.venv\Scripts\Activate.ps1; python manage.py runserver"
Write-Host "  Terminal 2: cd frontend; npm run dev"
Write-Host "Depois abra http://localhost:5173"
