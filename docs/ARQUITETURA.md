# Arquitetura

## Organização

O código é dividido por **domínio**, não por camada técnica. Cada app é dono
das suas tabelas, regras, endpoints e testes.

```
backend/
  config/
    settings/base.py     o que vale em todo ambiente
    settings/dev.py      SQLite, DEBUG, autenticação de desenvolvimento
    settings/prod.py     Postgres, Redis, Firebase, cabeçalhos de segurança
    urls.py              inclui as rotas de cada app
  apps/
    common/       Base, EscopoWorkspace, WorkspaceViewSet, exceptions, pagination
    accounts/     Workspace, autenticação, seed, comandos de setup
    catalogo/     Classificação, Categoria, Estabelecimento
    contratos/    Contrato, ParcelaPrevista, projeção
    realizados/   Realizado
    fiscal/       NotaFiscal, itens, leitura de QR Code, SEFAZ, consolidação
    relatorios/   fluxo de caixa, aderência
    assistente/   assistente de IA sobre os dados financeiros

frontend/src/
  features/
    fluxo/        fluxo de caixa
    contratos/    entradas e saídas
    fiscal/       cupons fiscais e scanner
    assistente/   chat
  shared/
    ui/           primitivos (button, card, dialog, toast…)
    lib/          api, firebase, utils
```

O frontend espelha o backend de propósito. Ao mexer em contratos, os dois lados
da feature ficam em pastas de nome igual.

## Camadas dentro de um app

```
models.py       tabelas e invariantes de banco (constraints, índices)
services/       regra de negócio pura, sem HTTP e sem request
serializers.py  contrato de entrada e saída da API
views.py        HTTP: autenticação, filtro, paginação, códigos de status
urls.py         rotas do app
signals.py      efeitos automáticos
tests/          testes do domínio
```

A regra que sustenta isso: **serviço não conhece request**. `projetar()` recebe
datas e valores e devolve parcelas. Isso permite testar a regra sem banco nem
HTTP (os 31 testes de regra rodam em 0,08s) e reusar a mesma função na API, no
comando de importação e nas ferramentas do assistente.

## Isolamento por workspace

Toda tabela de negócio herda de `EscopoWorkspace`. Todo viewset herda de
`WorkspaceViewSet`, que filtra por workspace no `get_queryset` e o injeta no
`perform_create`.

O workspace **sempre** vem do usuário autenticado. O header `X-Workspace`
apenas escolhe entre os workspaces dos quais a pessoa já é membro — ele nunca
concede acesso:

```python
disponiveis = request.user.workspaces.all()   # o filtro parte daqui
return disponiveis.filter(id=escolhido).first()
```

Centralizar isso num único lugar é o ponto: repetir o filtro em cada viewset
seria repetir a chance de esquecê-lo.

## Fluxo dos dados

```
Cupom fiscal (QR)                  Planilha / cadastro manual
      │                                        │
      ▼                                        ▼
  NotaFiscal ──itens──┐                    Contrato
      │               │                        │
  soma por mês        │                    projeção (signal)
      ▼               │                        ▼
vw_mercado_consolidado│                  ParcelaPrevista
      │               │                        │
      └──► Realizado ◄┴────── mesma competência ┘
                │
                ▼
        Fluxo de caixa (previsto × realizado)
```

Meses passados usam o realizado; meses futuros usam o previsto. O saldo
acumulado atravessa os dois e responde a pergunta que interessa: em que mês o
dinheiro acaba.

## Assistente de IA

O modelo **não escreve SQL**. Ele escolhe entre ferramentas de leitura
declaradas em `apps/assistente/services/ferramentas.py`, e o `workspace` é
posicional, injetado pelo servidor — não aparece no schema que o modelo vê.

```
pergunta → Claude → pede ferramenta → executamos localmente (workspace fixo)
         → devolvemos o resultado → Claude → resposta em texto
```

Três razões para essa escolha:

1. **Isolamento.** Um SQL gerado pode esquecer o `WHERE workspace_id` e vazar
   dados financeiros entre famílias. Aqui não há como.
2. **Correção.** Competência é sempre dia 1; receita e despesa têm sinal
   derivado do tipo. Um SQL plausível pode somar receita com despesa e devolver
   um número que parece certo. As ferramentas reusam os mesmos serviços que
   alimentam as telas, então o assistente e o gráfico nunca discordam.
3. **Superfície de ataque.** Sem SQL gerado, prompt injection não vira
   `DROP TABLE` nem consulta a outro tenant.

O custo é rigidez: pergunta fora do conjunto de ferramentas não é respondida
com dado. Em finanças, preferimos "não sei responder isso ainda" a um número
errado com ar de autoridade.

Dois testes protegem essa propriedade e falham se alguém adicionar uma
ferramenta sem isolamento:

```python
assert parametros[0] == "workspace"          # posicional, vem do servidor
assert "workspace" not in ferramenta.parametros   # invisível para o modelo
```

## Como adicionar uma feature

