"""
Importação de documento: do PDF ao domínio.

Fluxo em duas etapas, e a separação é intencional:

    1. EXTRAIR    lê o PDF, grava Documento + LinhaDocumento
    2. PROCESSAR  interpreta as linhas e cria os objetos de domínio

Extrair sem processar é útil: dá para ver o que o parser entendeu antes de
deixar qualquer coisa entrar no fluxo de caixa. É o que o `--simular` do
comando faz.

E processar sem extrair também: quando um parser melhora, os documentos
antigos são reprocessados a partir do que já está gravado, sem pedir os PDFs
de novo.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import asdict
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.documentos.models import Documento, LinhaDocumento, StatusDocumento
from apps.documentos.services.base import ErroExtracao, Extracao, extrair as extrair_pdf

logger = logging.getLogger(__name__)


def hash_arquivo(conteudo: bytes) -> str:
    return hashlib.sha256(conteudo).hexdigest()


def _serializar(extracao: Extracao) -> dict:
    dados = asdict(extracao)
    # Decimal e date não são serializáveis em JSON.
    return _converter(dados)


def _converter(valor):
    if isinstance(valor, Decimal):
        return str(valor)
    if isinstance(valor, date):
        return valor.isoformat()
    if isinstance(valor, dict):
        return {k: _converter(v) for k, v in valor.items()}
    if isinstance(valor, list):
        return [_converter(v) for v in valor]
    return valor


@transaction.atomic
def extrair_documento(
    *,
    workspace,
    conteudo: bytes,
    nome_arquivo: str,
    senha: str | None = None,
    tipo: str | None = None,
    usuario=None,
) -> tuple[Documento, bool]:
    """
    Etapa 1. Idempotente pelo hash do arquivo: reenviar o mesmo PDF devolve o
    documento existente em vez de duplicar.
    """
    digest = hash_arquivo(conteudo)
    existente = Documento.objects.filter(
        workspace=workspace, arquivo_hash=digest
    ).first()
    if existente and existente.status != StatusDocumento.ERRO:
        return existente, False

    documento = existente or Documento(
        workspace=workspace, arquivo_hash=digest, nome_arquivo=nome_arquivo
    )
    documento.nome_arquivo = nome_arquivo
    documento.importado_por = usuario

    try:
        extracao = extrair_pdf(conteudo, senha=senha, tipo=tipo)
    except ErroExtracao as exc:
        documento.status = StatusDocumento.ERRO
        documento.erro = str(exc)
        documento.save()
        return documento, True

    documento.tipo = extracao.tipo
    documento.referencia = extracao.referencia[:120]
    documento.competencia = extracao.competencia
    documento.vencimento = extracao.vencimento
    documento.valor_total = extracao.valor_total
    documento.emitente = extracao.emitente[:200]
    documento.titular = extracao.titular[:200]
    documento.extracao = _serializar(extracao)
    documento.avisos = extracao.avisos
    documento.status = StatusDocumento.EXTRAIDO
    documento.erro = ""
    documento.save()

    documento.linhas.all().delete()
    LinhaDocumento.objects.bulk_create(
        [
            LinhaDocumento(
                documento=documento,
                ordem=ordem,
                descricao=linha.descricao[:255],
                valor=linha.valor,
                data=linha.data,
                extras=_converter(linha.extras),
            )
            for ordem, linha in enumerate(extracao.linhas)
        ],
        batch_size=500,
    )
    return documento, True


def processar_documento(documento: Documento):
    """
    Etapa 2. Despacha para o app de domínio conforme o tipo.

    Cada processador é responsável por ser idempotente: processar duas vezes o
    mesmo documento não pode duplicar nada.
    """
    from apps.cartoes.services.importacao import processar_fatura
    from apps.contas.services.importacao import processar_conta
    from apps.financiamento.services.importacao import processar_financiamento
    from apps.folha.services.importacao import processar_holerite

    processadores = {
        "FATURA_CARTAO": processar_fatura,
        "CONTA_CONSUMO": processar_conta,
        "FINANCIAMENTO": processar_financiamento,
        "HOLERITE": processar_holerite,
    }

    processador = processadores.get(documento.tipo)
    if processador is None:
        raise ErroExtracao(
            f"Não há processador para documentos do tipo '{documento.tipo}'."
        )

    resultado = processador(documento)

    documento.status = StatusDocumento.PROCESSADO
    documento.processado_em = timezone.now()
    documento.save(update_fields=["status", "processado_em", "atualizado_em"])
    return resultado


def importar(
    *,
    workspace,
    conteudo: bytes,
    nome_arquivo: str,
    senha: str | None = None,
    tipo: str | None = None,
    usuario=None,
    processar: bool = True,
):
    """Extração e processamento numa chamada, para o caso comum."""
    documento, criado = extrair_documento(
        workspace=workspace,
        conteudo=conteudo,
        nome_arquivo=nome_arquivo,
        senha=senha,
        tipo=tipo,
        usuario=usuario,
    )
    if documento.status == StatusDocumento.ERRO or not processar:
        return documento, None
    return documento, processar_documento(documento)
