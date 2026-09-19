# Regra de negócio — revisão com importação de documentos

Este documento revisa a lógica do sistema depois da entrada de quatro novas
fontes de dado: fatura de cartão, conta de consumo, financiamento imobiliário
e holerite.

---

## 1. O princípio que organiza tudo

Toda despesa entra no fluxo de caixa **uma única vez**, na competência em que
o dinheiro sai. Parece óbvio, mas cada fonte nova cria uma forma diferente de
violar isso — e a violação nunca dá erro, só devolve um número errado com cara
de certo.

Os quatro riscos, e como cada um foi tratado:

| Fonte | Como duplicaria | Tratamento |
|---|---|---|
| Cartão | compra **e** pagamento da fatura | a parcela é a despesa; a fatura é só conferência |
| Financiamento | contrato de valor fixo **e** parcelas do DDC | detecção automática de duplicidade |
| Conta de luz | contrato previsto **e** conta importada | a conta vira o realizado do mesmo contrato |
| Holerite | contrato de salário **e** líquido do recibo | folha isolada até a divergência ser resolvida |

---

## 2. Cartão de crédito

### A decisão

A despesa é reconhecida **parcela a parcela, na competência da fatura em que
cada uma cai**. A soma das parcelas de um mês *é* a fatura daquele mês.

Compra de R$ 300 em 3x no dia 10/03, cartão que fecha dia 25:

```
competência   parcela   entra no fluxo como
2026-03       1/3       R$ 100,00
2026-04       2/3       R$ 100,00
2026-05       3/3       R$ 100,00
```

A `Fatura` importada **não gera lançamento**. Ela existe para conferir: se o
total informado no PDF não bater com a soma das parcelas daquela competência,
alguma linha escapou da conciliação e o sistema avisa.

### Data de corte

`competencia_da_compra(data, dia_fechamento)` — compra no dia do fechamento ou
antes entra na fatura do mês; depois, na seguinte. Comprar dia 26 num cartão
que fecha dia 25 significa pagar só no mês seguinte, e é a regra que mais gera
surpresa.

### Divisão de centavos

R$ 100,00 em 3x vira **33,34 + 33,33 + 33,33**. A sobra vai para a primeira
parcela, como fazem a maioria dos emissores. Dividir e arredondar cada parcela
deixaria diferença de centavos que impediria a conciliação de bater.

### O que a nota fiscal traz, e o que não traz

A NFC-e traz forma de pagamento (`tPag`), bandeira (`tBand`) e código de
autorização (`cAut`). **Não traz o número de parcelas** — o layout 4.00 tem
`indPag`, que só distingue "à vista" de "a prazo"; parcelamento aparece no
grupo `cobr/dup`, que é da NF-e modelo 55 e raramente vem no cupom modelo 65.

Por isso o scan ganha um segundo passo, e só quando a forma é crédito:

```
lê o QR → consulta a SEFAZ → mostra emitente, valor e forma de pagamento
        → se for crédito: "qual cartão?" e "quantas parcelas?"
        → grava Nota + PagamentoNota + Compra + ParcelaCompra
```

Perguntar **depois**, não antes: a pessoa está no caixa. Ler o QR tem que ser
instantâneo, e o cupom já fica salvo antes das perguntas. Sem resposta, a nota
entra numa lista de pendências — melhor que travar a leitura, ainda mais porque
offline não há como consultar a lista de cartões.

### Conciliação

Em ordem, parando no primeiro acerto:

1. **valor + número da parcela + data em ±4 dias** — o mais confiável sem
   código de autorização no PDF
2. **valor + data** — para compras à vista
3. **valor + estabelecimento**, resolvido pelos apelidos

Linha sem correspondência é uma compra cujo cupom não foi escaneado: precisa de
categoria antes de virar despesa. Parcela prevista sem linha na fatura é
estorno ou compra que não entrou naquele mês — fica marcada para revisão, nunca
apagada.

Conciliação automática **nunca é silenciosa**. Cada linha guarda como foi
casada, e `/faturas/{id}/pendencias/` devolve o que precisa de olho humano. O
trabalho da pessoa é olhar as exceções, não conferir as óbvias.

---

## 3. Financiamento imobiliário

### Por que não é um contrato comum

Um contrato comum tem valor fixo e o sistema projeta. Um financiamento SAC tem
**parcela decrescente**, e o banco já publica a tabela inteira no
Demonstrativo Descritivo de Crédito.

