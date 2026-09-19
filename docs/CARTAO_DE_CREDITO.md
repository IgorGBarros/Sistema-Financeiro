# Cartão de crédito, faturas e estabelecimentos

Proposta de regra de negócio. Ainda não implementada — falta ver o formato que
a sua automação de leitura de PDF produz.

---

## 1. O problema da dupla contagem

É a decisão que define todo o resto.

Uma compra no cartão gera **dois eventos** em momentos diferentes:

```
15/03  compra de R$ 300 em 3x no supermercado
10/04  fatura de R$ 1.850 vence, e R$ 100 dela é a 1ª parcela dessa compra
10/05  R$ 100 (2ª parcela)
10/06  R$ 100 (3ª parcela)
```

Se o sistema registrar a compra **e** o pagamento da fatura como despesa, o
mesmo dinheiro sai duas vezes e o fluxo de caixa fica errado por milhares de
reais. É o erro mais comum em controle financeiro pessoal.

Três formas de resolver:

**A. Regime de competência.** A despesa é reconhecida em 15/03, valor cheio.
A fatura é uma transferência entre contas, não despesa. Contabilmente correto,
mas responde mal à pergunta que importa aqui: *quanto sai da minha conta em
abril?*

**B. Regime de caixa puro.** Só a fatura é despesa, R$ 1.850 em 10/04.
Simples, mas perde a categoria: você sabe que gastou, não em quê.

**C. Parcela como despesa, no mês da fatura.** ← recomendada

A despesa é reconhecida parcela a parcela, na competência da fatura em que cada
uma cai. A soma das parcelas de um mês **é** o valor da fatura — então a fatura
não precisa existir como lançamento próprio, só como conferência.

Por que esta:

- não há dupla contagem, por construção
- a categoria se preserva (cada parcela herda a da compra)
- o fluxo de caixa mostra o desembolso no mês certo
- é consistente com a decisão que já tomamos no consolidado do mercado: o
  agregado é derivado do detalhe, não uma segunda fonte de verdade

O custo: uma compra parcelada aparece diluída, e não no mês em que você a fez.
Resolve-se mostrando "compra de 15/03, parcela 2 de 3" na descrição.

---

## 2. Modelos

### Cartão

```python
class Cartao(EscopoWorkspace):
    apelido = CharField(80)                  # "Nubank roxinho"
    bandeira = CharField(choices=BANDEIRAS)  # VISA, MASTERCARD, ELO...
    ultimos_digitos = CharField(4)
    emissor = CharField(80, blank=True)      # banco
    limite = DecimalField(null=True)

    # Definem em qual fatura cada compra cai. Compra feita depois do
    # fechamento vai para a fatura seguinte — é a regra que mais gera
    # "achei que ia cair esse mês".
    dia_fechamento = PositiveSmallIntegerField()   # 1-31
    dia_vencimento = PositiveSmallIntegerField()

    # Cartão adicional aponta para o titular: as compras entram na mesma
    # fatura, mas dá para saber quem gastou.
    cartao_titular = ForeignKey("self", null=True, related_name="adicionais")
    ativo = BooleanField(default=True)
```

Sobre `dia_fechamento` e `dia_vencimento`: alguns emissores mudam a data quando
cai em fim de semana. A regra fica num serviço
(`apps/cartoes/services/ciclo.py`), não espalhada pela interface:

```python
def fatura_da_compra(cartao, data_compra: date) -> date:
    """Competência da fatura em que a compra vai cair."""
    if data_compra.day <= cartao.dia_fechamento:
        return data_compra.replace(day=1)
    return proximo_mes(data_compra.replace(day=1))
```

### Compra e suas parcelas

```python
class Compra(EscopoWorkspace):
    """Uma compra no cartão. Pode ou não ter nota fiscal vinculada."""
    nota = ForeignKey("fiscal.NotaFiscal", null=True, related_name="compras")
    cartao = ForeignKey(Cartao)
    estabelecimento = ForeignKey("catalogo.Estabelecimento")
    categoria = ForeignKey("catalogo.Categoria")
    descricao = CharField(200)
    data_compra = DateField()
    valor_total = DecimalField()
    parcelas_total = PositiveSmallIntegerField(default=1)


class ParcelaCompra(Base):
    """
    Previsão de desembolso. Mesmo papel de ParcelaPrevista para contratos:
    derivada da compra, regerada por signal, nunca editada à mão.
    """
    compra = ForeignKey(Compra, related_name="parcelas")
    numero = PositiveSmallIntegerField()          # 1..parcelas_total
    competencia = DateField()                     # mês da fatura
    valor = DecimalField()
    # Preenchido quando a fatura chega e a linha bate.
    conciliada_em = DateTimeField(null=True)
```

