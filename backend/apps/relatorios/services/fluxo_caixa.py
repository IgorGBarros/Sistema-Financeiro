"""
Fluxo de caixa: previsto x realizado por competência, saldo acumulado e
projeção futura.

É o equivalente às medidas do Power BI, mas resolvido em SQL agregado —
uma query por série, não uma varredura em Python.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db.models import DecimalField, F, Sum, Value
from django.db.models.functions import Coalesce

from apps.common.datas import hoje_local


ZERO = Decimal("0")


def _somatorio_por_competencia(queryset, campo_valor: str) -> dict:
    """Devolve {(competencia, tipo): total}."""
    linhas = (
        queryset.values("competencia", "tipo")
        .annotate(total=Coalesce(Sum(campo_valor), Value(ZERO), output_field=DecimalField()))
    )
    return {(l["competencia"], l["tipo"]): l["total"] for l in linhas}


def _somar(destino: dict, origem: dict) -> None:
    for chave, valor in origem.items():
        destino[chave] = destino.get(chave, ZERO) + valor


def _previsto_cartao(workspace, inicio: date, fim: date) -> dict:
    """
    Parcelas de compras no cartão, por competência da fatura.

    A soma das parcelas de um mês é a fatura daquele mês — por isso a fatura
    em si não vira lançamento. Contar as duas coisas seria contar o mesmo
    dinheiro duas vezes.
    """
    from apps.cartoes.models import ParcelaCompra
    from apps.common.models import TipoLancamento

    linhas = (
        ParcelaCompra.objects.filter(
            compra__workspace=workspace,
            competencia__gte=inicio,
            competencia__lte=fim,
        )
        .values("competencia")
        .annotate(total=Coalesce(Sum("valor"), Value(ZERO), output_field=DecimalField()))
    )
    return {(l["competencia"], TipoLancamento.DESPESA): l["total"] for l in linhas}


def _previsto_financiamento(workspace, inicio: date, fim: date) -> dict:
    """
    Parcelas do financiamento ainda não pagas, com o valor real do banco.

    Só as não pagas: uma parcela marcada como Paga no demonstrativo já é
    realizado, e entraria em duplicidade se contasse como previsão.
    """
    from apps.common.models import TipoLancamento
    from apps.financiamento.models import ParcelaFinanciamento

    linhas = (
        ParcelaFinanciamento.objects.filter(
            financiamento__workspace=workspace,
            financiamento__paga_do_proprio_bolso=True,
            competencia__gte=inicio,
            competencia__lte=fim,
        )
        .exclude(situacao="PAGA")
        .values("competencia")
        .annotate(
            total=Coalesce(Sum("valor_total"), Value(ZERO), output_field=DecimalField())
        )
    )
    return {(l["competencia"], TipoLancamento.DESPESA): l["total"] for l in linhas}


def fluxo_mensal(
    workspace,
    *,
    inicio: date,
    fim: date,
    classificacoes: list | None = None,
    categorias: list | None = None,
    saldo_inicial: Decimal = ZERO,
) -> list[dict]:
    """
    Uma linha por mês com receita/despesa previstas e realizadas, resultado e
    saldo acumulado. `fim` pode estar no futuro — os meses sem realizado vêm
    apenas com o previsto, que é exatamente a projeção.
    """
    from apps.common.models import TipoLancamento
    from apps.contratos.models import ParcelaPrevista, StatusContrato
    from apps.realizados.models import Realizado

    inicio = inicio.replace(day=1)
    fim = fim.replace(day=1)

    previstas = (
        ParcelaPrevista.objects.filter(
            contrato__workspace=workspace,
            competencia__gte=inicio,
            competencia__lte=fim,
        )
        .exclude(contrato__status=StatusContrato.ENCERRADO)
        .annotate(tipo=F("contrato__tipo"))
    )
    realizados = Realizado.objects.filter(
        workspace=workspace, competencia__gte=inicio, competencia__lte=fim
    )

    if classificacoes:
        previstas = previstas.filter(contrato__classificacao__in=classificacoes)
        realizados = realizados.filter(categoria__classificacao__in=classificacoes)
    if categorias:
        previstas = previstas.filter(contrato__categoria__in=categorias)
        realizados = realizados.filter(categoria__in=categorias)

    mapa_previsto = _somatorio_por_competencia(previstas, "valor_previsto")
    mapa_realizado = _somatorio_por_competencia(realizados, "valor")

    # Cartão de crédito e financiamento têm projeção própria, e ela não passa
    # por ParcelaPrevista: a do cartão vem das compras parceladas, a do
    # financiamento vem do demonstrativo do banco. Somar aqui é o que faz o
    # saldo do mês refletir o desembolso de verdade.
    if not classificacoes and not categorias:
        _somar(mapa_previsto, _previsto_cartao(workspace, inicio, fim))
        _somar(mapa_previsto, _previsto_financiamento(workspace, inicio, fim))

    resultado: list[dict] = []
    saldo = Decimal(saldo_inicial)
    competencia = inicio
    hoje = hoje_local().replace(day=1)

    while competencia <= fim:
        rec_prev = mapa_previsto.get((competencia, TipoLancamento.RECEITA), ZERO)
        des_prev = mapa_previsto.get((competencia, TipoLancamento.DESPESA), ZERO)
        rec_real = mapa_realizado.get((competencia, TipoLancamento.RECEITA), ZERO)
        des_real = mapa_realizado.get((competencia, TipoLancamento.DESPESA), ZERO)

        futuro = competencia > hoje
        # Meses passados usam o realizado; meses futuros usam o previsto.
        rec_efetiva = rec_prev if futuro else (rec_real or rec_prev)
        des_efetiva = des_prev if futuro else (des_real or des_prev)
        saldo += rec_efetiva - des_efetiva

        resultado.append({
            "competencia": competencia,
            "receita_prevista": rec_prev,
            "despesa_prevista": des_prev,
            "resultado_previsto": rec_prev - des_prev,
            "receita_realizada": rec_real,
            "despesa_realizada": des_real,
            "resultado_realizado": rec_real - des_real,
            "desvio_receita": rec_real - rec_prev,
            "desvio_despesa": des_real - des_prev,
            "saldo_acumulado": saldo,
            "projetado": futuro,
        })

        competencia = (
            date(competencia.year + 1, 1, 1)
            if competencia.month == 12
            else date(competencia.year, competencia.month + 1, 1)
        )

    return resultado


def aderencia_por_contrato(workspace, *, competencia: date) -> list[dict]:
    """
    Previsto x realizado contrato a contrato num mês. É onde aparece o contrato
    que foi cobrado a mais, o que não foi pago e o que ficou órfão de previsão.
    """
    from apps.contratos.models import ParcelaPrevista
    from apps.realizados.models import Realizado

    competencia = competencia.replace(day=1)

    previstas = (
        ParcelaPrevista.objects.filter(
            contrato__workspace=workspace, competencia=competencia
        )
        .select_related("contrato", "contrato__categoria", "contrato__classificacao")
    )
    realizados = (
        Realizado.objects.filter(workspace=workspace, competencia=competencia)
        .values("contrato_id")
        .annotate(total=Sum("valor"))
    )
    mapa_real = {r["contrato_id"]: r["total"] for r in realizados}

    linhas = []
    for parcela in previstas:
        realizado = mapa_real.pop(parcela.contrato_id, ZERO)
        previsto = parcela.valor_previsto
        linhas.append({
            "contrato_id": str(parcela.contrato_id),
            "descricao": parcela.contrato.descricao,
            "categoria": parcela.contrato.categoria.nome,
            "classificacao": parcela.contrato.classificacao.nome,
            "tipo": parcela.contrato.tipo,
            "previsto": previsto,
            "realizado": realizado,
            "desvio": realizado - previsto,
            "desvio_pct": (
                ((realizado - previsto) / previsto * 100).quantize(Decimal("0.01"))
                if previsto else None
            ),
            "situacao": (
                "nao_pago" if realizado == ZERO
                else "ok" if realizado == previsto
                else "acima" if realizado > previsto
                else "abaixo"
            ),
        })

    # Realizados sem previsão nenhuma — despesa que apareceu do nada.
    for contrato_id, total in mapa_real.items():
        linhas.append({
            "contrato_id": str(contrato_id) if contrato_id else None,
            "descricao": "Lançamento sem previsão",
            "categoria": None,
            "classificacao": None,
            "tipo": None,
            "previsto": ZERO,
            "realizado": total,
            "desvio": total,
            "desvio_pct": None,
            "situacao": "sem_previsao",
        })

    return sorted(linhas, key=lambda l: abs(l["desvio"]), reverse=True)


def resumo_por_classificacao(workspace, *, inicio: date, fim: date) -> list[dict]:
    """
    Quanto pesa cada classificação (Essenciais / Bons / Ruins / Operacionais)
    no período. É a leitura que responde "onde dá para cortar".
    """
    from apps.common.models import TipoLancamento
    from apps.contratos.models import ParcelaPrevista

    linhas = (
        ParcelaPrevista.objects.filter(
            contrato__workspace=workspace,
            competencia__gte=inicio.replace(day=1),
            competencia__lte=fim.replace(day=1),
            contrato__tipo=TipoLancamento.DESPESA,
        )
        .values(
            "contrato__classificacao__nome",
            "contrato__classificacao__cor",
            "contrato__classificacao__peso",
        )
        .annotate(total=Sum("valor_previsto"))
        .order_by("-total")
    )

    total_geral = sum((l["total"] for l in linhas), ZERO) or ZERO
    return [
        {
            "classificacao": l["contrato__classificacao__nome"],
            "cor": l["contrato__classificacao__cor"],
            "peso": l["contrato__classificacao__peso"],
            "total": l["total"],
            "percentual": (
                (l["total"] / total_geral * 100).quantize(Decimal("0.01"))
                if total_geral else ZERO
            ),
        }
        for l in linhas
    ]