O DDC ainda traz a situação de cada parcela — Paga, Aberta, Projetada — que
mapeia direto no modelo previsto × realizado. Um único PDF entrega os dois
lados de vinte e cinco anos.

### O erro que isso corrige

Medido no DDC real de 296 parcelas do projeto:

```
Parcelas restantes: 246  (fev/2026 → jul/2046)

  projeção com valor fixo de R$ 2.090 (como estava na planilha):  R$ 514.140,00
  soma real das parcelas do DDC:                                  R$ 371.481,98
                                                                  --------------
  superestimativa:                                                R$ 142.658,02  (38%)
```

A parcela cai de R$ 2.088 hoje para R$ 867 na última. Tratar como valor fixo
projeta R$ 142 mil que nunca vão sair.

Importar é melhor que calcular: o banco sabe o índice de correção que aplicou,
nós não.

### A armadilha da duplicidade

Quem já cadastrava o financiamento como contrato de valor fixo passa a ter as
duas coisas projetando o mesmo desembolso. Testado no projeto: importar o DDC
somou R$ 70 mil ao previsto de 36 meses, e o contrato antigo continuou
projetando 23 meses sobrepostos.

A importação detecta e reporta em `duplicidades`. **Não apaga sozinha** — o
contrato pode ter realizados vinculados, e sumir com ele silenciosamente seria
pior que a duplicidade.

### Titular diferente de quem paga

O DDC de exemplo está no nome de outra pessoa. O campo
`paga_do_proprio_bolso` separa as duas coisas: só entra no fluxo de caixa o que
sai do seu bolso, independente de em qual nome está o contrato.

---

## 4. Conta de consumo

### O que só ela entrega

O valor já viria do extrato. A conta traz o **consumo** e a **leitura do
medidor**, e isso muda a pergunta que o sistema responde.

Sem consumo, "a luz subiu" é uma frase sobre o valor. Com consumo, dá para
separar as duas causas — gastei mais energia, ou a tarifa aumentou — que pedem
reações opostas. Uma se resolve mudando hábito; a outra, não tem o que fazer.

Por isso `tarifa_media` é campo de primeira classe, e a ferramenta do
assistente devolve valor, consumo e tarifa lado a lado.

### Integração com o contrato

A conta de luz normalmente já existe como contrato mensal previsto. A conta
importada **vira o realizado** daquela competência, ligada ao mesmo contrato.
Não é despesa nova; é a confirmação do que estava previsto.

---

## 5. Holerite — isolado de propósito

A folha **não alimenta o fluxo de caixa** ainda. Há o pedido de manter separado
até o resto se estabilizar, e há um motivo técnico que reforça isso.

O salário já existe como contrato previsto, e os números não batem:

```
contrato cadastrado na planilha:  R$ 5.543,00
líquido do holerite de 11/2025:   R$ 6.493,77
```

Ligar o holerite ao `Realizado` antes de resolver essa divergência
transformaria um dado errado em dois. O ponto de integração já existe —
`Holerite.realizado` — e é uma função quando decidirmos.

### A conferência que se auto-valida

No PDF, Vencimentos e Descontos colapsam numa coluna só. A natureza de cada
verba é inferida pelo nome, e a soma é conferida contra o líquido impresso.
Não bateu, a extração se declara suspeita (`conferencia_ok = False`) em vez de
devolver número errado.

Foi essa conferência que pegou um bug real: a linha de cabeçalho
`999 IGOR GUIMARÃES BARROS 391125 2 1` casava com o padrão de verba e entrava
como R$ 1,00 de vencimento. Exigir centavos no valor resolveu.

---

## 6. Estabelecimentos

### Nascem do CNPJ, mesmo offline

A chave de acesso da NFC-e carrega o CNPJ nas posições 6 a 19. O
estabelecimento é criado no scan, sem chamada de rede — e o nome real chega
depois, quando a SEFAZ responder.

### Raiz do CNPJ agrupa filiais

Os 8 primeiros dígitos identificam a empresa; os 4 seguintes, a filial. O cupom
de exemplo é da Redemix filial **0015**, e a rede tem dezenas de lojas com CNPJ
próprio. Sem `cnpj_raiz` indexado, "quanto gastei na Redemix este ano" não
responde nada.

### Apelidos aprendem

A fatura do cartão não traz CNPJ. Traz `"REDEMIX SUPERM 03/12"`. A tabela
`ApelidoEstabelecimento` faz a ponte, e cresce sozinha: quando a pessoa
concilia uma linha na mão, o texto vira apelido e casa automaticamente da
próxima vez.

