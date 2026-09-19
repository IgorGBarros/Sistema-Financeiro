# Auditoria de código

Varredura feita com ferramentas rodando sobre o código, não por leitura: linter
(`ruff`), `manage.py check --deploy`, contagem de consultas por endpoint com
`CaptureQueriesContext` e análise do bundle de produção.

Os itens marcados **corrigido** já estão no código. Os demais estão listados com
o motivo de não terem sido feitos agora.

---

## Corrigidos

### 1. Data errada em fuso — grave

`date.today()` devolve a data do relógio do servidor. Em produção o servidor
roda em UTC e Salvador está três horas atrás, então das 21h à meia-noite o
servidor já está no dia seguinte.

Cenário concreto, medido:

```
Momento real em Salvador: 31/03/2026 22:00 -03
Mesmo instante em UTC:    01/04/2026 01:00 UTC

  date.today() num servidor UTC:  2026-04-01   <- ABRIL
  timezone.localdate():           2026-03-31   <- MARÇO
```

Um cupom escaneado às 22h do dia 31 entraria na competência de abril. Com a
regra de fechamento do cartão em cima disso, a parcela iria para a fatura
errada e a conciliação nunca casaria.

Corrigido em 15 pontos, com o helper `apps/common/datas.hoje_local()`.
Nenhum `date.today()` restou fora dos testes.

### 2. Consultas por linha no financiamento

`FinanciamentoSerializer` fazia seis consultas por financiamento, e
`get_total_a_pagar` carregava as 246 parcelas em aberto na memória só para
somá-las.

```
antes:  11 queries, e crescendo com o número de contratos
depois:  7 queries, número fixo
```

As somas viraram anotações no queryset e os dois campos que precisavam de uma
linha específica viraram `Prefetch` com slice. O total continua exato:
R$ 371.481,98 a pagar, dos quais R$ 141.963,89 são juros.

### 3. Senha de PDF guardada em texto claro — segurança

`Cartao.senha_pdf` e `UnidadeConsumidora.senha_pdf` guardavam a senha da fatura
em claro no banco.

**Os campos foram removidos.** Criptografar não resolveria: a chave moraria no
mesmo servidor. E essas senhas costumam derivar de CPF ou data de nascimento,
então valem mais que o próprio PDF. A senha passa a ser digitada a cada
importação.

### 4. Fontes com subconjuntos inúteis no precache

O import padrão do `@fontsource` trazia cirílico, grego e vietnamita: 33
arquivos, 504 KB. Num app em português, mais de dois terços nunca seriam
usados — e como tudo entra no precache do service worker, esse peso atrasava
justamente a primeira abertura offline.

```
antes:  33 arquivos, 504 KB   precache 1790 KB
depois:  7 arquivos, 208 KB   precache 1522 KB
```

### 5. Achados do linter

| Achado | Onde | Correção |
|---|---|---|
| `B023` closure sobre variável de loop | `importar_planilha.py` | `linha` como argumento padrão |
| `S112` exceção silenciada sem log | `documentos/services/base.py` | passou a registrar no log |
| `F401`/`F811` imports mortos e redefinição | 11 arquivos | removidos |

O `B023` não estava causando erro — a função é chamada na mesma iteração. Mas
bastaria alguém guardá-la numa lista para todas as chamadas apontarem para a
última linha da planilha.

### 6. Cobertura de testes das visões matriciais

Oito apps estavam sem teste nenhum. O mais crítico era `relatorios`, que tem
a regra de sinal e o conceito de "comprometido" — os dois fáceis de inverter
numa refatoração sem ninguém perceber. **15 testes** adicionados, incluindo
isolamento entre workspaces.

---

## Pendentes, com justificativa

### Cobertura ainda incompleta

Sem testes: `accounts`, `catalogo`, `common`, `contas`, `folha`, `realizados`.
Os três primeiros são majoritariamente configuração; `contas` e `folha`
dependem de extratores ainda não validados contra PDF real, e testar o
processamento antes de saber o formato de entrada seria testar a suposição.

**Prioridade quando houver PDF real:** `contas` (cria `Realizado`, então erro
ali entra no fluxo de caixa) e `catalogo` (a lógica de `cnpj_raiz` e apelidos,
que alimenta a conciliação).

### `NotaFiscal.payload` guarda até 500 KB de HTML por nota

Com 40 cupons por mês, são 20 MB por mês no banco. No Supabase, o plano
gratuito tem 500 MB.

Não mexi porque o HTML bruto é justamente o que permite reprocessar sem
reconsultar a SEFAZ, e a raspagem é frágil. A saída seria guardar o HTML só
quando o parsing falha, e descartá-lo depois de N importações bem-sucedidas
com o mesmo layout. Precisa de decisão sua sobre o prazo de retenção.

### `graficos` é o maior chunk do bundle (546 KB)

O Recharts sozinho pesa mais que todo o resto do app. Alternativas: carregar
sob demanda como já é feito com o scanner, ou trocar por uma biblioteca menor.

Não mexi porque o gráfico está na tela inicial — carregar sob demanda ali só
trocaria o custo de lugar. Vale reavaliar se o fluxo de caixa deixar de ser a
primeira tela.

