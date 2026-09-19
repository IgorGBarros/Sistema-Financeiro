# Sistema Financeiro

Controle de receitas e despesas pessoais, com projeção de contratos, leitura de
cupom fiscal (NFC-e) por QR Code e um assistente de IA sobre os próprios dados.

Português do Brasil em nomes de variável, função, comentário e mensagem de
interface. Termos técnicos consagrados ficam em inglês (`queryset`, `signal`,
`build`).

## Comandos

```bash
make instalar   # venv + dependências dos dois lados
make migrar
make seed       # workspace, plano de contas e a planilha de dados/
make api        # backend em :8000
make web        # frontend em :5173
make testes     # 92 testes: 66 de regra pura, 14 com banco, 12 da fila offline
python manage.py importar_documento arquivo.pdf --simular   # extrai sem gravar
make lint       # manage.py check + tsc --noEmit
```

Backend: `cd backend && .venv/bin/python manage.py <comando>`
Frontend: `cd frontend && npm run <script>`

Sem `DB_HOST` no ambiente, roda em SQLite com autenticação de desenvolvimento.
Não é preciso configurar Supabase nem Firebase para trabalhar.

## Estrutura

```
backend/
  config/settings/{base,dev,prod}.py
  apps/
    common/      Base, EscopoWorkspace, WorkspaceViewSet, exceptions, pagination
    accounts/    Workspace, autenticação, seed, comandos
    catalogo/    Classificação, Categoria, Estabelecimento
    contratos/   Contrato, ParcelaPrevista, projeção
    realizados/  Realizado
    fiscal/      NotaFiscal, itens, QR Code, SEFAZ, consolidação
    relatorios/  fluxo de caixa, aderência
    documentos/  pipeline de importação de PDF + extratores
    cartoes/     cartão, compras, parcelas, faturas, conciliação
    contas/      contas de consumo (luz, água, gás)
    financiamento/  financiamento imobiliário (DDC do banco)
    folha/       holerites — receita, isolada do fluxo por ora
    previsao/    modelos, backtesting e simulação de cenários
    assistente/  ferramentas de IA
frontend/src/
  features/{fluxo,contratos,fiscal,assistente}/
  shared/{ui,lib,components}/
```

Dentro de cada app: `models.py`, `services/`, `serializers.py`, `views.py`,
`urls.py`, `signals.py`, `tests/`. Feature nova é app novo mais uma linha em
`config/urls.py`.

**Serviço não conhece request.** Regra de negócio em `services/` recebe dados e
devolve dados. É o que permite testar sem banco e reusar a mesma função na API,
no comando de importação e nas ferramentas do assistente.

## Invariantes

Quebrar qualquer um destes é bug, não escolha de estilo.

**Valores são sempre positivos.** O sinal vem do campo `tipo`
(RECEITA/DESPESA). A planilha original guardava receita como negativo; o
importador normaliza. Misturar sinal com natureza faz todo `SUM` precisar saber
de qual conta está falando.

**Competência é sempre dia 1 do mês.** É a chave de junção entre previsto e
realizado.

**Isolamento por workspace.** Toda tabela de negócio herda de
`EscopoWorkspace`; todo viewset herda de `WorkspaceViewSet`. O workspace vem do
usuário autenticado, nunca do payload. O header `X-Workspace` só escolhe entre
workspaces dos quais a pessoa já é membro — o filtro parte de
`request.user.workspaces`.

**A projeção nunca é editada à mão.** `ParcelaPrevista` é derivada do contrato e
regerada por signal a cada save. Editar uma parcela isolada faria a projeção
discordar do contrato que a originou.

**Scan sem pagamento é cupom fora do fluxo de caixa.** Ler o QR salva a nota;
o que gera lançamento é `registrar_pagamento`. Crédito vira Compra com
parcelas; à vista vira Realizado. Ver apps/fiscal/services/pagamento.py.

**Despesa entra uma vez só.** Cada fonte nova cria uma forma de duplicar:
compra e fatura do cartão, contrato fixo e DDC do financiamento, contrato de
luz e conta importada. Ver docs/REGRA_DE_NEGOCIO.md antes de mexer em qualquer
uma delas.

**Extrator não conhece models.** Ele recebe bytes e devolve uma `Extracao`. É
o que permite testar contra o PDF real sem banco, e reprocessar documentos
antigos quando o parser melhora.

**Previsão separa determinístico de estocástico.** Contrato e financiamento
têm valor conhecido; aplicar modelo neles adiciona erro onde havia certeza. Só
a parte sem contrato é estimada. Ver docs/PREVISAO.md.

