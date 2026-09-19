"""
Blocos de construção compartilhados por todos os apps.

Ficam aqui só coisas que qualquer domínio usaria. Se algo só serve a um app,
o lugar dele é dentro daquele app — `common` que vira depósito é como um
projeto modular volta a ser um monólito com passos extras.
"""

import uuid

from django.db import models


class TipoLancamento(models.TextChoices):
    RECEITA = "RECEITA", "Entrada — Receita"
    DESPESA = "DESPESA", "Saída — Despesa"


class OrigemLancamento(models.TextChoices):
    MANUAL = "MANUAL", "Manual"
    MERCADO = "MERCADO", "Consolidado do mercado (NFC-e)"
    IMPORTACAO = "IMPORTACAO", "Importação de planilha"
    OFX = "OFX", "Extrato bancário"


class Base(models.Model):
    """UUID como PK: não vaza volume de dados e não colide entre ambientes."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class EscopoWorkspace(Base):
    """
    Toda tabela de negócio herda daqui. O workspace é a fronteira de
    isolamento: nenhuma query de API pode atravessá-la.
    """

    workspace = models.ForeignKey(
        "accounts.Workspace", on_delete=models.CASCADE, related_name="+"
    )

    class Meta:
        abstract = True
