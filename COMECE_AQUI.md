# Do zero até rodar

Tudo que falta é criar o `venv` e o `node_modules`. Um comando faz os dois:

```bash
./setup.sh                                          # Linux / macOS
powershell -ExecutionPolicy Bypass -File setup.ps1  # Windows
```

O script cria o virtualenv, instala as dependências dos dois lados, migra o
banco e importa a planilha que está em `dados/entrada_e_saida.xlsx`.

Depois, dois terminais:

```bash
# Terminal 1
cd backend && source .venv/bin/activate && python manage.py runserver

# Terminal 2
cd frontend && npm run dev
```

Abra <http://localhost:5173>.

## Se preferir passo a passo

```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py preparar_ambiente --planilha ../dados/entrada_e_saida.xlsx
python manage.py runserver

# Frontend (outro terminal)
cd frontend
npm install
npm run dev
```

Confira em <http://127.0.0.1:8000/api/saude/> — deve responder
`{"status": "ok"}`.

## O assistente de IA

Opcional. Sem chave configurada os endpoints do assistente respondem 503 com
instrução, e o resto do sistema funciona normalmente.

Para ligar, adicione ao `backend/.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

E reinicie a API. O assistente responde a partir dos seus próprios dados — ele
consulta o banco por ferramentas de leitura, nunca escrevendo SQL. Veja
`docs/ARQUITETURA.md` para o porquê.

## Instalar no celular

O frontend é um PWA. Com HTTPS, o navegador oferece "Adicionar à tela de
início"; no iOS é manual (Compartilhar → Adicionar à Tela de Início).

Instalado, ele **lê cupons sem conexão**: a leitura entra numa fila local e é
enviada sozinha quando a internet voltar. É o cenário do corredor de
supermercado com sinal fraco.

Para testar no celular durante o desenvolvimento, a câmera exige HTTPS —
`localhost` conta, o IP da rede local não:

```bash
npx localtunnel --port 5173
```

## Pré-requisitos

Python 3.10+ e Node 18+. Nada além disso: sem `DB_HOST` no ambiente, o projeto
usa SQLite e a autenticação de desenvolvimento. É de propósito — você vê o
sistema funcionando antes de configurar Supabase e Firebase.

## O que você deve ver

- **Fluxo de caixa** — receitas, despesas e saldo acumulado. Com a planilha
  importada, o saldo fica negativo já em janeiro/2026; é o dado real dos seus
  contratos, não um exemplo.
- **Entradas e saídas** — os 18 contratos. Clique em um para editar e veja o
  número de parcelas recalcular enquanto você muda as datas.
- **Cupons fiscais** — o botão de leitura abre a câmera.

## Testando a leitura do cupom

A câmera exige **HTTPS**. `localhost` conta como contexto seguro, mas abrir
pelo IP da rede local no celular não. Para testar no aparelho:

```bash
npx localtunnel --port 5173      # ou ngrok http 5173
```

Sem câmera à mão, use o campo "Digitar a chave" com os 44 dígitos impressos
abaixo do QR Code. A do cupom que você mandou:

```
2926 0806 3370 8700 1579 6501 1000 2303 4512 2576 1309
```

## Quando quiser ir para produção

### Postgres (Supabase)

Preencha o `.env` do backend a partir do `.env.example` e rode `migrate` de
novo. As materialized views do consolidado são criadas nesse momento — em
SQLite a migration é no-op e o endpoint usa agregação via ORM.

Agende o refresh:

```bash
*/15 * * * * cd /app && python manage.py refresh_consolidado
```

### Firebase

Baixe o `serviceAccountKey.json` no console, aponte
`FIREBASE_CREDENTIALS_PATH` para ele e preencha as `VITE_FIREBASE_*` do
frontend. A partir daí a autenticação de desenvolvimento some sozinha — ela só
existe com `DEBUG=1` **e** sem Firebase configurado.

### Servidor

```bash
gunicorn config.wsgi:application --workers 3 --bind 0.0.0.0:8000
```

Com `DEBUG=0`, defina `SECRET_KEY`, `ALLOWED_HOSTS` e `CORS_ORIGINS`.

## Comandos úteis

| Comando | Para quê |
|---|---|
| `make testes` | 57 testes (31 de regra + 14 com banco + 12 da fila offline) |
| `make ajuda` | Lista todos os atalhos |
| `python manage.py importar_planilha --arquivo x.xlsx --workspace <id> --dry-run` | Conferir a importação sem gravar |
| `python manage.py check` | Checagem do Django |
| `python manage.py refresh_consolidado` | Atualizar as views (só Postgres) |
| `npm run lint` | Checagem de tipos do frontend |
| `npm run build` | Build de produção |

## Problemas comuns

**`ModuleNotFoundError: firebase_admin`** — normal em desenvolvimento. O import
é preguiçoso e só acontece quando o Firebase está configurado.

**Lista de contratos vazia** — confirme que o `preparar_ambiente` rodou. Ele
imprime o `WORKSPACE_ID` no fim.

**Câmera não abre** — é HTTPS. Veja a seção de teste do cupom acima.

**`REFRESH MATERIALIZED VIEW` falha** — você está em SQLite. O comando só
funciona no Postgres, e o sistema não depende dele para funcionar.