### `--deploy` acusa 6 avisos de segurança em `dev`

Todos são de configuração de produção — HSTS, SSL redirect, cookies seguros,
`SECRET_KEY`. **Já estão corretos em `config/settings/prod.py`**; o aviso
aparece porque rodei o check com o settings de desenvolvimento.

Vale rodar antes de subir:

```bash
DJANGO_SETTINGS_MODULE=config.settings.prod python manage.py check --deploy
```

### Viewsets sem `select_related`

`Cartao`, `Classificacao`, `Estabelecimento` e `UnidadeConsumidora` fazem
`objects.all()` sem join. Nenhum deles tem campo de relação no serializer
hoje, então não há N+1 real — mas basta alguém acrescentar
`categoria_padrao.nome` no serializer de `Estabelecimento` para virar uma
consulta por linha.

### Frontend sem testes de componente

Só a fila offline tem teste (12 casos). A `TabelaMatriz` tem lógica própria
(colunas fixas, zero virando travessão, coloração por sinal) que merece
cobertura. Não fiz agora porque exigiria `@testing-library/react`, que ainda
não é dependência.

---

---

## Rodada 2 — lacunas de interface

Levantadas cruzando rotas, links e endpoints. Todas corrigidas.

| Lacuna | Situação |
|---|---|
| `/cartoes/novo` e `/contratos/novo` — links para rotas inexistentes | corrigidos: modal e link para a lista |
| Sem formulário de cartão (só pelo admin) | `FormularioCartao`, com explicação da regra de corte |
| Conciliação de fatura invisível | tela `/faturas/:id`, pendências em destaque |
| Financiamento sem tela | `/financiamento`, com composição da parcela |
| Holerite sem tela | `/folha`, verba a verba |
| Contas de consumo sem tela | `/contas`, separa consumo de tarifa |
| Fluxo e Assistente no visual antigo | portados para os tokens novos |

Cobertura de recursos da API com tela: **17 de 20**.

Os três restantes são propositais: `compras` e `unidades-consumidoras` são
editados de dentro de outras telas, e `resumo-classificacao` está coberto pela
matriz de contratos agrupada por classificação — o endpoint ficou redundante e
é candidato a remoção.

---

## Rodada 3 — o ciclo do scan estava aberto

A varredura de rotas contra o consumo no frontend revelou 21 órfãs, mas o
achado sério não era de rota: **o scan lia o cupom e parava ali.**

O fluxo documentado em `docs/REGRA_DE_NEGOCIO.md` §2 — scan pergunta forma de
pagamento, gera Compra no crédito ou Realizado à vista — existia só no
documento. No código, a nota era salva e nada mais acontecia. O banco tinha
280 parcelas previstas e **zero realizados**, e por consequência confronto,
aderência e previsão estatística ficavam todos vazios.

### Implementado

| Lacuna | O que entrou |
|---|---|
| Scan não registrava pagamento | `apps/fiscal/services/pagamento.py` + diálogo de confirmação |
| Sem tela para baixar parcela | `/lancamentos` — a origem dos dados de realizado |
| Classificação cadastrável só no banco | `/plano-de-contas`, três abas |
| Importação escondida em Cartões | `/documentos`, com reprocessamento |
| Compras do cartão invisíveis | lista em Cartões, com parcelamento |
| Unidades consumidoras invisíveis | seção em Contas, marcando as sem contrato |
| `/resumo-classificacao/` redundante | rota removida; o serviço segue no assistente |

### Duas decisões de projeto

**Perguntar a forma de pagamento depois, não antes.** A pessoa está no caixa;
ler o QR precisa ser instantâneo. A nota já está salva quando o diálogo abre, e
fechar sem responder deixa o cupom numa fila visível — melhor que travar a
leitura, ainda mais porque offline não há como listar cartões.

**Registrar pagamento é idempotente.** Corrigir "paguei no débito, não no
crédito" apaga as parcelas do crédito antes de criar o realizado. Sem isso a
correção somaria as duas versões e a despesa apareceria dobrada.

### Cobertura final

**53 de 63 rotas** consumidas. As 10 restantes:

- `auth/token/`, `saude/` — infraestrutura, não UI
- `notas/{id}/pagamento/` — falso negativo do detector; é consumida
- detalhes (`compras/{id}/`, `holerites/{id}/`…) — as listas já trazem o
  aninhado
- `contratos/{id}/parcelas/` — redundante com `/parcelas/?contrato=`
- `assistente/{id}/` — histórico de conversas, ainda sem tela

## O que a auditoria não cobriu

- **Carga.** Nenhum teste com volume: 5 anos de cupons, 10 cartões, 3
  financiamentos. As consultas agregadas devem aguentar, mas isso é previsão,
  não medida.
- **Acessibilidade.** Não rodei axe nem leitor de tela. Os botões só com ícone
  têm `sr-only`, mas contraste e navegação por teclado não foram verificados.
- **Segurança de dependências.** `npm audit` e `pip-audit` não foram
  executados; valem uma passada antes do primeiro deploy.