1. `python manage.py startapp minha_feature apps/minha_feature`
2. `apps.py`: defina `name = "apps.minha_feature"` e `label`
3. Registre em `config/settings/base.py`, lista `APPS_PROJETO`
4. Modelos herdam de `EscopoWorkspace`; viewsets herdam de `WorkspaceViewSet`
5. Crie `urls.py` e inclua uma linha em `config/urls.py`
6. Regra de negócio em `services/`, testada sem banco quando possível
7. Se a feature gera dado que o assistente deveria consultar, adicione uma
   ferramenta em `apps/assistente/services/ferramentas.py`

## Decisões que valem conhecer

**UUID como chave primária.** Não vaza volume de dados nem colide entre
ambientes ao importar dumps.

**Valores sempre positivos.** O sinal vem do campo `tipo` (RECEITA/DESPESA).
A planilha original guardava receita como número negativo; misturar sinal com
natureza faz todo `SUM` precisar saber de qual conta está falando.

**Projeção materializada.** `ParcelaPrevista` é gravada, não calculada na hora.
Permite indexar por competência e cruzar com o realizado em SQL. É sempre
derivada do contrato, nunca editada à mão — o signal a regera a cada save.

**Consolidado é materialized view, não tabela.** O dado é 100% derivado das
notas; uma cópia gravável só criaria oportunidade de divergência. Em SQLite a
migration é no-op e o endpoint cai numa agregação via ORM equivalente.

**Paginação em módulo próprio.** O DRF resolve `DEFAULT_PAGINATION_CLASS` ao
importar `rest_framework.viewsets`. Se a classe morasse em `apps/common/api.py`
— que importa `viewsets` — teríamos import circular com mensagem enganosa.

## Armadilhas conhecidas

**`transaction.on_commit` não dispara em `TestCase`.** O teste inteiro roda numa
transação com rollback, então os signals nunca executam. Em teste, chame
`gerar_parcelas(contrato)` explicitamente ou use `captureOnCommitCallbacks`.
Sem isso, o teste valida o vazio e passa.

**Anotação exige `order_by` explícito.** `annotate(Count(...))` monta um
`GROUP BY` sem ordem garantida, e a paginação passa a devolver resultados
inconsistentes entre páginas.

**Raspagem da SEFAZ é frágil por natureza.** O HTML bruto fica em
`NotaFiscal.payload` para reprocessar sem reconsultar; falha grava a nota com
status `ERRO` e os dados extraídos da chave; os seletores CSS estão isolados no
topo de `sefaz_ba.py`.

## PWA e uso offline

O frontend é um PWA instalável. Não há app Expo — o único caso de uso
verdadeiramente mobile é ler o cupom no mercado, e para isso a câmera do
navegador basta.

### O que funciona sem conexão

| | Offline |
|---|---|
| Abrir o app | sim (precache do app inteiro) |
| Ler cupom pelo QR | sim, entra na fila |
| Ver fluxo, contratos, notas | não — erro claro na tela |
| Assistente | não |

**A API não é cacheada, de propósito.** Saldo e projeção desatualizados são
piores que ausentes: a pessoa tomaria decisão financeira com número velho sem
perceber. Offline, as telas de dados mostram erro; só o scanner segue
funcionando.

### A fila de cupons

O cenário concreto: corredor de supermercado, sinal fraco. A pessoa lê o QR, a
requisição não sai, e o papel vai para o lixo na saída da loja.

```
leitura → chave validada localmente (módulo 11) → fila no localStorage
        → conexão volta → envio sequencial → nota cadastrada
```

Três propriedades sustentam isso:

1. **O endpoint é idempotente pela chave de acesso.** Reenviar o mesmo cupom
   devolve a nota existente em vez de duplicar despesa. É o que torna seguro
   reprocessar a fila, inclusive se o app fechar no meio do envio.
2. **A chave é validada antes de entrar na fila.** Leitura corrompida falha na
   hora, com a pessoa ainda segurando o cupom — não três horas depois em casa.
3. **Falha de rede é distinguida de erro do servidor.** `ApiError.offline`
   (status 0) enfileira; 4xx e 5xx mostram o erro, porque reenviar não
   resolveria.

Depois de cinco tentativas a entrada é descartada: insistir para sempre numa
chave que a SEFAZ rejeita só faria a fila crescer sem fim.

**localStorage, não IndexedDB.** A escolha "correta" seria IndexedDB com
Background Sync, deixando o service worker esvaziar a fila sozinho. Mas o
Safari do iOS não implementa Background Sync, e boa parte das leituras vai
acontecer em iPhone. Como a fila precisa ser drenada pelo app de qualquer
forma, localStorage resolve: entradas são strings curtas e a escrita é
síncrona.

### Instalação e HTTPS

A câmera exige contexto seguro. `localhost` conta; o IP da rede local, não.
Para testar no celular durante o desenvolvimento, use um túnel:

```bash
npx localtunnel --port 5173
```

Em produção, com HTTPS, o navegador oferece "Adicionar à tela de início".
No iOS é manual: Compartilhar → Adicionar à Tela de Início.

O atalho longo no ícone abre direto o scanner (`/notas?scan=1`).

### Atualizações

`registerType: "prompt"`: uma versão nova não recarrega a página sozinha. A
barra de status avisa e a pessoa decide quando atualizar — recarregar no meio
de um cadastro perderia o que ela estava digitando.
