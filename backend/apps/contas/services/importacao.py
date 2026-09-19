"""
Importa a conta de consumo e confirma o realizado do mês.

Diferente do holerite, esta importação **cria Realizado**: a conta de luz já
existe como contrato mensal previsto, e a conta importada é justamente a
confirmação do que foi cobrado naquela competência.
"""

from __future__ import annotations

from decimal import Decimal

from django.db import transaction

from apps.documentos.models import Documento


def _dec(valor):
    return Decimal(str(valor)) if valor not in (None, "") else None


@transaction.atomic
def processar_conta(documento: Documento):
    from apps.catalogo.models import Categoria
    from apps.common.models import OrigemLancamento, TipoLancamento
    from apps.contas.models import ContaConsumo, ItemContaConsumo, UnidadeConsumidora
    from apps.realizados.models import Realizado

    metadados = documento.extracao.get("metadados", {})
    servico = metadados.get("servico", "ENERGIA")

    unidade, _ = UnidadeConsumidora.objects.get_or_create(
        workspace=documento.workspace,
        servico=servico,
        codigo_cliente=metadados.get("codigo_cliente") or "sem-codigo",
        defaults={
            "concessionaria": documento.emitente,
            "apelido": documento.emitente or dict(
                ENERGIA="Energia", AGUA="Água", GAS="Gás"
            ).get(servico, servico),
        },
    )

    conta, _ = ContaConsumo.objects.update_or_create(
        workspace=documento.workspace,
        unidade=unidade,
        competencia=documento.competencia,
        defaults={
            "documento": documento,
            "vencimento": documento.vencimento,
            "valor_total": documento.valor_total or Decimal("0"),
            "consumo": _dec(metadados.get("consumo_kwh")),
            "leitura_anterior": _dec(metadados.get("leitura_anterior")),
            "leitura_atual": _dec(metadados.get("leitura_atual")),
            "dias_faturados": metadados.get("dias_faturados") or None,
        },
    )

    conta.itens.all().delete()
    ItemContaConsumo.objects.bulk_create([
        ItemContaConsumo(
            conta=conta,
            descricao=linha.descricao[:160],
            valor=linha.valor,
            detalhes=linha.extras,
        )
        for linha in documento.linhas.all()
    ])

    # A conta confirma o realizado do mês. Se a unidade estiver ligada a um
    # contrato, o realizado herda a categoria dele; senão, cai na categoria
    # do serviço.
    contrato = unidade.contrato
    categoria = contrato.categoria if contrato else Categoria.objects.filter(
        workspace=documento.workspace,
        tipo=TipoLancamento.DESPESA,
        nome__iexact={"ENERGIA": "Luz", "AGUA": "Água", "GAS": "Gás"}.get(servico, "Luz"),
    ).first()

    if categoria and conta.valor_total:
        realizado, _ = Realizado.objects.update_or_create(
            workspace=documento.workspace,
            categoria=categoria,
            competencia=conta.competencia,
            origem=OrigemLancamento.IMPORTACAO,
            defaults={
                "contrato": contrato,
                "descricao": str(unidade),
                "tipo": TipoLancamento.DESPESA,
                "data_pagamento": conta.vencimento or conta.competencia,
                "valor": conta.valor_total,
                "observacao": (
                    f"Consumo de {conta.consumo} unidades." if conta.consumo else ""
                ),
            },
        )
        conta.realizado = realizado
        conta.save(update_fields=["realizado", "atualizado_em"])

    return {
        "conta": str(conta.id),
        "competencia": conta.competencia.isoformat(),
        "valor": str(conta.valor_total),
        "consumo": str(conta.consumo) if conta.consumo else None,
        "tarifa_media": str(conta.tarifa_media) if conta.tarifa_media else None,
        "realizado_criado": conta.realizado_id is not None,
    }
