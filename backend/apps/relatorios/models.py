from django.core.validators import MinValueValidator
from django.db import models

from apps.common.models import EscopoWorkspace


class MetaOrcamentaria(EscopoWorkspace):
    """Teto de gasto mensal por categoria, definido pelo usuário."""
    categoria = models.ForeignKey(
        "catalogo.Categoria", on_delete=models.CASCADE, related_name="metas"
    )
    teto = models.DecimalField(
        max_digits=14, decimal_places=2, validators=[MinValueValidator(0)]
    )

    class Meta:
        ordering = ["categoria__nome"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "categoria"],
                name="uq_meta_categoria",
            )
        ]

    def __str__(self):
        return f"Meta {self.categoria} — {self.teto}"
