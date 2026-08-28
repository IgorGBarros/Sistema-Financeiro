# Sistema financeiro — leitura de NFC-e, contratos previstos e realizados

Implementação da regra de negócio descrita, com a lógica de projeção portada do
DAX/TMDL do Power BI para Python.

---

## 1. Modelo de dados

```
Classificacao ──┐            (Essenciais / Bons / Ruins / Custos Operacionais,
   (cadastrável) │             cadastrável pelo usuário)
                 ▼
             Categoria ──────────────┐
                 │                   │
                 ▼                   ▼
   ┌──────── Contrato ────────┐   NotaFiscal ── ItemNotaFiscal
   │   (Tabela Entrada e      │   (Tabela Mercado)
   │    Saída = previstos)    │        │
   │                          │        │ soma por mês
   ▼                          │        ▼
ParcelaPrevista ◄─────────────┘   vw_mercado_consolidado
   (projeção mês a mês)                │  (materialized view)
        │                              │
        │  mesma competência           │ 1 linha por mês
        └──────────► Realizado ◄───────┘
                  (o que foi pago de fato)
```

### Por que a Tabela Consolidado não virou tabela

Você suspeitou certo. O consolidado é 100% derivado das notas — se virasse
tabela gravável, criaria uma segunda versão da verdade que pode divergir. Ele é
uma **materialized view** (`vw_mercado_consolidado`), lida pelo ORM como model
`managed = False`. Você consulta como tabela, mas não tem como ela sair do ar
com o detalhe.

O que **precisa** existir como linha real é o `Realizado` de origem `MERCADO`:
um lançamento por mês que representa o mercado dentro do fluxo de caixa. É
assim que a Tabela Mercado entra na Tabela Entrada e Saída — 40 cupons viram um
lançamento de "Alimentação" na competência, com o detalhe preservado nas notas.

### Duas normalizações em relação à planilha

**Sinal.** Na planilha, receita é negativa (`-5543` de salário) e despesa é
positiva. No banco o valor é sempre positivo e o sinal vem do campo `tipo`.
Misturar sinal com natureza faz todo `SUM` precisar saber de qual conta está
falando — e é como um `ABS()` esquecido vira erro de milhares de reais.

**A coluna "Tipo de Contrato" (M/A) é frequência, não tipo.** Virou
`frequencia`, agora com M/B/T/S/A/U. O que a planilha chamava de "Categoria"
(Receita/Despesa) virou `tipo`; "Classificação" virou `categoria`; e a
classificação de verdade (Essencial/Bom/Ruim/Operacional) é uma tabela própria.

---

## 2. A projeção — porte do DAX

`core/services/projecao.py` reproduz a tabela calculada
`Contrato_Guarda-Chuva Futuros`. Duas armadilhas do DAX foram preservadas de
propósito:

**`DATEDIFF(..., MONTH)` conta fronteiras de mês, não meses completos.**
De 31/01 para 01/02 o DAX responde 1 mês, com um dia de diferença. Quem
reimplementa com `dias / 30` erra. Note que a coluna `Parcela` da planilha
(23,3 para um contrato de 24 meses) é exatamente esse erro: são dias÷30, não
parcelas. O sistema usa a contagem do DAX.

**O `+ IF(DAY(fim) >= DAY(inicio), 1, 0)`** inclui o mês final. Efeito
colateral desejado: contrato com início igual ao fim (13º salário, restituição
de IR) gera 1 parcela em vez de 0.

Conferência contra os contratos da sua planilha:

| Contrato | Vigência | Parcelas | Última |
|---|---|---|---|
| Salário MXPLan | 06/01/26 → 06/12/27 | 24 | 06/12/27 |
| Colégio Omega | 10/01/26 → 10/12/26 | 12 | 10/12/26 |
| Ultragaz | 15/01/26 → 10/12/27 | 23 | 15/11/27 |
| 13º Salário | 20/11/26 → 20/11/26 | 1 | 20/11/26 |

O Ultragaz dá 23 e não 24 porque o dia final (10) é menor que o inicial (15) —
comportamento idêntico ao do seu modelo no Power BI.

Duas coisas foram além do DAX: **frequência** (anual avança 12 meses, não 1) e
**reajuste anual em %**, aplicado no aniversário do contrato.

A projeção é materializada em `ParcelaPrevista` e regerada por signal sempre que
o contrato muda. Ela nunca é editada à mão — é sempre derivada do contrato, o
que elimina a classe de bug em que o contrato diz uma coisa e a projeção diz
outra.

---

## 3. Leitura da nota fiscal

O QR do seu cupom (Redemix, 28/08/2026) decodifica para:

```
http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p=
  29260806337087001579650110002303451225761309|2|1|1|E7977D66…C1E4
   └────────────── chave (44) ───────────────┘ │ │ │ └ hash SHA-1
                                        versão ┘ │ └ cIdToken
                                          ambiente┘
```

E a chave sozinha já entrega, **sem nenhuma chamada de rede**:

| Campo | Valor |
|---|---|
| UF | 29 → BA |
| Competência | 2608 → agosto/2026 |
| CNPJ | 06.337.087/0015-79 |
| Modelo / série / número | 65 (NFC-e) / 011 / 230345 |
| Dígito verificador | confere (módulo 11) |

