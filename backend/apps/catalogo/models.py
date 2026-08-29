"""
Plano de contas: classificação, categoria e estabelecimento.

Classificação (Essenciais / Bons / Ruins / Custos Operacionais) é tabela e não
enum, porque a regra de negócio exige cadastrar novas.
"""

from django.core.validators import RegexValidator
from django.db import models

from apps.common.models import Base, EscopoWorkspace, TipoLancamento


class Classificacao(EscopoWorkspace):
    """
    Contratos Essenciais, Contratos Bons, Contratos Ruins, Custos Operacionais.
    É tabela, não enum, justamente para permitir cadastro de novas.
    """
    nome = models.CharField(max_length=80)
    descricao = models.TextField(blank=True)
    # Peso usado no score de saúde financeira: essencial=0, bom=1, ruim=-1.
    peso = models.SmallIntegerField(default=0)
    cor = models.CharField(max_length=7, default="#64748b")
    ordem = models.PositiveSmallIntegerField(default=0)
    ativo = models.BooleanField(default=True)

    class Meta:
        ordering = ["ordem", "nome"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "nome"], name="uq_classificacao_nome"
            )
        ]

    def __str__(self):
        return self.nome


class Categoria(EscopoWorkspace):
    nome = models.CharField(max_length=80)
    tipo = models.CharField(max_length=8, choices=TipoLancamento.choices)
    classificacao = models.ForeignKey(
        "catalogo.Classificacao", on_delete=models.PROTECT, related_name="categorias"
    )
    # Categoria que recebe o consolidado das notas fiscais de supermercado.
    consolida_mercado = models.BooleanField(default=False)
    ativo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nome"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "nome", "tipo"], name="uq_categoria_nome_tipo"
            ),
            models.UniqueConstraint(
                fields=["workspace"],
                condition=models.Q(consolida_mercado=True),
                name="uq_categoria_mercado_por_workspace",
            ),
        ]

    def __str__(self):
        return f"{self.nome} ({self.get_tipo_display()})"


class Estabelecimento(EscopoWorkspace):
    codigo = models.PositiveIntegerField(null=True, blank=True)
    nome = models.CharField(max_length=160)
    cnpj = models.CharField(
        max_length=14, blank=True,
        validators=[RegexValidator(r"^\d{14}$", "CNPJ deve ter 14 dígitos")],
    )
    categoria_padrao = models.ForeignKey(
        "catalogo.Categoria", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ["nome"]
        indexes = [models.Index(fields=["workspace", "cnpj"])]

    def __str__(self):
        return self.nome