`categoria_padrao` no estabelecimento é o que faz o sistema dar menos trabalho
com o tempo — na terceira compra na farmácia, a categoria já vem preenchida.

---

## 7. O pipeline de documentos

Todo PDF passa pelo mesmo caminho, em duas etapas separadas de propósito:

```
    1. EXTRAIR    lê o PDF → Documento + LinhaDocumento
    2. PROCESSAR  interpreta as linhas → objetos de domínio
```

Extrair sem processar permite ver o que o parser entendeu antes de deixar
qualquer coisa entrar no fluxo de caixa — é o que o `--simular` faz. E
processar sem extrair permite reprocessar documentos antigos quando um parser
melhora, sem pedir os arquivos de novo.

O `arquivo_hash` (sha256) torna a importação idempotente, mesma ideia da chave
de acesso no cupom fiscal.

**A linha extraída fica separada do resultado de domínio.** A linha é o que o
PDF dizia; o lançamento é o que decidimos que ela significa. Quando os dois
divergem, dá para ver onde a interpretação entrou.

---

## 8. O que mudou em relação aos seus scripts

Os extratores nasceram do seu `processar_faturas.py` e `extrair_boletos.py`.
Três diferenças que valem justificativa:

**A separação por "ANUIDADE seguida de ESTORNO" virou detecção por cabeçalho
de seção.** A regra original funciona na fatura que você tem em mãos, mas
quebra em qualquer mês sem anuidade ou sem estorno — e quando quebra, todas as
parcelas futuras entram na fatura corrente e o mês fica com o dobro da despesa.
A regra antiga ficou como reserva; falhando as duas, o extrator avisa em vez de
adivinhar.

**O parcelamento passou a ser lido.** `NETSHOES 03/10` vira
`parcela_atual=3, parcela_total=10`. Seu `validar_fluxo_caixa.py` detectava o
padrão para classificar, mas descartava os números — e são eles que permitem
casar a linha com a parcela prevista.

**A classificação por palavra-chave saiu do extrator.** Ela vive agora no plano
de contas: o estabelecimento tem `categoria_padrao` e os apelidos aprendem com
o que você corrige. Manter uma lista de palavras dentro do extrator seria uma
segunda fonte de verdade sobre a mesma decisão — e a que não aprende.

O `cfo_rag_avancado.py` foi substituído pelo assistente
(`apps/assistente/`), que consulta o banco por ferramentas em vez de recarregar
CSVs. A diferença prática é que ele responde sobre dado atual, não sobre o
estado do último `run_pipeline.py`.

---

## 9. Estado de validação

| Extrator | PDF real | Testes |
|---|---|---|
| Financiamento (DDC) | sim, 296 parcelas | 8 |
| Holerite | sim, 4 documentos | 9 |
| Fatura de cartão | **não** | — |
| Conta de consumo | **não** | — |

Os dois últimos foram escritos a partir dos seus scripts, sem PDF de
referência. O formato de linha e os marcadores de seção quase certamente
precisam de ajuste no primeiro uso real:

```bash
python manage.py importar_documento fatura.pdf --senha 03221 --simular
```

O `--simular` mostra o que o parser entendeu sem gravar nada.

---

## 10. Visões matriciais

### Matriz de contratos

Linhas por estabelecimento (ou categoria, ou classificação), colunas por mês.
É o formato da tabela dinâmica do Power BI, e responde o que a lista mensal não
responde: *o que muda de um mês para o outro, linha a linha*.

**O sinal é o oposto da planilha original.** Lá, receita era negativa. Aqui é
receita positiva e despesa negativa, como no resto do sistema. O total da
coluna passa a ser o resultado do mês — positivo sobra, negativo falta. Ter
duas convenções de sinal na mesma aplicação seria pior que divergir da planilha
antiga.

A linha **Acumulado** no rodapé mostra em que mês o saldo atravessa o zero, sem
exigir soma de cabeça. Nos dados atuais: −18,90 em janeiro, −3.092,55 em
fevereiro.

### Painel de cartões

Linhas por cartão, colunas por mês, mais limite, comprometido e disponível.

**Comprometido não é o gasto do mês.** É a soma de todas as parcelas que ainda
vão cair, incluindo as de compras antigas. É esse número que consome limite. Um
cartão pode ter fatura baixa neste mês e mesmo assim estar sem limite, porque
doze parcelas futuras já reservaram o espaço — e é justamente essa a situação
que a coluna "Disponível" torna visível.

