"""
Importa o DDC para o domínio.

Reimportar é a operação normal, não a exceção: o banco reemite o demonstrativo
a cada mês, e a cada emissão mais parcelas mudaram de Projetada para Paga.
Por isso o processamento é um `update_or_create` por número de parcela, e não
um insert.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from django.db import models, transaction
from django.utils import timezone

from apps.documentos.models import Documento

logger = logging.getLogger(__name__)

SITUACOES = {
    "Paga": "PAGA",
    "Aberta": "ABERTA",
    "Projetada": "PROJETADA",
    "Vencida": "VENCIDA",
    "Atraso": "VENCIDA",
}


def _dec(valor) -> Decimal:
    return Decimal(str(valor or "0"))


@transaction.atomic
def processar_financiamento(documento: Documento):
    from apps.catalogo.models import Categoria
    from apps.financiamento.models import Financiamento, ParcelaFinanciamento

    metadados = documento.extracao.get("metadados", {})
    numero_contrato = metadados.get("numero_contrato") or documento.referencia

    categoria = (
        Categoria.objects.filter(
            workspace=documento.workspace, nome__iexact="Financiamento"
        ).first()
        or Categoria.objects.filter(
            workspace=documento.workspace, tipo="DESPESA"
        ).order_by("nome").first()
    )
    if categoria is None:
        raise ValueError(
            "O workspace não tem nenhuma categoria de despesa. "
            "Rode 'preparar_ambiente' antes de importar."
        )

    financiamento, _ = Financiamento.objects.update_or_create(
        workspace=documento.workspace,
        numero_contrato=numero_contrato,
        defaults={
            "instituicao": documento.emitente,
            "titular": documento.titular,
            "categoria": categoria,
            "sistema_amortizacao": metadados.get("sistema_amortizacao") or "OUTRO",
            "prazo_total": metadados.get("prazo_total"),
            "taxa_juros_anual": metadados.get("taxa_juros_anual") or "",
            "data_ultima_parcela": documento.vencimento,
            "documento": documento,
            "atualizado_pelo_documento_em": timezone.now(),
        },
    )

    criadas = atualizadas = 0
    for linha in documento.linhas.all():
        extras = linha.extras
        numero = int(extras.get("numero", 0))
        if not numero or not linha.data:
            continue

        _, foi_criada = ParcelaFinanciamento.objects.update_or_create(
            financiamento=financiamento,
            numero=numero,
            defaults={
                "competencia": linha.data.replace(day=1),
                "vencimento": linha.data,
                "valor_total": linha.valor,
                "situacao": SITUACOES.get(extras.get("situacao"), "PROJETADA"),
                "amortizacao": _dec(extras.get("amortizacao")),
                "juros": _dec(extras.get("juros")),
                "seguro_mip": _dec(extras.get("seguro_mip")),
                "seguro_dfi": _dec(extras.get("seguro_dfi")),
                "taxa_administracao": _dec(extras.get("tca")),
                # Multa, mora e ajuste são custos eventuais. Somados num campo
                # só porque separá-los não muda nenhuma decisão.
                "encargos": (
                    _dec(extras.get("multa"))
                    + _dec(extras.get("mora"))
                    + _dec(extras.get("ajuste_financeiro"))
                ),
                "saldo_devedor": _dec(extras.get("saldo_devedor")),
            },
        )
        criadas += foi_criada
        atualizadas += not foi_criada

    return {
        "financiamento": str(financiamento.id),
        "numero_contrato": numero_contrato,
        "parcelas_criadas": criadas,
        "parcelas_atualizadas": atualizadas,
        "duplicidades": detectar_duplicidade(financiamento),
    }


def detectar_duplicidade(financiamento) -> list[dict]:
    """
    Procura contratos que representem o mesmo financiamento.

    É a armadilha número um desta importação. Quem já cadastrava o
    financiamento como contrato de valor fixo passa a ter as duas coisas
    projetando o mesmo desembolso, e o fluxo de caixa dobra a parcela sem
    dar nenhum sinal.

    Detectar e avisar, nunca apagar sozinho: o contrato pode ter histórico de
    realizados vinculados, e sumir com ele silenciosamente seria pior que a
    duplicidade. A decisão fica com a pessoa, em /financiamentos/{id}/duplicidades/.
    """
    from apps.contratos.models import Contrato

    competencias = set(
        financiamento.parcelas.exclude(situacao="PAGA").values_list(
            "competencia", flat=True
        )
    )
    if not competencias:
        return []

    candidatos = Contrato.objects.filter(
        workspace=financiamento.workspace,
        tipo="DESPESA",
        status="ATIVO",
    ).filter(
        models.Q(descricao__icontains="financiamento")
        | models.Q(categoria=financiamento.categoria)
    )

    achados = []
    for contrato in candidatos:
        sobrepostas = contrato.parcelas.filter(competencia__in=competencias).count()
        if sobrepostas == 0:
            continue
        achados.append({
            "contrato": str(contrato.id),
            "descricao": contrato.descricao,
            "valor_mensal": str(contrato.valor_unitario),
            "meses_sobrepostos": sobrepostas,
            "sugestao": (
                "Suspenda ou encerre este contrato: o financiamento importado "
                "já projeta estes meses com o valor real do banco."
            ),
        })
    return achados
