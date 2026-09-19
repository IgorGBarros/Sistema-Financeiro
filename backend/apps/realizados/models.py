"""
O que efetivamente entrou ou saiu.

Comparado com ParcelaPrevista pela competência para medir a aderência entre o
que foi planejado e o que aconteceu.
"""

from django.core.validators import MinValueValidator
from django.db import models

from apps.common.models import EscopoWorkspace, OrigemLancamento, TipoLancamento


class Realizado(EscopoWorkspace):
    """
    O que efetivamente entrou ou saiu. Comparado com ParcelaPrevista pela
    competência para medir aderência do previsto x realizado.
    """
    contrato = models.ForeignKey(
        "contratos.Contrato", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="realizados",
    )
    parcela = models.OneToOneField(
        "contratos.ParcelaPrevista", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="realizado",
    )
    categoria = models.ForeignKey(
        "catalogo.Categoria", on_delete=models.PROTECT, related_name="realizados"
    )
    descricao = models.CharField(max_length=200)
    tipo = models.CharField(max_length=8, choices=TipoLancamento.choices)
    competencia = models.DateField()
    data_pagamento = models.DateField()
    valor = models.DecimalField(
        max_digits=14, decimal_places=2, validators=[MinValueValidator(0)]
    )
    forma_pagamento = models.CharField(max_length=60, blank=True)
    origem = models.CharField(
        max_length=12, choices=OrigemLancamento.choices, default=OrigemLancamento.MANUAL
    )
    # Preenchido quando a linha nasce do consolidado mensal do mercado.
    competencia_mercado = models.DateField(null=True, blank=True)
    observacao = models.TextField(blank=True)

    class Meta:
        ordering = ["-data_pagamento"]
        indexes = [
            models.Index(fields=["workspace", "competencia"]),
            models.Index(fields=["workspace", "tipo", "competencia"]),
        ]
        constraints = [
            # Só pode existir um realizado de mercado por mês por workspace.
            models.UniqueConstraint(
                fields=["workspace", "competencia_mercado"],
                condition=models.Q(origem=OrigemLancamento.MERCADO),
                name="uq_realizado_mercado_mes",
            )
        ]

    def __str__(self):
        return f"{self.descricao} {self.competencia:%m/%Y} — R$ {self.valor}"

    @property
    def sinal(self) -> int:
        return 1 if self.tipo == TipoLancamento.RECEITA else -1