`disponivel = limite − comprometido`.

Cartões acima de 70% de utilização ganham destaque: utilização alta pesa no
score de crédito mesmo com a fatura sempre em dia.

---

## 11. Open Finance

Puxar fatura e extrato direto do banco elimina o PDF e a senha. O obstáculo
não é técnico.

O acesso ao Open Finance é restrito a instituições autorizadas pelo Banco
Central. **Pessoa física não se conecta diretamente, nem aos próprios dados.**
O caminho viável é um agregador já autorizado — Pluggy, Belvo, Klavi são os
mais usados no Brasil — que cobra por conexão ativa e exige contrato.

O que já está preparado: o pipeline de documentos separa extração de
processamento, e o processamento não sabe de onde o dado veio. Um agregador
entra como extrator novo; nada mais muda.

---

## 12. PIX pago com cartão de crédito

Aplicativos que fazem PIX cobrando no cartão convertem limite em dinheiro
imediato, com taxa. Modelar isso pede cuidado, porque a operação **não é uma
compra**:

**A taxa precisa aparecer separada.** Um PIX de R$ 1.000 com taxa de 4,5% vira
R$ 1.045 na fatura. Se o sistema registrar só os R$ 1.045 como despesa, o custo
some dentro do valor e não dá para comparar com outras formas de crédito. A
modelagem correta é uma `Compra` com o valor do PIX e um custo financeiro
separado.

**O custo efetivo depende do parcelamento.** 4,5% em 1x é uma coisa; 4,5% mais
juros em 12x é outra. Sem calcular a taxa mensal equivalente, um número que
parece pequeno esconde um custo anual alto — comparável ou superior ao do
rotativo, que é o crédito mais caro do mercado.

Quando implementarmos, o sistema deve mostrar o custo efetivo ao lado do
valor, para que a comparação com outras opções seja possível na hora da
decisão.

---

## 13. Confronto previsto × realizado

Conceito portado do modelo do Power BI, medida
`Valor_Recorrente_ou_Prestacoes`:

```dax
IF(NOT ISBLANK(ValorRecorrente), ValorRecorrente, ValorPrestacoes)
```

O realizado **substitui** o previsto naquela competência. Enquanto a nota não
chega, vale a projeção; quando chega, ela manda. É o que permite somar uma
série que mistura passado e futuro sem contar nada duas vezes.

### O cuidado que o original não tem

Substituir cegamente quebra no pagamento parcial. Parcela prevista de R$ 1.000
com R$ 400 pagos: trocar 1.000 por 400 faz o mês parecer mais barato, sendo que
faltam R$ 600.

A regra implementada:

| Competência | Valor efetivo | Por quê |
|---|---|---|
| Fechada | o realizado, mesmo sendo zero | o mês passou; se nada foi pago, a despesa não aconteceu |
| Aberta | `max(previsto, realizado)` | o resto ainda pode chegar |

### Dois bugs corrigidos nas medidas originais

`ValoresFuturos_2024` e `ValoresHistorico<2024` comparam mês e ano em campos
separados:

```dax
MONTH(Data) > MesAtual && YEAR(Data) = AnoAtual
```

**Em dezembro a medida zera** — nenhum mês é maior que 12.

E o histórico, com `MONTH < MesAtual && YEAR < AnoAtual`, perde tudo que
aconteceu em meses posteriores ao atual em anos anteriores. Medido numa série
de 36 parcelas, com a data em março: de 14 parcelas que deveriam entrar, apenas
2 entram.

A comparação correta é entre competências inteiras:
`competencia < hoje.replace(day=1)`.

### Saldo a realizar

Equivale ao `Saldo A Faturar` do modelo original — lá, contrato menos faturado;
aqui, projeção menos o que foi pago ou recebido. Só conta competências
fechadas, senão todo contrato apareceria devendo a parcela do próprio mês já no
dia 1º.

### Vínculo por descrição

O modelo original casava recorrência e faturamento por competência mais código
do item. O equivalente aqui é competência mais descrição normalizada, porque
lançamento importado ou digitado chega sem o vínculo com o contrato.

`GET /api/vincular-realizados/` simula; `POST` aplica. A simulação é o padrão
de propósito: vincular errado é pior que deixar órfão — o órfão aparece na
lista de revisão, o vínculo errado se esconde dentro de um total que parece
certo. E o casamento exige que a competência caia dentro da vigência do
contrato, senão um homônimo de outro período seria absorvido.
