# Previsão de fluxo de caixa

## Por que não há rede neural aqui

A previsão financeira pessoal tem duas partes com naturezas opostas:

| | O que é | Como se prevê |
|---|---|---|
| **Determinística** | contratos, financiamento, parcelas de cartão já compradas | não se prevê — **já se sabe** |
| **Estocástica** | mercado, consumo variável, compras avulsas | estimativa a partir do histórico |

Modelo nenhum melhora a parte determinística. O banco já publicou as 296
parcelas do financiamento com o valor exato de cada uma; aplicar regressão ali
introduziria erro onde havia certeza.

Sobra a parte estocástica, e ela tem uma característica que decide tudo:
**uma observação por mês**. Um ano inteiro de uso são doze pontos. Com doze
pontos, gradient boosting ou LSTM não aprendem padrão — decoram ruído e
produzem intervalos falsamente estreitos, que é o pior resultado possível para
quem vai decidir com base neles.

O que funciona nesse regime são modelos simples com validação honesta. O
aprendizado está na **seleção**, não na complexidade do modelo.

## Como a escolha acontece

Backtesting com origem móvel: treina com os primeiros k meses, prevê o k+1,
compara com o real, avança e repete.

```
jan fev mar | abr        treina com 3, prevê abr
jan..abr    | mai        treina com 4, prevê mai
jan..mai    | jun        treina com 5, prevê jun
```

Cada previsão avaliada usa apenas dados anteriores a ela. Sem isso, um modelo
pareceria ótimo no teste e falharia em produção.

**A métrica é MAE**, em reais. MAPE explode quando o mês foi próximo de zero,
comum em categoria sem movimento mensal. RMSE eleva ao quadrado e deixa um mês
atípico dominar a escolha — e gasto pessoal é cheio de mês atípico.

### Resultado medido

Com 14 meses simulados de gasto de mercado (patamar subindo, mais um mês de
R$ 3.612 contra uma base de R$ 1.000):

```
  mediana_3    R$   293,05  (11 avaliações)   <- escolhido
  mediana_6    R$   420,35  ( 8 avaliações)
  media_3      R$   478,47  (11 avaliações)
  ingenuo      R$   515,72  (11 avaliações)
  tendencia    R$ 1.518,15  ( 8 avaliações)
```

A mediana de 3 meses erra **43% menos** que repetir o último mês. A tendência
erra 5× mais, porque extrapola o mês atípico como se fosse patamar novo.

Esse é o ponto: nenhum modelo foi escolhido por parecer adequado ao domínio.
A medição escolheu.

## Ganho sobre o ingênuo

Todo resultado reporta quanto o modelo melhora sobre "mês que vem igual ao
passado". Abaixo de 5% de ganho, o sistema volta ao ingênuo e diz isso —
modelo complexo sem ganho medido é só mais uma explicação para dar quando
errar.

## Cenários, não um número

Planejamento financeiro sério não produz um número. Produz uma distribuição:
*"o saldo de dezembro fica entre X e Y em 80% dos cenários, e há 24% de chance
de ficar negativo em algum mês"*. É o que se chama fluxo de caixa em risco.

Um número único esconde a informação que decide a ação. "Sobra R$ 400 em
março" e "sobra R$ 400 em março, com 30% de chance de faltar" pedem
comportamentos opostos, e o valor esperado é idêntico nos dois.

### Como a simulação funciona

1. A parte determinística entra igual em todos os cenários.
2. A parte estocástica recebe, a cada mês de cada cenário, um erro sorteado
   dos resíduos observados no backtest.
3. O saldo é acumulado e no fim se olha a distribuição.

**Bootstrap dos resíduos reais**, não ruído gaussiano. Se o histórico mostra
que uma vez a cada oito meses aparece um gasto R$ 2.000 acima do normal, essa
cauda entra na simulação com a frequência que ela tem de verdade. A normal
suavizaria exatamente o cenário que interessa.

O erro cresce com a **raiz do horizonte** — comportamento de passeio
aleatório. Linear seria pessimista demais; constante seria ingênuo.

A semente é fixa: duas aberturas da mesma tela mostram o mesmo número.
Probabilidade que muda a cada F5 destrói a confiança na tela inteira.

## O sistema melhora sozinho

| Histórico | O que fica disponível |
|---|---|
| 0 a 3 meses | só o contratado, sem faixa — e a tela diz isso |
| 4 meses | primeiro backtest; modelo validado, faixa ainda frágil |
| 6 meses | tendência e suavização entram; faixa passa a significar algo |
| 24 meses | modelo sazonal entra — IPTU em janeiro, 13º em dezembro |

Não há retreino manual. A seleção roda a cada consulta, e cada mês novo é mais
um ponto de validação.

## O que isso não faz

**Não prevê choque.** Perda de emprego, emergência médica, mudança de cidade —
nenhum modelo estatístico vê isso vindo. A faixa cobre a variação normal, não
a ruptura.

**Não substitui o cadastro.** A previsão parte dos contratos registrados. Um
contrato esquecido não aparece em cenário nenhum.

**Não é conselho financeiro.** Mostra números e probabilidades sobre os seus
próprios dados; a decisão continua sendo sua.
