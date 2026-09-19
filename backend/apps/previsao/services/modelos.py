"""
Modelos de previsão de série mensal.

Por que não há rede neural aqui
-------------------------------
Previsão financeira pessoal tem duas partes com naturezas opostas:

    determinística   contratos, financiamento, parcelas de cartão já compradas
                     → o valor futuro é **conhecido**, não estimado

    estocástica      mercado, consumo variável, compras avulsas
                     → precisa ser estimado a partir do histórico

Modelo nenhum melhora a parte determinística: o banco já publicou as 296
parcelas do financiamento com o valor exato. Aplicar regressão ali só
introduziria erro onde não havia.

Sobra a parte estocástica, e ela tem uma característica que decide tudo:
**uma observação por mês**. Um ano inteiro de uso são doze pontos. Com doze
pontos, gradient boosting ou LSTM não aprendem padrão — decoram ruído e
produzem intervalos de confiança falsamente estreitos, que é o pior resultado
possível para quem vai decidir com base neles.

O que funciona nesse regime são modelos simples com validação honesta. O
"aprendizado" aqui está na **seleção**: backtesting escolhe, série a série,
qual modelo erra menos, e o erro medido vira o intervalo de previsão. Quando o
histórico crescer, modelos que hoje nem competem passam a ser elegíveis
sozinhos — cada um declara seu mínimo de observações.

Todos os modelos são funções puras sobre uma lista de valores mensais
consecutivos. Sem banco, sem Django.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from decimal import Decimal
from typing import Callable, Sequence

Serie = Sequence[float]


@dataclass(frozen=True)
class Modelo:
    nome: str
    descricao: str
    # Abaixo disso o modelo não é sequer avaliado: ajustar tendência com dois
    # pontos produz qualquer coisa, e o backtest não teria como reprovar.
    minimo_observacoes: int
    prever: Callable[[Serie, int], list[float]]


def _ultimo(serie: Serie) -> float:
    return float(serie[-1]) if serie else 0.0


# ---------------------------------------------------------------------------
# Implementações
# ---------------------------------------------------------------------------

def ingenuo(serie: Serie, horizonte: int) -> list[float]:
    """
    Próximo mês igual ao último.

    É a referência contra a qual todo o resto precisa provar valor. Em série
    financeira curta, ganhar do ingênuo já é um resultado — e muitos modelos
    sofisticados perdem.
    """
    return [_ultimo(serie)] * horizonte


def media_movel(janela: int):
    def prever(serie: Serie, horizonte: int) -> list[float]:
        recentes = list(serie)[-janela:]
        media = statistics.fmean(recentes) if recentes else 0.0
        return [media] * horizonte

    return prever


def mediana_movel(janela: int):
    """
    Mediana das últimas observações.

    Resistente a mês atípico — o conserto do carro, a viagem, a matrícula
    anual. Em gasto pessoal esses saltos são a regra, não a exceção, e a média
    os incorpora ao patamar como se fossem permanentes.
    """

    def prever(serie: Serie, horizonte: int) -> list[float]:
        recentes = list(serie)[-janela:]
        valor = statistics.median(recentes) if recentes else 0.0
        return [valor] * horizonte

    return prever


def tendencia_linear(serie: Serie, horizonte: int) -> list[float]:
    """
    Reta de mínimos quadrados, extrapolada.

    Capta inflação e crescimento de patamar. O risco é extrapolar para sempre
    uma tendência que era temporária, então a projeção é limitada a não ficar
    negativa — despesa não vira receita por causa da inclinação da reta.
    """
    valores = [float(v) for v in serie]
    n = len(valores)
    if n < 2:
        return ingenuo(serie, horizonte)

    media_x = (n - 1) / 2
    media_y = statistics.fmean(valores)
    variancia = sum((i - media_x) ** 2 for i in range(n))
    if variancia == 0:
        return [media_y] * horizonte

    covariancia = sum((i - media_x) * (v - media_y) for i, v in enumerate(valores))
    inclinacao = covariancia / variancia
    intercepto = media_y - inclinacao * media_x

    return [max(0.0, intercepto + inclinacao * (n + passo)) for passo in range(horizonte)]


def suavizacao_holt(alfa: float = 0.5, beta: float = 0.2):
    """
    Suavização exponencial com tendência (Holt).

    Pesa o recente mais que o antigo, sem descartar o resto como a média móvel
    faz. Os coeficientes são fixos de propósito: otimizá-los em série de doze
    pontos é mais uma forma de decorar ruído.
    """

    def prever(serie: Serie, horizonte: int) -> list[float]:
        valores = [float(v) for v in serie]
        if len(valores) < 3:
            return ingenuo(serie, horizonte)

        nivel = valores[0]
        tendencia = valores[1] - valores[0]
        for valor in valores[1:]:
            nivel_anterior = nivel
            nivel = alfa * valor + (1 - alfa) * (nivel + tendencia)
            tendencia = beta * (nivel - nivel_anterior) + (1 - beta) * tendencia

        return [max(0.0, nivel + tendencia * (passo + 1)) for passo in range(horizonte)]

    return prever


def sazonal_ingenuo(periodo: int = 12):
    """
    Cada mês repete o mesmo mês do ano anterior.

    Em finanças pessoais a sazonalidade é forte e conhecida: IPTU e material
    escolar em janeiro, 13º em dezembro, conta de luz no verão. Exige dois
    ciclos completos para ser avaliado — com um só, não há como o backtest
    saber se o padrão se repete.
    """

    def prever(serie: Serie, horizonte: int) -> list[float]:
        valores = [float(v) for v in serie]
        if len(valores) < periodo:
            return ingenuo(serie, horizonte)
        return [valores[-periodo + (passo % periodo)] for passo in range(horizonte)]

    return prever


REGISTRO: list[Modelo] = [
    Modelo(
        nome="ingenuo",
        descricao="Repete o último mês",
        minimo_observacoes=1,
        prever=ingenuo,
    ),
    Modelo(
        nome="mediana_3",
        descricao="Mediana dos últimos 3 meses",
        minimo_observacoes=3,
        prever=mediana_movel(3),
    ),
    Modelo(
        nome="media_3",
        descricao="Média dos últimos 3 meses",
        minimo_observacoes=3,
        prever=media_movel(3),
    ),
    Modelo(
        nome="mediana_6",
        descricao="Mediana dos últimos 6 meses",
        minimo_observacoes=6,
        prever=mediana_movel(6),
    ),
    Modelo(
        nome="tendencia",
        descricao="Reta de tendência",
        minimo_observacoes=6,
        prever=tendencia_linear,
    ),
    Modelo(
        nome="holt",
        descricao="Suavização exponencial com tendência",
        minimo_observacoes=6,
        prever=suavizacao_holt(),
    ),
    Modelo(
        nome="sazonal",
        descricao="Repete o mesmo mês do ano anterior",
        minimo_observacoes=24,
        prever=sazonal_ingenuo(12),
    ),
]


def disponiveis(tamanho_serie: int) -> list[Modelo]:
    return [m for m in REGISTRO if tamanho_serie >= m.minimo_observacoes]


def por_nome(nome: str) -> Modelo | None:
    return next((m for m in REGISTRO if m.nome == nome), None)


def para_decimal(valor: float) -> Decimal:
    return Decimal(str(round(valor, 2)))
