"""
Como a nota foi paga — e o que isso gera.

Este serviço fecha o ciclo que o scan deixava aberto. Antes, o cupom era lido e
virava `NotaFiscal`; ninguém dizia como ele foi pago, e nada entrava no fluxo
de caixa. O resultado era um banco com centenas de notas e **zero realizados**.

O que acontece conforme a forma de pagamento:

    dinheiro, PIX, débito   → Realizado na data da compra
                              o dinheiro saiu da conta naquele dia

    crédito                 → Compra + ParcelaCompra
                              o dinheiro sai na fatura, parcela a parcela

    vale, crédito da loja   → Realizado, mas em categoria própria
                              saiu de um saldo que não é a conta corrente

A NFC-e traz a forma (`tPag`), a bandeira (`tBand`) e o código de autorização
(`cAut`). **Não traz o número de parcelas** — isso o usuário informa. Ver
docs/REGRA_DE_NEGOCIO.md §2.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from django.db import transaction

logger = logging.getLogger(__name__)

# Como o portal da SEFAZ escreve cada forma, normalizado para o nosso enum.
MAPA_SEFAZ = {
    "dinheiro": "DINHEIRO",
    "cheque": "CHEQUE",
    "cartão de crédito": "CREDITO",
    "cartao de credito": "CREDITO",
    "crédito": "CREDITO",
    "cartão de débito": "DEBITO",
    "cartao de debito": "DEBITO",
    "débito": "DEBITO",
    "crédito loja": "CREDITO_LOJA",
    "credito loja": "CREDITO_LOJA",
    "vale alimentação": "VALE_ALIMENTACAO",
    "vale alimentacao": "VALE_ALIMENTACAO",
    "vale refeição": "VALE_REFEICAO",
    "vale refeicao": "VALE_REFEICAO",
    "pix": "PIX",
    "boleto": "BOLETO",
}

# Formas que saem da conta no ato. Crédito é a exceção — sai na fatura.
A_VISTA = {
    "DINHEIRO", "DEBITO", "PIX", "CHEQUE", "BOLETO",
    "VALE_ALIMENTACAO", "VALE_REFEICAO", "CREDITO_LOJA",
}


def forma_a_partir_do_texto(texto: str) -> str:
    """Traduz o que o portal escreveu para a nossa forma de pagamento."""
    normalizado = (texto or "").strip().lower()
    for chave, valor in MAPA_SEFAZ.items():
        if chave in normalizado:
            return valor
    return "OUTRO"


def sugerir_pagamento(nota) -> dict:
    """
    Palpite para a tela de confirmação.

    A forma vem da própria nota. O cartão e o parcelamento vêm do histórico:
    se as últimas compras naquele estabelecimento foram sempre no mesmo cartão
    à vista, sugere isso já preenchido. É o que faz o sistema dar menos
    trabalho com o tempo, em vez de perguntar as mesmas coisas para sempre.
    """
    from apps.cartoes.models import Compra

    forma = forma_a_partir_do_texto(nota.forma_pagamento)
    sugestao = {
        "forma": forma,
        "valor": nota.valor_total,
        "cartao": None,
        "parcelas": 1,
        "categoria": None,
        "origem_da_sugestao": "nota" if forma != "OUTRO" else "nenhuma",
    }

    if nota.estabelecimento_id:
        anterior = (
            Compra.objects.filter(
                workspace=nota.workspace, estabelecimento_id=nota.estabelecimento_id
            )
            .order_by("-data_compra")
            .first()
        )
        if anterior:
            sugestao |= {
                "cartao": str(anterior.cartao_id),
                "parcelas": anterior.parcelas_total,
                "categoria": str(anterior.categoria_id),
                "origem_da_sugestao": "historico",
            }
            if forma == "OUTRO":
                sugestao["forma"] = "CREDITO"
        elif nota.estabelecimento.categoria_padrao_id:
            sugestao["categoria"] = str(nota.estabelecimento.categoria_padrao_id)
            sugestao["origem_da_sugestao"] = "estabelecimento"

    return sugestao


@transaction.atomic
def registrar_pagamento(
    *,
    nota,
    forma: str,
    valor: Decimal | None = None,
    cartao=None,
    parcelas: int = 1,
    categoria=None,
    autorizacao: str = "",
):
    """
    Registra como a nota foi paga e gera o lançamento correspondente.

    Idempotente: chamar de novo para a mesma nota substitui o pagamento
    anterior e o que ele gerou. Sem isso, corrigir "paguei no débito, não no
    crédito" deixaria as duas versões somando.
    """
    from apps.cartoes.models import Compra
    from apps.cartoes.services.parcelamento import gerar_parcelas
    from apps.common.models import OrigemLancamento, TipoLancamento
    from apps.fiscal.models import PagamentoNota
    from apps.realizados.models import Realizado

    valor = Decimal(valor if valor is not None else nota.valor_total)
    categoria = categoria or (
        nota.categoria
        or (nota.estabelecimento.categoria_padrao if nota.estabelecimento else None)
    )
    if categoria is None:
        raise ValueError(
            "A nota precisa de uma categoria para virar despesa. Defina a "
            "categoria padrão do estabelecimento ou informe uma."
        )

    # Limpa o que um pagamento anterior desta nota tenha criado.
    Compra.objects.filter(nota=nota).delete()
    Realizado.objects.filter(
        workspace=nota.workspace,
        origem=OrigemLancamento.MANUAL,
        observacao__contains=f"nota:{nota.id}",
    ).delete()
    nota.pagamentos.all().delete()

    pagamento = PagamentoNota.objects.create(
        nota=nota,
        forma=forma,
        valor=valor,
        cartao=cartao,
        parcelas=max(1, parcelas),
        autorizacao=autorizacao,
        confirmado=True,
    )

    descricao = nota.nome_emitente or (
        nota.estabelecimento.nome if nota.estabelecimento else "Compra"
    )
    data_compra = (
        nota.data_emissao.date() if nota.data_emissao else nota.competencia
    )

    if forma == "CREDITO":
        if cartao is None:
            raise ValueError("Pagamento no crédito precisa de um cartão.")
        compra = Compra.objects.create(
            workspace=nota.workspace,
            nota=nota,
            cartao=cartao,
            estabelecimento=nota.estabelecimento,
            categoria=categoria,
            descricao=descricao[:200],
            data_compra=data_compra,
            valor_total=valor,
            parcelas_total=max(1, parcelas),
        )
        # on_commit do signal não roda em transação de teste; chamar aqui
        # garante as parcelas em qualquer contexto.
        gerar_parcelas(compra)
        return {"pagamento": pagamento, "compra": compra, "realizado": None}

    # À vista: o dinheiro saiu na data da compra.
    realizado = Realizado.objects.create(
        workspace=nota.workspace,
        categoria=categoria,
        descricao=descricao[:200],
        tipo=TipoLancamento.DESPESA,
        competencia=data_compra.replace(day=1),
        data_pagamento=data_compra,
        valor=valor,
        forma_pagamento=pagamento.get_forma_display(),
        origem=OrigemLancamento.MANUAL,
        observacao=f"nota:{nota.id}",
    )
    return {"pagamento": pagamento, "compra": None, "realizado": realizado}


def notas_sem_pagamento(workspace):
    """
    Notas lidas que ninguém disse como foram pagas.

    O scan é propositalmente rápido: lê o QR e salva, sem perguntar nada — a
    pessoa está no caixa. A consequência é esta fila, que precisa ser visível,
    senão as notas se acumulam fora do fluxo de caixa sem ninguém notar.
    """
    from apps.fiscal.models import NotaFiscal, StatusNota

    return (
        NotaFiscal.objects.filter(workspace=workspace, status=StatusNota.IMPORTADA)
        .filter(pagamentos__isnull=True)
        .select_related("estabelecimento", "categoria")
        .order_by("-data_emissao")
    )
