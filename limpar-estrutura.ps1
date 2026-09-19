# Remove os restos da estrutura antiga.
#
#   powershell -ExecutionPolicy Bypass -File .\limpar-estrutura.ps1
#
# Rode a partir da raiz do projeto (onde ficam backend\ e frontend\).
# Use -Simular para ver o que seria apagado sem apagar nada.

param([switch]$Simular)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path (Join-Path $raiz "backend"))) {
    Write-Host "Rode este script na raiz do projeto (onde ficam backend\ e frontend\)." -ForegroundColor Red
    exit 1
}

# Pastas e arquivos que existiam antes da reestruturação em apps/ e features/.
# Manter os dois lados faz o TypeScript e o Pylance apontarem erro em codigo
# que nem e mais usado, e o editor abrir o arquivo errado na busca.
$obsoletos = @(
    # Backend: tudo de core/ virou apps/<dominio>/
    "backend\core",
    "backend\settings_trecho.py",

    # Frontend: pages/ virou features/<dominio>/
    "frontend\src\pages",
    "frontend\src\components",
    "frontend\src\lib",

    # PainelCupom pertence a fiscal, nao a contratos
    "frontend\src\features\contratos\components\PainelCupom.tsx",

    # Duplicatas de quem baixou arquivos avulsos para a raiz
    "vite.config.ts", "ARQUITETURA.md", "API.md", "BarraStatus.tsx",
    "fila.ts", "fila.test.ts", "useSincronizacao.ts", "api.ts",
    "ferramentas.py", "cliente.py", "models.py", "views.py",
    "AppShell.tsx", "Kpi.tsx", "Selo.tsx", "CabecalhoPagina.tsx",
    "PainelProjecao.tsx", "PainelCupom.tsx", "Contratos.tsx", "Notas.tsx",
    "index.css", "tailwind.config.js"
)

$encontrados = $obsoletos |
    Where-Object { Test-Path (Join-Path $raiz $_) }

if (-not $encontrados) {
    Write-Host "Nada a limpar. A estrutura ja esta correta." -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "Restos da estrutura antiga encontrados:" -ForegroundColor Yellow
$encontrados | ForEach-Object { Write-Host "  $_" }
Write-Host ""

if ($Simular) {
    Write-Host "Simulacao: nada foi apagado. Rode sem -Simular para remover." -ForegroundColor Cyan
    exit 0
}

foreach ($alvo in $encontrados) {
    Remove-Item -Recurse -Force (Join-Path $raiz $alvo)
    Write-Host "  removido: $alvo" -ForegroundColor Green
}

Write-Host ""
Write-Host "Pronto. Agora extraia o zip de atualizacao por cima do projeto e rode:"
Write-Host "  cd frontend; npm install; npm run lint"
