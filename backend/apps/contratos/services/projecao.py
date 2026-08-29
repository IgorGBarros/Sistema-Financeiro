"""
Projeção de contratos — porte da tabela calculada 'Contrato_Guarda-Chuva Futuros'.

Equivalências com o TMDL original
---------------------------------
DAX                                          Python
-------------------------------------------  ----------------------------------
FILTER(inicio <> BLANK && fim <> BLANK ...)   validação em gerar_parcelas()
DATEDIFF(inicio, fim, MONTH)                  meses_calendario()
GENERATESERIES(0, N-1, 1)                     range(n_meses)
EDATE(inicio, [Value])                        edate()
DIVIDE(DATEDIFF(...DAY), N)                   espacamento_dias
Preço Unitário * N                            valor_total_contrato()
Date(YEAR(dt), MONTH(dt), 1)                  dt.replace(day=1)

Duas armadilhas do DAX que precisam ser reproduzidas fielmente:

1. DATEDIFF(..., MONTH) no DAX conta FRONTEIRAS de mês, não meses completos.
   DATEDIFF("2026-01-31", "2026-02-01", MONTH) = 1, embora tenha passado 1 dia.
   Em Python isso é (ano2-ano1)*12 + (mes2-mes1) — nunca use days/30.

2. O ajuste `+ IF(DAY(fim) >= DAY(inicio), 1, 0)` existe para incluir o mês
   final. Efeito colateral desejado: contrato com início == fim (13º salário,
   restituição de IR) gera exatamente 1 parcela em vez de 0.

Diferença intencional em relação ao DAX: aqui a frequência é respeitada.
O DAX avançava sempre de 1 em 1 mês; um contrato anual passa a avançar 12.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

PASSO_POR_FREQUENCIA = {"M": 1, "B": 2, "T": 3, "S": 6, "A": 12, "U": 0}

CENTAVO = Decimal("0.01")


def meses_calendario(inicio: date, fim: date) -> int:
    """DATEDIFF(inicio, fim, MONTH) — diferença de fronteiras de mês."""
    return (fim.year - inicio.year) * 12 + (fim.month - inicio.month)


def edate(origem: date, meses: int) -> date:
    """
    EDATE do DAX/Excel: soma meses preservando o dia, com clamp no último dia
    do mês de destino. EDATE(2026-01-31, 1) = 2026-02-28.
    """
    total = origem.month - 1 + meses
    ano = origem.year + total // 12
    mes = total % 12 + 1
    dia = min(origem.day, calendar.monthrange(ano, mes)[1])
    return date(ano, mes, dia)


def numero_de_meses(inicio: date, fim: date) -> int:
    """
    VAR NumeroDeMeses =
        MAX(0, DATEDIFF(inicio, fim, MONTH) + IF(DAY(fim) >= DAY(inicio), 1, 0))
    """
    return max(0, meses_calendario(inicio, fim) + (1 if fim.day >= inicio.day else 0))


def quantidade_parcelas(inicio: date, fim: date, frequencia: str = "M") -> int:
    """Nº de parcelas considerando o passo da frequência."""
    if frequencia == "U":
        return 1
    n_meses = numero_de_meses(inicio, fim)
    passo = PASSO_POR_FREQUENCIA.get(frequencia, 1)
    if n_meses <= 0:
        return 0
    # teto da divisão: um contrato anual de 24 meses tem 2 parcelas
    return -(-n_meses // passo)


@dataclass(frozen=True)
class ParcelaProjetada:
    indice: int
    data_planejada: date
    competencia: date
    valor_previsto: Decimal
    quantidade_planejada: int
    espacamento_dias: Decimal


def projetar(
    *,
    data_inicio: date,
    data_fim: date,
    valor_unitario: Decimal,
    frequencia: str = "M",
    data_rescisao: date | None = None,
    reajuste_anual_pct: Decimal = Decimal("0"),
) -> list[ParcelaProjetada]:
    """
    Gera a série de parcelas previstas. Função pura — não toca no banco,
    o que a torna trivial de testar e de reusar em simulações ("e se eu
    cancelar este contrato em março?").
    """
    if not data_inicio or not data_fim or data_inicio > data_fim:
        return []

    termino = data_fim
    if data_rescisao and data_rescisao < data_fim:
        termino = data_rescisao

    total = quantidade_parcelas(data_inicio, termino, frequencia)
    if total <= 0:
        return []

    passo = PASSO_POR_FREQUENCIA.get(frequencia, 1) or 1
    dias_totais = (termino - data_inicio).days
    espacamento = (
        Decimal(dias_totais) / Decimal(total) if total else Decimal("0")
    ).quantize(CENTAVO, rounding=ROUND_HALF_UP)

    valor_base = Decimal(valor_unitario)
    fator_reajuste = Decimal("1") + (Decimal(reajuste_anual_pct) / Decimal("100"))

    parcelas: list[ParcelaProjetada] = []
    for indice in range(total):
        data_planejada = edate(data_inicio, indice * passo)
        if data_planejada > termino and indice > 0:
            break

        aniversarios = (indice * passo) // 12
        valor = valor_base * (fator_reajuste ** aniversarios) if aniversarios else valor_base

        parcelas.append(
            ParcelaProjetada(
                indice=indice,
                data_planejada=data_planejada,
                competencia=data_planejada.replace(day=1),
                valor_previsto=valor.quantize(CENTAVO, rounding=ROUND_HALF_UP),
                quantidade_planejada=total,
                espacamento_dias=espacamento,
            )
        )
    return parcelas


def valor_total_contrato(parcelas: list[ParcelaProjetada]) -> Decimal:
    """Equivale a "Valor ContratoM" = Preço Unitário * NumeroDeMeses,
    porém somando parcela a parcela para suportar reajuste."""
    return sum((p.valor_previsto for p in parcelas), Decimal("0"))


# ---------------------------------------------------------------------------
# Integração com o ORM
# ---------------------------------------------------------------------------

def gerar_parcelas(contrato) -> int:
    """
    Regenera ParcelaPrevista para um contrato. Idempotente: apaga e recria.
    Chamado pelo signal post_save de Contrato.
    Retorna a quantidade de parcelas geradas.
    """
    from apps.contratos.models import ParcelaPrevista, StatusContrato

    contrato.parcelas.all().delete()

    if contrato.status in (StatusContrato.ENCERRADO,):
        return 0

    projecao = projetar(
        data_inicio=contrato.data_inicio,
        data_fim=contrato.data_fim,
        valor_unitario=contrato.valor_unitario,
        frequencia=contrato.frequencia,
        data_rescisao=contrato.data_rescisao,
        reajuste_anual_pct=contrato.reajuste_anual_pct,
    )

    ParcelaPrevista.objects.bulk_create(
        [
            ParcelaPrevista(
                contrato=contrato,
                indice=p.indice,
                competencia=p.competencia,
                data_planejada=p.data_planejada,
                valor_previsto=p.valor_previsto,
                quantidade_planejada=p.quantidade_planejada,
                espacamento_dias=p.espacamento_dias,
            )
            for p in projecao
        ],
        batch_size=500,
    )
    return len(projecao)
