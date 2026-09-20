"""
Diagnóstico financeiro para o turnaround.

Calcula indicadores a partir dos dados já existentes (contratos, realizados,
cartões). Não recebe request — recebe workspace e devolve um dict com os
números. Isso permite chamar o mesmo serviço da API, do assistente e de testes.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db.models import Sum
from django.db.models.functions import Coalesce

from apps.common.datas import hoje_local
from apps.common.models import TipoLancamento

ZERO = Decimal("0")


def _somar_parcelas(workspace, tipo: str, inicio: date, fim: date) -> Decimal:
    from apps.contratos.models import ParcelaPrevista, StatusContrato

    qs = ParcelaPrevista.objects.filter(
        contrato__workspace=workspace,
        contrato__status=StatusContrato.ATIVO,
        contrato__tipo=tipo,
        competencia__gte=inicio,
        competencia__lte=fim,
    )
    resultado = qs.aggregate(total=Coalesce(Sum("valor_previsto"), ZERO))
    return resultado["total"]


def _renda_mensal_media(workspace) -> Decimal:
    """Média das parcelas de receita dos últimos 3 meses."""
    hoje = hoje_local()
    inicio = date(hoje.year, hoje.month, 1)
    if inicio.month > 3:
        inicio = date(inicio.year, inicio.month - 3, 1)
    else:
        inicio = date(inicio.year - 1, 12 + inicio.month - 3, 1)
    fim = date(hoje.year, hoje.month, 1)
    total = _somar_parcelas(workspace, TipoLancamento.RECEITA, inicio, fim)
    meses = 3
    return total / meses if meses else ZERO


def _despesa_mensal_media(workspace) -> Decimal:
    """Média das despesas previstas dos próximos 3 meses."""
    hoje = hoje_local()
    inicio = date(hoje.year, hoje.month, 1)
    # próximos 3 meses
    if inicio.month <= 9:
        fim = date(inicio.year, inicio.month + 3, 1)
    else:
        fim = date(inicio.year + 1, inicio.month + 3 - 12, 1)
    total = _somar_parcelas(workspace, TipoLancamento.DESPESA, inicio, fim)
    return total / 3 if total else ZERO


def _divida_total(workspace) -> Decimal:
    """Soma de todas as parcelas de despesa futuras de contratos ativos."""
    from apps.contratos.models import ParcelaPrevista, StatusContrato

    hoje = hoje_local().replace(day=1)
    qs = ParcelaPrevista.objects.filter(
        contrato__workspace=workspace,
        contrato__status=StatusContrato.ATIVO,
        contrato__tipo=TipoLancamento.DESPESA,
        competencia__gte=hoje,
    )
    resultado = qs.aggregate(total=Coalesce(Sum("valor_previsto"), ZERO))
    return resultado["total"]


def _comprometimento_pct(renda: Decimal, despesa: Decimal) -> Decimal:
    if not renda:
        return Decimal("100")
    return (despesa / renda * 100).quantize(Decimal("0.1"))


def _score_saude(comprometimento: Decimal, tem_plano_ativo: bool) -> int:
    """
    Score simples de 0 a 100:
    - comprometimento < 50% → 80-100
    - 50–70% → 50–79
    - 70–90% → 20–49
    - > 90% → 0–19
    """
    if comprometimento <= 30:
        base = 95
    elif comprometimento <= 50:
        base = 75
    elif comprometimento <= 70:
        base = 50
    elif comprometimento <= 90:
        base = 25
    else:
        base = 5
    bonus = 5 if tem_plano_ativo else 0
    return min(100, base + bonus)


def _projecao_3_meses(workspace, saldo_inicial: Decimal = ZERO) -> list[dict]:
    """Projeção mês a mês para os próximos 3 meses."""
    hoje = hoje_local()
    meses = []
    saldo = saldo_inicial
    for delta in range(3):
        mes = hoje.month + delta
        ano = hoje.year
        if mes > 12:
            mes -= 12
            ano += 1
        inicio = date(ano, mes, 1)
        fim = inicio

        receita = _somar_parcelas(workspace, TipoLancamento.RECEITA, inicio, fim)
        despesa = _somar_parcelas(workspace, TipoLancamento.DESPESA, inicio, fim)
        saldo = saldo + receita - despesa
        meses.append({
            "competencia": inicio.isoformat(),
            "receita": str(receita),
            "despesa": str(despesa),
            "saldo": str(saldo),
        })
    return meses


def diagnosticar(workspace, saldo_atual: Decimal = ZERO) -> dict:
    """
    Ponto de entrada do diagnóstico. Recebe workspace e saldo atual e devolve
    todos os indicadores necessários para a tela de turnaround.
    """
    from apps.turnaround.models import PlanoTurnaround, StatusPlano

    renda = _renda_mensal_media(workspace)
    despesa = _despesa_mensal_media(workspace)
    comprometimento = _comprometimento_pct(renda, despesa)
    divida = _divida_total(workspace)

    tem_plano_ativo = PlanoTurnaround.objects.filter(
        workspace=workspace, status=StatusPlano.ATIVO
    ).exists()

    score = _score_saude(comprometimento, tem_plano_ativo)
    projecao = _projecao_3_meses(workspace, saldo_atual)

    # Indicador de semáforo baseado no comprometimento
    if comprometimento <= 50:
        semaforo = "verde"
    elif comprometimento <= 75:
        semaforo = "amarelo"
    else:
        semaforo = "vermelho"

    return {
        "renda_mensal_media": str(renda),
        "despesa_mensal_media": str(despesa),
        "comprometimento_pct": str(comprometimento),
        "divida_total": str(divida),
        "score_saude": score,
        "semaforo": semaforo,
        "tem_plano_ativo": tem_plano_ativo,
        "projecao_3_meses": projecao,
        "regras": {
            "comprometimento_meta": "30",
            "limite_vermelho": "75",
            "limite_amarelo": "50",
        },
    }
