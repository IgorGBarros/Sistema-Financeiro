"""
Handler de exceções do DRF.

Objetivo: toda falha sair no mesmo formato, com mensagem que uma pessoa
consegue ler. O frontend depende disso para decidir entre mostrar erro no
campo ou no topo do formulário.

    {"detail": "...", "campos": {"data_fim": ["..."]}, "codigo": "validacao"}
"""

import logging

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as handler_padrao

logger = logging.getLogger(__name__)


def exception_handler(exc, context):
    resposta = handler_padrao(exc, context)

    if resposta is not None:
        dados = resposta.data
        campos = {}
        detalhe = "Não foi possível concluir a operação."

        if isinstance(dados, dict):
            detalhe = str(dados.get("detail", detalhe))
            campos = {k: v for k, v in dados.items() if k != "detail"}
            if campos and "detail" not in dados:
                primeiro = next(iter(campos.values()))
                if isinstance(primeiro, list) and primeiro:
                    detalhe = str(primeiro[0])
        elif isinstance(dados, list) and dados:
            detalhe = str(dados[0])

        resposta.data = {
            "detail": detalhe,
            "campos": campos,
            "codigo": getattr(exc, "default_code", "erro"),
        }
        return resposta

    # Exceções que o DRF não converte sozinho.
    if isinstance(exc, DjangoValidationError):
        return Response(
            {
                "detail": "; ".join(exc.messages),
                "campos": getattr(exc, "message_dict", {}),
                "codigo": "validacao",
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    if isinstance(exc, IntegrityError):
        # Constraint do banco: a mensagem crua expõe nome de tabela e índice.
        logger.warning("IntegrityError em %s: %s", context.get("view"), exc)
        return Response(
            {
                "detail": "Este registro conflita com um já existente.",
                "campos": {},
                "codigo": "conflito",
            },
            status=status.HTTP_409_CONFLICT,
        )

    return None
