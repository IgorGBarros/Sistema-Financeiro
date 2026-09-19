"""
Importa a fatura e concilia com as parcelas previstas.

A conciliação é o coração desta feature. Ela responde: esta linha do PDF é a
parcela daquela compra que eu já registrei, ou é uma compra que eu nunca vi?

Regra de ouro: **conciliação automática nunca é silenciosa.** Cada linha
guarda como foi casada, e a tela destaca o que ficou duvidoso. O trabalho da
pessoa é olhar as exceções, não conferir as óbvias.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.documentos.models import Documento

logger = logging.getLogger(__name__)

JANELA_DIAS = 4  # tolerância entre a data da compra e a da parcela prevista


def normalizar(texto: str) -> str:
    """Caixa alta, sem acento e sem ruído — para comparar descrições."""
    sem_acento = unicodedata.normalize("NFKD", texto or "")
    limpo = "".join(c for c in sem_acento if not unicodedata.combining(c))
    return re.sub(r"[^A-Z0-9 ]", " ", limpo.upper()).strip()


def _cartao_para(documento: Documento):
    """
    Descobre a qual cartão a fatura pertence.

    Pelos últimos dígitos quando o PDF os traz; senão, pelo emissor; senão,
    pelo único cartão ativo. Com mais de um cartão e nenhuma pista, falha em
    vez de escolher — lançar a fatura no cartão errado embaralharia a
    conciliação de dois cartões de uma vez.
    """
    from apps.cartoes.models import Cartao

    cartoes = Cartao.objects.filter(workspace=documento.workspace, ativo=True)
    metadados = documento.extracao.get("metadados", {})

    digitos = metadados.get("ultimos_digitos")
    if digitos:
        achado = cartoes.filter(ultimos_digitos=digitos).first()
        if achado:
            return achado

    if documento.emitente:
        achado = cartoes.filter(emissor__icontains=documento.emitente).first()
        if achado:
            return achado

    if cartoes.count() == 1:
        return cartoes.first()

    raise ValueError(
        "Não consegui identificar o cartão desta fatura. Cadastre os últimos "
        "quatro dígitos no cartão, ou informe o cartão na importação."
    )


def _estabelecimento_por_apelido(workspace, descricao: str):
    """Resolve 'REDEMIX SUPERM' para o estabelecimento, via apelidos aprendidos."""
    from apps.catalogo.models import ApelidoEstabelecimento

    alvo = normalizar(descricao)
    if not alvo:
        return None

    for apelido in ApelidoEstabelecimento.objects.filter(
        estabelecimento__workspace=workspace
    ).select_related("estabelecimento"):
        if apelido.texto and apelido.texto in alvo:
            return apelido.estabelecimento
    return None


def _conciliar(workspace, cartao, lancamento) -> tuple[object | None, str]:
    """
    Tenta casar a linha com uma parcela prevista.

    Devolve (parcela, método). Método vazio significa que não casou.
    """
    from apps.cartoes.models import ParcelaCompra

    candidatas = ParcelaCompra.objects.filter(
        compra__workspace=workspace,
        compra__cartao=cartao,
        conciliada_em__isnull=True,
    ).select_related("compra")

    # 1. Valor, número da parcela e data próxima. O mais confiável que temos
    #    sem código de autorização no PDF.
    if lancamento.parcela_atual and lancamento.data_compra:
        exata = candidatas.filter(
            valor=lancamento.valor,
            numero=lancamento.parcela_atual,
            compra__parcelas_total=lancamento.parcela_total,
            compra__data_compra__gte=lancamento.data_compra - timedelta(days=JANELA_DIAS),
            compra__data_compra__lte=lancamento.data_compra + timedelta(days=JANELA_DIAS),
        ).first()
        if exata:
            return exata, "VALOR_PARCELA_DATA"

    # 2. Valor e data, para compras à vista.
    if lancamento.data_compra:
        por_data = candidatas.filter(
            valor=lancamento.valor,
            compra__data_compra__gte=lancamento.data_compra - timedelta(days=JANELA_DIAS),
            compra__data_compra__lte=lancamento.data_compra + timedelta(days=JANELA_DIAS),
        ).first()
        if por_data:
            return por_data, "VALOR_DATA"

    # 3. Valor e estabelecimento, quando o apelido resolve o nome.
    estabelecimento = _estabelecimento_por_apelido(workspace, lancamento.descricao)
    if estabelecimento:
        por_estabelecimento = candidatas.filter(
            valor=lancamento.valor, compra__estabelecimento=estabelecimento
        ).first()
        if por_estabelecimento:
            return por_estabelecimento, "VALOR_ESTABELECIMENTO"

    return None, ""


@transaction.atomic
def processar_fatura(documento: Documento):
    from apps.cartoes.models import (
        Fatura, LancamentoFatura, SecaoFatura, StatusFatura,
    )

    cartao = _cartao_para(documento)
    competencia = documento.competencia or (
        documento.vencimento.replace(day=1) if documento.vencimento else None
    )
    if competencia is None:
        raise ValueError(
            "A fatura não tem competência nem vencimento — não dá para saber "
            "a que mês ela pertence."
        )

    fatura, _ = Fatura.objects.update_or_create(
        workspace=documento.workspace,
        cartao=cartao,
        competencia=competencia,
        defaults={
            "documento": documento,
            "data_vencimento": documento.vencimento or competencia,
            "valor_total_informado": documento.valor_total or Decimal("0"),
            "status": StatusFatura.FECHADA,
        },
    )

    # Reprocessar não pode desfazer conciliação já revisada pela pessoa.
    fatura.lancamentos.filter(parcela_compra__isnull=True).delete()
    ja_conciliados = set(
        fatura.lancamentos.values_list("descricao_original", "valor")
    )

    conciliados = orfaos = 0
    for linha in documento.linhas.all():
        extras = linha.extras
        chave = (extras.get("descricao_original", linha.descricao)[:255], linha.valor)
        if chave in ja_conciliados:
            continue

        lancamento = LancamentoFatura(
            fatura=fatura,
            descricao_original=extras.get("descricao_original", linha.descricao)[:255],
            descricao=linha.descricao[:255],
            data_compra=linha.data,
            valor=linha.valor,
            parcela_atual=extras.get("parcela_atual"),
            parcela_total=extras.get("parcela_total"),
            secao=(
                SecaoFatura.FUTURA
                if extras.get("secao") == "FUTURA"
                else SecaoFatura.CORRENTE
            ),
        )

        # Só a fatura corrente é conciliada. A seção de parcelas futuras é
        # informativa: aquelas parcelas ainda vão aparecer na fatura do mês
        # delas, e conciliar agora as consumiria cedo demais.
        if lancamento.secao == SecaoFatura.CORRENTE:
            parcela, metodo = _conciliar(documento.workspace, cartao, lancamento)
            if parcela:
                lancamento.parcela_compra = parcela
                lancamento.metodo_conciliacao = metodo
                lancamento.estabelecimento = parcela.compra.estabelecimento
                lancamento.categoria = parcela.compra.categoria
                parcela.conciliada_em = timezone.now()
                parcela.save(update_fields=["conciliada_em", "atualizado_em"])
                conciliados += 1
            else:
                lancamento.estabelecimento = _estabelecimento_por_apelido(
                    documento.workspace, lancamento.descricao
                )
                if lancamento.estabelecimento:
                    lancamento.categoria = lancamento.estabelecimento.categoria_padrao
                orfaos += 1

        lancamento.save()

    correntes = fatura.lancamentos.filter(secao=SecaoFatura.CORRENTE)
    soma = sum((l.valor for l in correntes), Decimal("0"))

    divergencia = None
    if fatura.valor_total_informado and abs(soma - fatura.valor_total_informado) > Decimal("0.02"):
        divergencia = str(soma - fatura.valor_total_informado)

    return {
        "fatura": str(fatura.id),
        "cartao": str(cartao),
        "competencia": competencia.isoformat(),
        "lancamentos": correntes.count(),
        "conciliados": conciliados,
        # Linhas sem parcela prevista: compras cujo cupom não foi escaneado.
        # Precisam de categoria antes de virarem despesa.
        "sem_previsao": orfaos,
        "soma_lancamentos": str(soma),
        "total_informado": str(fatura.valor_total_informado),
        "divergencia": divergencia,
    }
