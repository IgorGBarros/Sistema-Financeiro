"""
Cenários e risco de caixa.

O que uma empresa realmente faz
-------------------------------
Planejamento financeiro sério não produz um número. Produz uma distribuição:
"o saldo de dezembro fica entre X e Y em 80% dos cenários, e há 18% de chance
de ficar negativo em algum mês". É o que se chama fluxo de caixa em risco.

Um número único esconde a informação que decide a ação. "Sobra R$ 400 em
março" e "sobra R$ 400 em março, com 30% de chance de faltar" pedem
comportamentos opostos, e o valor esperado é idêntico nos dois.

Como a simulação funciona
-------------------------
1. A parte determinística — contratos, financiamento, parcelas de cartão já
   compradas — entra igual em todos os cenários. Ela é conhecida, não sorteada.
2. A parte estocástica recebe, a cada mês de cada cenário, um erro sorteado
   dos resíduos observados no backtest.
3. O saldo é acumulado mês a mês, e no fim se olha a distribuição.

**Bootstrap dos resíduos reais**, não ruído gaussiano. Se o histórico mostra
que uma vez a cada oito meses aparece um gasto R$ 2.000 acima do normal, essa
cauda entra na simulação com a frequência que ela tem de verdade. A normal
suavizaria exatamente o cenário que interessa para planejar.

O erro cresce com o horizonte: prever daqui a um mês é diferente de prever
daqui a doze. A incerteza acumulada segue a raiz do horizonte, que é o
comportamento de um passeio aleatório — linear seria pessimista demais,
constante seria ingênuo.
"""

from __future__ import annotations

import random
import statistics
from dataclasses import dataclass


@dataclass
class DistribuicaoMes:
    competencia: str
    # Parte conhecida: contratos, financiamento, parcelas já compradas.
    deterministico: float
    # Estimativa central da parte variável.
    estimado: float
    p10: float
    p50: float
    p90: float
    saldo_p10: float
    saldo_p50: float
    saldo_p90: float
    probabilidade_negativo: float


@dataclass
class Simulacao:
    meses: list[DistribuicaoMes]
    cenarios: int
    probabilidade_algum_mes_negativo: float
    primeiro_mes_de_risco: str | None
    saldo_final_p10: float
    saldo_final_p50: float
    saldo_final_p90: float
    confiavel: bool
    aviso: str | None


def _quantil(ordenados: list[float], p: float) -> float:
    if not ordenados:
        return 0.0
    posicao = p * (len(ordenados) - 1)
    baixo = int(posicao)
    alto = min(baixo + 1, len(ordenados) - 1)
    peso = posicao - baixo
    return ordenados[baixo] * (1 - peso) + ordenados[alto] * peso


