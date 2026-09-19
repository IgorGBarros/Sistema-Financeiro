"""
Registro dos extratores.

Importar este pacote registra todos. A ordem aqui não importa — o registro
ordena por prioridade, do mais específico ao mais genérico.
"""

from apps.documentos.services.extratores import (  # noqa: F401
    conta_consumo,
    fatura_cartao,
    financiamento,
    holerite,
)