**O assistente não escreve SQL.** Ele escolhe entre ferramentas em
`apps/assistente/services/ferramentas.py`, e o `workspace` é posicional,
injetado pelo servidor — não aparece no schema que o modelo vê. Ferramenta nova
tem que receber `workspace` como primeiro parâmetro e não expô-lo em
`parametros`; há teste que falha se isso for violado.

## Armadilhas já encontradas

Cada uma custou uma sessão de depuração. Elas voltam.

**`transaction.on_commit` não dispara em `TestCase`.** O teste roda numa
transação com rollback, então os signals nunca executam e a projeção não é
gerada. Em teste, chame `gerar_parcelas(contrato)` explicitamente ou use
`captureOnCommitCallbacks`. Sem isso o teste valida o vazio e passa.

**`annotate()` exige `order_by()` explícito.** A anotação monta um `GROUP BY`
sem ordem garantida, e a paginação do DRF passa a devolver resultados
inconsistentes entre páginas.

**Paginação mora em `apps/common/pagination.py`, não em `api.py`.** O DRF
resolve `DEFAULT_PAGINATION_CLASS` ao importar `rest_framework.viewsets`; se a
classe estivesse num módulo que importa `viewsets`, dá import circular com a
mensagem enganosa "módulo não define PaginacaoPadrao".

**`DATEDIFF(..., MONTH)` do DAX conta fronteiras de mês, não meses completos.**
De 31/01 para 01/02 são 1 mês com 1 dia de diferença. `dias / 30` está errado.
Ver `apps/contratos/services/projecao.py`.

**O DRF pagina toda lista.** O cliente TypeScript desembrulha
`{count, results}` em `shared/lib/api.ts`; use o helper `lista<T>()`, não
`request<T[]>()`.

**Falha de rede vira `ApiError` com status 0.** É o que distingue "sem
internet" (enfileira o cupom) de "servidor recusou" (mostra o erro). Use
`erro.offline`.

**`throttle_scope` não pode ir no `@action`.** O router repassa os kwargs para
`as_view()`, que rejeita chaves desconhecidas. Defina em `initial()`.

**`pdfminer` emite uma linha de DEBUG por token do PDF.** Silenciado em
`config/settings/base.py`; sem isso, a saída útil some no meio de milhares de
linhas.

**Nomes de tabela nas views SQL são `fiscal_*`.** Mudaram no split de apps; SQL
cru em `apps/fiscal/sql/` precisa acompanhar.

## Frontend

Tokens de design em `src/index.css` como variáveis CSS, expostos ao Tailwind em
`tailwind.config.js`. Tema escuro é troca de valores, não segunda tabela de
classes.

Classes próprias: `.cartao` (cartão do layout bento), `.rotulo` (rótulo em caixa
alta), `.tabular` (números monoespaçados — use em toda coluna de valor).

Ícones em **Lucide**, não Material Symbols. Fontes auto-hospedadas via
`@fontsource`. Os dois pelo mesmo motivo: o app é um PWA que precisa abrir
offline, e requisição externa quebraria isso.

**Nunca cachear resposta da API no service worker.** Saldo desatualizado é pior
que ausente — a pessoa decidiria com número velho sem perceber. Offline, só o
scanner funciona; as telas de dados mostram erro.

Cores `receita` e `despesa` são conceito de domínio. O verde do mockup
(`#4edea3`) tem contraste insuficiente para texto sobre fundo claro; use-o só
como marcador.

## Ao mudar algo

1. `make lint` e `make testes` antes de considerar pronto.
2. Regra de negócio nova ganha teste em `services/`, sem banco quando possível.
3. Se a mudança cria dado que o assistente deveria consultar, adicione uma
   ferramenta em `apps/assistente/services/ferramentas.py`.
4. Mudou modelo? `makemigrations` — o CI falha com migration pendente.
5. Decisão não óbvia vira comentário explicando **por quê**, não o quê.

## Contexto de negócio

O usuário é pessoa física, em Salvador/BA. Os dados de exemplo em
`dados/entrada_e_saida.xlsx` são reais: 18 contratos, saldo negativo já em
janeiro/2026.

A leitura de cupom acontece no supermercado, muitas vezes sem sinal — daí a
fila offline e a idempotência por chave de acesso.

A raspagem da SEFAZ-BA é frágil por natureza. O HTML bruto fica em
`NotaFiscal.payload` para reprocessar sem reconsultar; falha grava a nota com
status `ERRO` e os dados extraídos da própria chave. Os seletores CSS estão
isolados no topo de `apps/fiscal/services/sefaz_ba.py`.
