"""
Ponte entre a Tabela Mercado e a Tabela Entrada e Saída.

Regra: "nessa Tabela tem que vir as informações da Tabela Mercado consolidada
no mês — o total, data, categoria etc."

Como isso funciona aqui:

  NotaFiscal (N cupons no mês)
        │  soma por competência
        ▼
  vw_mercado_consolidado (materialized view — leitura/relatório)
        │
        ▼
  Realizado (1 linha por mês, origem=MERCADO, categoria marcada com
             consolida_mercado=True)
        │  compara por competência
        ▼
  ParcelaPrevista do contrato "Alimentação" (previsto)

Ou seja: o mercado entra no fluxo de caixa como UM lançamento realizado por
mês, não como 40 cupons soltos. O detalhe fica preservado nas notas para quem
quiser abrir. A constraint uq_realizado_mercado_mes garante uma linha por mês.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Sum


def _fim_do_mes(competencia: date) -> date:
    import calendar
    ultimo = calendar.monthrange(competencia.year, competencia.month)[1]
    return competencia.replace(day=ultimo)


def resumo_mercado_do_mes(workspace, competencia: date) -> dict:
    """Soma dos cupons de um mês. Não depende da materialized view —
    serve para o cálculo em tempo real logo após um scan."""
    from apps.fiscal.models import NotaFiscal, StatusNota

    inicio = competencia.replace(day=1)
    fim = _fim_do_mes(inicio)

    agregado = NotaFiscal.objects.filter(
        workspace=workspace,
        status=StatusNota.IMPORTADA,
        data_emissao__date__gte=inicio,
        data_emissao__date__lte=fim,
    ).aggregate(
        total=Sum("valor_total"),
        notas=Count("id"),
        itens=Sum("quantidade_itens"),
    )

    total = agregado["total"] or Decimal("0")
    notas = agregado["notas"] or 0
    return {
        "competencia": inicio,
        "valor_total": total,
        "quantidade_notas": notas,
        "quantidade_itens": agregado["itens"] or 0,
        "ticket_medio": (total / notas).quantize(Decimal("0.01")) if notas else Decimal("0"),
    }


def consolidado_via_orm(workspace, *, inicio=None, fim=None) -> list[dict]:
    """
    Mesmo resultado da materialized view, calculado com GROUP BY no ORM.
    Usado onde a view não existe (SQLite em desenvolvimento) e como rede de
    segurança se o REFRESH atrasar.
    """
    from django.db.models.functions import TruncMonth

    from apps.fiscal.models import NotaFiscal, StatusNota

    consulta = NotaFiscal.objects.filter(
        workspace=workspace, status=StatusNota.IMPORTADA, data_emissao__isnull=False
    )
    if inicio:
        consulta = consulta.filter(data_emissao__date__gte=inicio)
    if fim:
        consulta = consulta.filter(data_emissao__date__lte=fim)

    linhas = (
        consulta.annotate(mes=TruncMonth("data_emissao"))
        .values("mes")
        .annotate(
            quantidade_notas=Count("id"),
            quantidade_itens=Sum("quantidade_itens"),
            total=Sum("valor_total"),
        )
        .order_by("-mes")
    )

    resultado = []
    for linha in linhas:
        notas = linha["quantidade_notas"] or 0
        total = linha["total"] or Decimal("0")
        resultado.append({
            "competencia": linha["mes"].date().replace(day=1),
            "quantidade_notas": notas,
            "quantidade_itens": linha["quantidade_itens"] or 0,
            "valor_total": total,
            "ticket_medio": (
                (total / notas).quantize(Decimal("0.01")) if notas else Decimal("0")
            ),
        })
    return resultado


def categoria_mercado(workspace):
    from apps.catalogo.models import Categoria
    return Categoria.objects.filter(
        workspace=workspace, consolida_mercado=True
    ).first()


@transaction.atomic
def sincronizar_mercado_do_mes(workspace, competencia: date):
    """
    Cria/atualiza o Realizado consolidado do mês. Chamado após cada importação
    de nota — o valor do mês corrente vai subindo conforme os cupons entram.
    """
    from apps.common.models import OrigemLancamento, TipoLancamento
    from apps.contratos.models import Contrato, ParcelaPrevista
    from apps.realizados.models import Realizado

    categoria = categoria_mercado(workspace)
    if categoria is None:
        # Sem categoria marcada, o consolidado não tem onde entrar.
        return None

    competencia = competencia.replace(day=1)
    resumo = resumo_mercado_do_mes(workspace, competencia)

    if resumo["quantidade_notas"] == 0:
        Realizado.objects.filter(
            workspace=workspace,
            origem=OrigemLancamento.MERCADO,
            competencia_mercado=competencia,
        ).delete()
        return None

    contrato = (
        Contrato.objects.filter(workspace=workspace, categoria=categoria)
        .order_by("data_inicio")
        .first()
    )
    parcela = None
    if contrato:
        parcela = ParcelaPrevista.objects.filter(
            contrato=contrato, competencia=competencia
        ).first()

    realizado, _ = Realizado.objects.update_or_create(
        workspace=workspace,
        origem=OrigemLancamento.MERCADO,
        competencia_mercado=competencia,
        defaults={
            "contrato": contrato,
            "parcela": parcela,
            "categoria": categoria,
            "descricao": f"Mercado — {resumo['quantidade_notas']} cupom(ns)",
            "tipo": TipoLancamento.DESPESA,
            "competencia": competencia,
            "data_pagamento": _fim_do_mes(competencia),
            "valor": resumo["valor_total"],
            "forma_pagamento": "",
            "observacao": (
                f"Consolidado automático de {resumo['quantidade_notas']} nota(s), "
                f"{resumo['quantidade_itens']} item(ns). "
                f"Ticket médio R$ {resumo['ticket_medio']}."
            ),
        },
    )
    return realizado


def refresh_view_consolidado():
    from django.db import connection
    with connection.cursor() as cursor:
        cursor.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY vw_mercado_consolidado;")
