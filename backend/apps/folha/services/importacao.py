"""
Importa o holerite.

Deliberadamente **não** cria Realizado. A folha vive isolada até decidirmos
como conciliar com o contrato de salário previsto — ver a documentação em
apps/folha/models.py.
"""

from __future__ import annotations

from decimal import Decimal

from django.db import transaction

from apps.documentos.models import Documento


def _dec(valor) -> Decimal:
    return Decimal(str(valor or "0"))


@transaction.atomic
def processar_holerite(documento: Documento):
    from apps.folha.models import Empregador, Holerite, Verba

    metadados = documento.extracao.get("metadados", {})

    empregador, _ = Empregador.objects.get_or_create(
        workspace=documento.workspace,
        cnpj=documento.documento_emitente if hasattr(documento, "documento_emitente") else
             (documento.extracao.get("documento_emitente") or ""),
        defaults={"razao_social": documento.emitente or "Empregador"},
    )
    if documento.emitente and empregador.razao_social != documento.emitente:
        empregador.razao_social = documento.emitente
        empregador.save(update_fields=["razao_social"])

    holerite, _ = Holerite.objects.update_or_create(
        workspace=documento.workspace,
        empregador=empregador,
        competencia=documento.competencia,
        tipo_folha=metadados.get("tipo_folha", "MENSAL"),
        defaults={
            "documento": documento,
            "funcionario": documento.titular,
            "total_vencimentos": _dec(metadados.get("total_vencimentos")),
            "total_descontos": _dec(metadados.get("total_descontos")),
            "valor_liquido": _dec(metadados.get("valor_liquido")),
            "salario_base": _dec(metadados.get("salario_base")) or None,
            "base_inss": _dec(metadados.get("base_inss")) or None,
            "base_fgts": _dec(metadados.get("base_fgts")) or None,
            "fgts_mes": _dec(metadados.get("fgts_mes")) or None,
            "conferencia_ok": bool(metadados.get("conferencia_ok")),
        },
    )

    holerite.verbas.all().delete()
    Verba.objects.bulk_create([
        Verba(
            holerite=holerite,
            codigo=linha.extras.get("codigo", "")[:10],
            descricao=linha.descricao[:120],
            referencia=_dec(linha.extras.get("referencia")) or None,
            valor=linha.valor,
            natureza=linha.extras.get("natureza", "VENCIMENTO"),
        )
        for linha in documento.linhas.all()
    ])

    return {
        "holerite": str(holerite.id),
        "competencia": holerite.competencia.isoformat(),
        "tipo": holerite.tipo_folha,
        "liquido": str(holerite.valor_liquido),
        "conferencia_ok": holerite.conferencia_ok,
        "verbas": holerite.verbas.count(),
        "integrado_ao_fluxo": False,
    }