Divisão do valor: `valor_total / parcelas_total` arredondado, com a diferença
de centavos indo para a **primeira** parcela — é o que a maioria dos emissores
faz. R$ 100,00 em 3x vira 33,34 + 33,33 + 33,33.

### Pagamento da nota

A NFC-e admite pagamento dividido (parte no cartão, parte em dinheiro), então
a forma de pagamento é uma tabela, não um campo:

```python
class PagamentoNota(Base):
    nota = ForeignKey("fiscal.NotaFiscal", related_name="pagamentos")
    forma = CharField(choices=FORMAS)   # tPag da NFC-e
    valor = DecimalField()

    # Só quando forma é cartão de crédito
    cartao = ForeignKey(Cartao, null=True)
    parcelas = PositiveSmallIntegerField(default=1)
    bandeira = CharField(20, blank=True)   # tBand, quando o portal traz
    autorizacao = CharField(20, blank=True)  # cAut, ajuda na conciliação
```

`forma`, `bandeira` e `autorizacao` saem da nota. **`cartao` e `parcelas` são
perguntados ao usuário** — não existem no cupom.

### Fatura

```python
class Fatura(EscopoWorkspace):
    cartao = ForeignKey(Cartao, related_name="faturas")
    competencia = DateField()             # dia 1
    data_fechamento = DateField()
    data_vencimento = DateField()
    valor_total_informado = DecimalField()  # o que o PDF diz
    arquivo_hash = CharField(64)            # sha256, torna a importação idempotente
    status = CharField(choices=["ABERTA", "FECHADA", "PAGA"])


class LancamentoFatura(Base):
    """Uma linha do PDF, como veio."""
    fatura = ForeignKey(Fatura, related_name="lancamentos")
    descricao_original = CharField(200)    # "REDEMIX SUPERM 03/12"
    data_compra = DateField()
    valor = DecimalField()
    parcela_atual = PositiveSmallIntegerField(null=True)
    parcela_total = PositiveSmallIntegerField(null=True)

    # Resultado da conciliação
    parcela_compra = OneToOneField(ParcelaCompra, null=True)
    estabelecimento = ForeignKey("catalogo.Estabelecimento", null=True)
    categoria = ForeignKey("catalogo.Categoria", null=True)
```

`arquivo_hash` faz a importação do mesmo PDF duas vezes ser inofensiva — mesma
lógica da chave de acesso no scan de cupom.

**A `Fatura` não gera despesa.** Ela é conferência: `valor_total_informado`
comparado com a soma das parcelas daquela competência. Divergiu, algo escapou
da conciliação e o sistema avisa.

---

## 3. Fluxo completo

```
   scan do cupom                    importação do PDF da fatura
        │                                        │
        ▼                                        ▼
   NotaFiscal ──── PagamentoNota            LancamentoFatura
        │            (forma, cartão,              │
        │             parcelas)                   │
        ▼                                         │
     Compra ──── ParcelaCompra ◄──── conciliação ─┘
                  (previsão)              │
                                          ▼
                                      Realizado
                                   (origem=CARTAO)
                                          │
                                          ▼
                                   Fluxo de caixa
```

O par previsão/realizado se repete: `ParcelaCompra` está para a fatura assim
como `ParcelaPrevista` está para o contrato. A mesma tela de aderência
previsto × realizado passa a funcionar para o cartão sem mudança.

---

## 4. Conciliação: casar linha do PDF com parcela prevista

Em ordem, parando no primeiro acerto:

**1. Autorização.** Se o PDF traz o código de autorização e o
`PagamentoNota.autorizacao` bate, é certeza. Nem todo emissor traz.

**2. Valor + parcela + janela de data.** Mesmo valor, mesmo `parcela_atual/total`,
data da compra dentro de ±3 dias. Cobre a maioria.

**3. Valor + estabelecimento.** Usando o apelido (seção 5) para resolver
"REDEMIX SUPERM" → Redemix Supermercados.

**4. Sem correspondência.** Duas situações opostas, e ambas precisam aparecer:

| Situação | Significado | O que fazer |
|---|---|---|
| Linha no PDF sem parcela prevista | Compra sem cupom escaneado | Criar `Realizado` direto, pedir categoria |
| Parcela prevista sem linha no PDF | Estorno, ou compra que não entrou nesta fatura | Marcar para revisão, não apagar |

Conciliação automática nunca deve ser silenciosa. A tela mostra as linhas
casadas em cinza e as duvidosas em destaque — o trabalho da pessoa é olhar as
duvidosas, não conferir as óbvias.

