"""
Ciclo de faturamento e divisão de parcelas.

Funções puras: recebem datas e valores, devolvem datas e valores. Sem banco,
sem request — o que as torna triviais de testar e de usar numa simulação.
"""

from __future__ import annotations

import calendar
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

CENTAVO = Decimal("0.01")


def proximo_mes(competencia: date) -> date:
    if competencia.month == 12:
        return date(competencia.year + 1, 1, 1)
    return date(competencia.year, competencia.month + 1, 1)


def somar_meses(competencia: date, meses: int) -> date:
    total = competencia.month - 1 + meses
    return date(competencia.year + total // 12, total % 12 + 1, 1)


def dia_valido(ano: int, mes: int, dia: int) -> date:
    """Dia 31 num mês de 30 vira o último dia do mês."""
    return date(ano, mes, min(dia, calendar.monthrange(ano, mes)[1]))


def competencia_da_compra(data_compra: date, dia_fechamento: int) -> date:
    """
    Em qual fatura a compra cai.

    Compra no dia do fechamento ou antes entra na fatura do mês; depois,
    na seguinte. É a regra que mais gera surpresa — comprar dia 26 num cartão
    que fecha dia 25 significa pagar só no mês seguinte.
    """
    competencia = data_compra.replace(day=1)
    if data_compra.day <= dia_fechamento:
        return competencia
    return proximo_mes(competencia)


def vencimento_da_fatura(competencia: date, dia_vencimento: int, dia_fechamento: int) -> date:
    """
    Vencimento da fatura de uma competência.

    Quando o vencimento é menor que o fechamento, ele cai no mês seguinte:
    fecha dia 25, vence dia 5 — o dia 5 é do mês que vem.
    """
    if dia_vencimento <= dia_fechamento:
        seguinte = proximo_mes(competencia)
        return dia_valido(seguinte.year, seguinte.month, dia_vencimento)
    return dia_valido(competencia.year, competencia.month, dia_vencimento)


def dividir_parcelas(valor_total: Decimal, quantidade: int) -> list[Decimal]:
    """
    Divide um valor em parcelas, com a sobra de centavos na primeira.

    R$ 100,00 em 3x vira 33,34 + 33,33 + 33,33. É o que a maioria dos
    emissores faz, e o que faz a soma fechar exatamente com o total — dividir
    e arredondar cada parcela deixaria diferença de centavos que impede a
    conciliação de bater.
    """
    if quantidade < 1:
        raise ValueError("A compra precisa de ao menos uma parcela.")

    valor_total = Decimal(valor_total)
    base = (valor_total / quantidade).quantize(CENTAVO, rounding=ROUND_HALF_UP)
    parcelas = [base] * quantidade
    parcelas[0] += valor_total - sum(parcelas)
    return parcelas


def projetar_parcelas(
    *, data_compra: date, valor_total: Decimal, quantidade: int, dia_fechamento: int
) -> list[tuple[int, date, Decimal]]:
    """Devolve [(número, competência, valor)] para cada parcela."""
    primeira = competencia_da_compra(data_compra, dia_fechamento)
    valores = dividir_parcelas(valor_total, quantidade)
    return [
        (numero, somar_meses(primeira, numero - 1), valor)
        for numero, valor in enumerate(valores, start=1)
    ]
