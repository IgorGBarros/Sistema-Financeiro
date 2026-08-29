"""
Tabela Mercado — cupons fiscais lidos por QR Code, seus itens e o consolidado
mensal.

A chave de acesso (44 dígitos) é a identidade natural da nota: única por
definição, o que torna o scan idempotente.
"""

from django.conf import settings
from django.core.validators import MinValueValidator, RegexValidator
from django.db import models
from django.utils import timezone

from apps.accounts.models import Workspace
from apps.common.models import Base, EscopoWorkspace


class StatusNota(models.TextChoices):
    PENDENTE = "PENDENTE", "Aguardando consulta na SEFAZ"
    IMPORTADA = "IMPORTADA", "Importada"
    ERRO = "ERRO", "Erro na consulta"
    MANUAL = "MANUAL", "Digitada manualmente"


class NotaFiscal(EscopoWorkspace):
    """Tabela Mercado. Uma linha por cupom fiscal escaneado."""

    chave_acesso = models.CharField(
        max_length=44,
        validators=[RegexValidator(r"^\d{44}$", "Chave de acesso deve ter 44 dígitos")],
    )
    # Campos extraídos da própria chave (sem depender da SEFAZ)
    uf = models.CharField(max_length=2, blank=True)
    modelo = models.CharField(max_length=2, blank=True)          # 65 = NFC-e
    serie = models.CharField(max_length=3, blank=True)
    numero = models.CharField(max_length=9, blank=True)
    cnpj_emitente = models.CharField(max_length=14, blank=True)

    # Campos vindos da consulta SEFAZ
    estabelecimento = models.ForeignKey(
        "catalogo.Estabelecimento", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="notas",
    )
    nome_emitente = models.CharField(max_length=200, blank=True)
    municipio = models.CharField(max_length=120, blank=True)
    data_emissao = models.DateTimeField(null=True, blank=True)
    valor_total = models.DecimalField(
        max_digits=14, decimal_places=2, default=0,
        validators=[MinValueValidator(0)],
    )
    valor_desconto = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    valor_tributos = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    quantidade_itens = models.PositiveIntegerField(default=0)
    forma_pagamento = models.CharField(max_length=60, blank=True)
    protocolo = models.CharField(max_length=30, blank=True)

    categoria = models.ForeignKey(
        "catalogo.Categoria", on_delete=models.PROTECT, related_name="notas", null=True, blank=True
    )
    qr_url = models.TextField(blank=True)
    status = models.CharField(
        max_length=10, choices=StatusNota.choices, default=StatusNota.PENDENTE
    )
    erro_consulta = models.TextField(blank=True)
    payload = models.JSONField(default=dict, blank=True)  # HTML/JSON bruto da SEFAZ
    importado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        ordering = ["-data_emissao"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "chave_acesso"], name="uq_nota_chave"
            )
        ]
        indexes = [
            models.Index(fields=["workspace", "data_emissao"]),
            models.Index(fields=["workspace", "status"]),
        ]

    def __str__(self):
        return f"{self.nome_emitente or self.cnpj_emitente} — R$ {self.valor_total}"

    @property
    def competencia(self):
        if not self.data_emissao:
            return None
        d = timezone.localtime(self.data_emissao).date()
        return d.replace(day=1)


class ItemNotaFiscal(Base):
    nota = models.ForeignKey(
        "fiscal.NotaFiscal", on_delete=models.CASCADE, related_name="itens")
    numero_item = models.PositiveSmallIntegerField()
    codigo = models.CharField(max_length=60, blank=True)   # EAN ou código interno
    descricao = models.CharField(max_length=200)
    quantidade = models.DecimalField(max_digits=12, decimal_places=4, default=1)
    unidade = models.CharField(max_length=10, blank=True)
    valor_unitario = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    valor_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # Subcategoria opcional do produto (Padaria, Laticínios, Limpeza...)
    categoria = models.ForeignKey(
        "catalogo.Categoria", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ["numero_item"]
        constraints = [
            models.UniqueConstraint(fields=["nota", "numero_item"], name="uq_item_nota")
        ]

    def __str__(self):
        return self.descricao


class ConsolidadoMercado(models.Model):
    """
    "Tabela Consolidado — talvez não precise dessa tabela".

    Não precisa como tabela física: é uma MATERIALIZED VIEW no Postgres,
    mapeada aqui como model unmanaged apenas para leitura via ORM/DRF.
    Definição SQL em core/sql/0001_consolidado_mercado.sql.
    Atualize com: python manage.py refresh_consolidado
    """
    id = models.TextField(primary_key=True)          # workspace|competencia
    workspace = models.ForeignKey(
        Workspace, on_delete=models.DO_NOTHING, db_column="workspace_id", related_name="+"
    )
    competencia = models.DateField()
    quantidade_notas = models.IntegerField()
    quantidade_itens = models.IntegerField()
    valor_total = models.DecimalField(max_digits=14, decimal_places=2)
    ticket_medio = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        managed = False
        db_table = "vw_mercado_consolidado"
        ordering = ["-competencia"]