---

## 5. Estabelecimentos: identificar pelo CNPJ

O modelo `Estabelecimento` já existe. Precisa de três coisas.

### Criação automática no scan

A chave de acesso já entrega o CNPJ **sem chamada de rede** (posições 6 a 19).
Então o estabelecimento nasce mesmo com a SEFAZ fora do ar:

```python
def obter_ou_criar(workspace, cnpj, nome=None, municipio=None):
    estabelecimento, criado = Estabelecimento.objects.get_or_create(
        workspace=workspace,
        cnpj=cnpj,
        defaults={
            "nome": nome or f"CNPJ {formatar_cnpj(cnpj)}",
            "cnpj_raiz": cnpj[:8],
            "municipio": municipio or "",
        },
    )
    # O nome real chega depois, quando a SEFAZ responder.
    if criado is False and nome and estabelecimento.nome.startswith("CNPJ "):
        estabelecimento.nome = nome
        estabelecimento.save(update_fields=["nome"])
    return estabelecimento
```

### Raiz do CNPJ agrupa filiais

Os 8 primeiros dígitos identificam a empresa; os 4 seguintes, a filial. Seu
cupom é da Redemix filial **0015** — a rede tem dezenas de lojas, cada uma com
CNPJ diferente.

Sem agrupar, "quanto gastei na Redemix este ano" não responde nada. Com
`cnpj_raiz` indexado, responde.

```python
class Estabelecimento(EscopoWorkspace):
    cnpj = CharField(14)              # único por workspace
    cnpj_raiz = CharField(8, db_index=True)
    nome = CharField(160)             # razão social ou nome fantasia
    apelido = CharField(80, blank=True)  # como a pessoa chama
    municipio = CharField(120, blank=True)
    uf = CharField(2, blank=True)
    categoria_padrao = ForeignKey("Categoria", null=True)
```

`categoria_padrao` é o que faz o sistema ficar menos trabalhoso com o tempo:
na terceira compra na farmácia, a categoria já vem preenchida.

### Apelidos para casar com a fatura

O PDF da fatura não traz CNPJ. Traz `"REDEMIX SUPERM 03/12"` ou
`"PAG*Redemix"`. Uma tabela de apelidos resolve, e aprende:

```python
class ApelidoEstabelecimento(Base):
    estabelecimento = ForeignKey(Estabelecimento, related_name="apelidos")
    texto = CharField(120, db_index=True)   # normalizado: caixa alta, sem acento
    origem = CharField(choices=["MANUAL", "CONCILIACAO", "SUGERIDO"])
```

Quando a pessoa concilia uma linha na mão, o texto vira apelido. Da próxima
vez, casa sozinho. É o tipo de aprendizado que não precisa de modelo nenhum —
só de guardar o que a pessoa já ensinou.

---

## 6. O que muda no scan

Hoje o scan é um passo. Passa a ser dois, e só quando for cartão de crédito:

```
lê o QR → consulta a SEFAZ → mostra emitente, valor e forma de pagamento
        → se a forma for crédito: "qual cartão?" + "quantas parcelas?"
        → grava Nota + PagamentoNota + Compra + ParcelaCompra
```

Duas decisões de interface que valem defender:

**Perguntar depois, não antes.** A pessoa está no caixa ou saindo da loja. Ler
o QR tem que ser instantâneo. As perguntas aparecem na tela de confirmação, e
o cupom já está salvo antes disso.

**Poder adiar.** Se não responder, a nota fica com pagamento indefinido e
aparece numa lista de pendências. Melhor que travar a leitura — e offline não
há como consultar a lista de cartões mesmo.

O padrão pode vir do estabelecimento: se as últimas cinco compras na Redemix
foram no mesmo cartão à vista, sugere isso já preenchido.

---

## 7. Perguntas em aberto

Para fechar o desenho, preciso saber:

1. **Formato da sua automação.** Que campos ela extrai? Traz `parcela_atual/total`
   separados ou embutidos na descrição? Tem código de autorização? Isso define
   se a conciliação por autorização (o passo mais confiável) é viável.

2. **Compra à vista no crédito.** Conta como parcela única na fatura do mês, ou
   você quer tratar diferente?

3. **Fatura paga parcialmente ou rotativo.** Acontece? Se sim, o desenho
   precisa de um lançamento de juros e o saldo rolando para a fatura seguinte —
   é o caso que mais complica, melhor saber agora.

4. **Cartão de débito e PIX** entram na mesma estrutura? Eles não têm fatura,
   então viram `Realizado` direto na data da compra. Mais simples, mas o
   `PagamentoNota` já cobre.