def simular(
    *,
    competencias: list[str],
    deterministico: list[float],
    estimado: list[float],
    residuos: list[float],
    saldo_inicial: float = 0.0,
    cenarios: int = 5000,
    semente: int | None = 42,
) -> Simulacao:
    """
    Monte Carlo sobre a parte variável.

    `deterministico` e `estimado` são o resultado líquido do mês (receita menos
    despesa), já com sinal. `residuos` vem do backtest do modelo escolhido.

    A semente é fixa por padrão: duas aberturas da mesma tela devem mostrar o
    mesmo número. Probabilidade que muda sozinha a cada F5 destrói a confiança
    na tela inteira, e o ganho de aleatoriedade real aqui é zero.
    """
    horizonte = len(competencias)
    if horizonte == 0:
        return Simulacao([], 0, 0.0, None, 0.0, 0.0, 0.0, False, "Período vazio.")

    sorteador = random.Random(semente)
    sem_residuos = len(residuos) < 3

    if sem_residuos:
        # Sem histórico suficiente, a simulação viraria uma faixa inventada.
        # Melhor devolver a projeção determinística e dizer que não há
        # intervalo do que desenhar uma banda que não mede nada.
        saldo = saldo_inicial
        meses = []
        for indice, competencia in enumerate(competencias):
            saldo += deterministico[indice] + estimado[indice]
            meses.append(
                DistribuicaoMes(
                    competencia=competencia,
                    deterministico=deterministico[indice],
                    estimado=estimado[indice],
                    p10=estimado[indice], p50=estimado[indice], p90=estimado[indice],
                    saldo_p10=saldo, saldo_p50=saldo, saldo_p90=saldo,
                    probabilidade_negativo=1.0 if saldo < 0 else 0.0,
                )
            )
        negativo = next((m.competencia for m in meses if m.saldo_p50 < 0), None)
        return Simulacao(
            meses=meses,
            cenarios=0,
            probabilidade_algum_mes_negativo=1.0 if negativo else 0.0,
            primeiro_mes_de_risco=negativo,
            saldo_final_p10=meses[-1].saldo_p50,
            saldo_final_p50=meses[-1].saldo_p50,
            saldo_final_p90=meses[-1].saldo_p50,
            confiavel=False,
            aviso=(
                "Sem histórico suficiente para estimar incerteza. A projeção "
                "mostra apenas o que já está contratado."
            ),
        )

    saldos_por_mes: list[list[float]] = [[] for _ in range(horizonte)]
    variaveis_por_mes: list[list[float]] = [[] for _ in range(horizonte)]
    algum_negativo = 0

    for _ in range(cenarios):
        saldo = saldo_inicial
        negativo_neste_cenario = False
        for indice in range(horizonte):
            # A incerteza cresce com a raiz do horizonte: passeio aleatório.
            escala = (indice + 1) ** 0.5
            choque = sorteador.choice(residuos) * escala
            variavel = estimado[indice] + choque

            saldo += deterministico[indice] + variavel
            variaveis_por_mes[indice].append(variavel)
            saldos_por_mes[indice].append(saldo)
            if saldo < 0:
                negativo_neste_cenario = True
        algum_negativo += negativo_neste_cenario

    meses = []
    for indice, competencia in enumerate(competencias):
        saldos = sorted(saldos_por_mes[indice])
        variaveis = sorted(variaveis_por_mes[indice])
        meses.append(
            DistribuicaoMes(
                competencia=competencia,
                deterministico=deterministico[indice],
                estimado=estimado[indice],
                p10=_quantil(variaveis, 0.10),
                p50=_quantil(variaveis, 0.50),
                p90=_quantil(variaveis, 0.90),
                saldo_p10=_quantil(saldos, 0.10),
                saldo_p50=_quantil(saldos, 0.50),
                saldo_p90=_quantil(saldos, 0.90),
                probabilidade_negativo=sum(1 for s in saldos if s < 0) / len(saldos),
            )
        )

    # Primeiro mês com risco relevante. 20% é o limiar em que vale agir: abaixo
    # disso, avisar todo mês vira ruído e a pessoa para de olhar.
    risco = next((m.competencia for m in meses if m.probabilidade_negativo >= 0.20), None)
    finais = sorted(saldos_por_mes[-1])

    return Simulacao(
        meses=meses,
        cenarios=cenarios,
        probabilidade_algum_mes_negativo=algum_negativo / cenarios,
        primeiro_mes_de_risco=risco,
        saldo_final_p10=_quantil(finais, 0.10),
        saldo_final_p50=_quantil(finais, 0.50),
        saldo_final_p90=_quantil(finais, 0.90),
        confiavel=True,
        aviso=None,
    )


def resumo_legivel(simulacao: Simulacao) -> str:
    """Uma frase com o que a distribuição significa."""
    if not simulacao.confiavel:
        return simulacao.aviso or "Projeção sem estimativa de incerteza."

    probabilidade = simulacao.probabilidade_algum_mes_negativo
    if probabilidade < 0.05:
        risco = "O saldo se mantém positivo em praticamente todos os cenários."
    elif probabilidade < 0.20:
        risco = (
            f"Há {probabilidade:.0%} de chance de o saldo ficar negativo em "
            f"algum mês do período."
        )
    else:
        risco = (
            f"Atenção: {probabilidade:.0%} dos cenários terminam com saldo "
            f"negativo em algum mês"
            + (
                f", o primeiro em {simulacao.primeiro_mes_de_risco}."
                if simulacao.primeiro_mes_de_risco
                else "."
            )
        )

    return (
        f"{risco} No fim do período, o saldo fica entre "
        f"R$ {simulacao.saldo_final_p10:,.2f} e R$ {simulacao.saldo_final_p90:,.2f} "
        f"em 80% dos cenários."
    )
