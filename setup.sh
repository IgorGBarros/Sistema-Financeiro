#!/usr/bin/env bash
# Prepara o projeto do zero: venv, dependências, banco e dados iniciais.
#   ./setup.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# O script pode estar na raiz do projeto ou um nível acima (caso comum quando o
# zip é extraído para dentro de outra pasta). Procura nos dois.
if [ ! -d "$RAIZ/backend" ]; then
  for dir in "$RAIZ"/*/; do
    if [ -d "$dir/backend" ]; then
      RAIZ="${dir%/}"
      echo "Projeto encontrado em $RAIZ"
      break
    fi
  done
fi

# Falhar aqui, com uma mensagem clara, é melhor que um erro de cd adiante.
for pasta in backend frontend; do
  if [ ! -d "$RAIZ/$pasta" ]; then
    cat >&2 <<FIM

Não encontrei a pasta '$pasta' em $RAIZ

O projeto inteiro precisa estar extraído nesta pasta. O conteúdo esperado é:
  backend/   frontend/   dados/   setup.sh   setup.ps1   README.md

Se você baixou apenas alguns arquivos soltos, baixe o sistema-financeiro.zip
e extraia tudo antes de rodar de novo.
FIM
    exit 1
  fi
done

# Arquivos que só fazem sentido dentro de subpastas. Soltos na raiz, são
# duplicatas de quem baixou arquivos avulsos em vez do zip — confundem o
# editor e a busca do projeto.
SOLTOS=""
for arquivo in vite.config.ts ARQUITETURA.md API.md BarraStatus.tsx fila.ts \
               fila.test.ts useSincronizacao.ts api.ts ferramentas.py \
               cliente.py models.py views.py; do
  [ -f "$RAIZ/$arquivo" ] && SOLTOS="$SOLTOS  $arquivo\n"
done
if [ -n "$SOLTOS" ]; then
  echo ""
  echo "Aviso: estes arquivos estão soltos na raiz e não deveriam estar:"
  printf "$SOLTOS"
  echo "São duplicatas do que já existe nas subpastas. Pode apagar."
  echo ""
fi

for cmd in python3 npm; do
  if ! command -v "$cmd" > /dev/null 2>&1; then
    echo "'$cmd' não está no PATH. Instale Python 3.10+ e Node 18+." >&2
    exit 1
  fi
done

PLANILHA="$RAIZ/dados/entrada_e_saida.xlsx"

echo "==> Backend"
cd "$RAIZ/backend"

if [ ! -f .venv/bin/activate ]; then
  [ -d .venv ] && { echo "    virtualenv incompleto; recriando"; rm -rf .venv; }
  if ! python3 -m venv .venv || [ ! -f .venv/bin/activate ]; then
    cat >&2 <<FIM

A criação do virtualenv falhou. Em Debian/Ubuntu, o módulo venv vem em
pacote separado:

    sudo apt install python3-venv

FIM
    exit 1
  fi
  echo "    virtualenv criado em backend/.venv"
fi
# shellcheck disable=SC1091
source .venv/bin/activate

pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet
echo "    dependências instaladas"

python manage.py migrate --noinput
echo "    banco migrado"

if [ -f "$PLANILHA" ]; then
  python manage.py preparar_ambiente --planilha "$PLANILHA"
else
  python manage.py preparar_ambiente
fi

echo ""
echo "==> Frontend"
cd "$RAIZ/frontend"
npm install --no-audit --no-fund
echo "    node_modules instalado"

cat <<'FIM'

Pronto. Suba os dois serviços em terminais separados:

  Terminal 1:  cd backend && source .venv/bin/activate && python manage.py runserver
  Terminal 2:  cd frontend && npm run dev

Depois abra http://localhost:5173
FIM