Isso importa para a experiência: mesmo sem internet ou com a SEFAZ fora do ar,
o cupom é cadastrado com emitente, data e número. Os itens entram depois pelo
`/reconsultar`.

### O fluxo do scan

```
câmera (html5-qrcode) → texto do QR → POST /api/notas/scan/
     → backend valida a chave → GET no portal da SEFAZ → parseia o DANFE
     → grava NotaFiscal + itens → recalcula o Realizado do mês
```

A consulta **precisa** sair do backend. O portal da SEFAZ não envia cabeçalhos
CORS, então o navegador não consegue ler a resposta de jeito nenhum — não é uma
escolha de arquitetura, é uma restrição.

O endpoint é idempotente pela chave: reescanear o mesmo cupom devolve 200 com a
nota existente em vez de duplicar despesa.

### Ressalva honesta sobre a raspagem

O `sefaz_ba.py` raspa HTML de portal estadual. Isso é frágil por natureza: o
layout muda sem aviso e o portal aplica limite por IP. As defesas embutidas:

- o HTML bruto fica em `NotaFiscal.payload`, então dá para reprocessar o
  histórico sem reconsultar a SEFAZ quando o parser quebrar;
- falha nunca perde a nota — ela grava com status `ERRO` e os dados da chave;
- os seletores CSS estão isolados no topo do arquivo, para conserto rápido;
- throttle de 60 scans/hora por usuário, para não queimar o IP do servidor.

**Não consegui testar contra a SEFAZ real** — o ambiente onde escrevi isso não
tem acesso à rede externa. O parser foi escrito para o layout padrão do portal
"Consulta NFC-e" (`#tabResult`, `.txtTit`, `.Rqtd`, `.RvlUnit`), que a Bahia
usa. Rode um scan real antes de subir e ajuste `SELETORES` se algum campo vier
vazio — o HTML salvo em `payload` serve exatamente para esse ajuste.

Se em algum momento você tiver CNPJ com certificado A1, a rota definitiva é o
webservice `NFeDistribuicaoDFe`, que devolve o XML assinado. Para pessoa
física, a raspagem é o caminho viável.

O `NFCEC_consulta_danfe.aspx` que você mandou é a página de digitação manual —
tem captcha e ViewState do ASP.NET, então serve só como link para o usuário
abrir no navegador, não para automação.

---

## 4. Endpoints

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/notas/scan/` | Cadastra a nota a partir do QR |
| `POST` | `/api/notas/{id}/reconsultar/` | Retenta uma nota com erro |
| `GET` | `/api/notas/consolidado/` | Tabela Consolidado por mês |
| `GET` | `/api/notas/mes-corrente/` | Total do mercado em tempo real |
| `GET/POST` | `/api/contratos/` | Tabela Entrada e Saída |
| `POST` | `/api/contratos/simular/` | Projeta as parcelas **sem gravar** |
| `GET` | `/api/contratos/{id}/parcelas/` | Projeção materializada |
| `POST` | `/api/contratos/{id}/rescindir/` | Rescinde e recorta a projeção |
| `POST` | `/api/realizados/baixar-parcela/` | Marca uma parcela como paga |
| `GET` | `/api/fluxo-caixa/` | Série mensal previsto × realizado |
| `GET` | `/api/aderencia/` | Previsto × realizado contrato a contrato |
| `GET` | `/api/resumo-classificacao/` | Peso de cada classificação |

O `/fluxo-caixa/` é onde previsto e realizado se encontram: meses passados usam
o realizado, meses futuros usam o previsto. O saldo acumulado atravessa os dois
e responde a pergunta que interessa — em que mês o dinheiro acaba.

---

## 5. Como rodar

Passo a passo completo em **COMECE_AQUI.md**. Resumo:

```bash
# Backend
cd backend
pip install -r requirements.txt
python manage.py migrate                    # inclui as materialized views
python manage.py importar_planilha \
    --arquivo "Entrada e Saida - Receita e Despesas.xlsx" \
    --workspace <uuid> --dry-run            # confira antes de gravar
python manage.py runserver

# Testes das regras (31 casos, sem precisar de banco)
pytest core/tests/test_regras.py

# Cron a cada 15 min
python manage.py refresh_consolidado

# Frontend
cd frontend && npm install && npm run dev
```

A leitura por câmera exige **HTTPS** — `getUserMedia` só funciona em contexto
seguro. Em desenvolvimento, `localhost` conta como seguro; na rede local pelo
celular, não. Use um túnel (ngrok, Cloudflare Tunnel) para testar no aparelho.

---

## 6. O que ficou de fora

- **Migration inicial** (`0001_initial`): gere com `makemigrations`, já que ela
  depende do seu `AUTH_USER_MODEL`.
- **Integração com o Asaas**: os modelos não têm campo de cobrança. Quando
  entrar, o lugar natural é uma tabela `Cobranca` ligada a `Realizado`, com o
  webhook criando o realizado na confirmação do pagamento.
- **Classificação automática dos itens do cupom** (padaria, laticínios,
  limpeza). A `vw_mercado_produtos` já agrupa por código de barras e prepara o
  terreno: com o histórico, dá para sugerir categoria por produto recorrente.
- **Telas de cadastro de contrato e de conciliação**: só o fluxo de caixa e o
  scanner foram escritos, por serem os que carregam regra de negócio.
#   S i s t e m a - F i n a n c e i r o  
 