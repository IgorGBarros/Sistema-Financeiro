"""
Documentos financeiros importados de PDF.

Um único lugar para todo PDF que vira dado: fatura de cartão, conta de luz,
demonstrativo de financiamento, holerite. O que muda entre eles é o extrator,
não o ciclo de vida.

Guardar o documento importado, e não só o resultado, resolve três coisas:

1. **Idempotência.** O hash do arquivo impede que o mesmo PDF entre duas vezes
   — mesma ideia da chave de acesso no cupom fiscal.
2. **Reprocessamento.** Quando o parser melhorar, os documentos antigos são
   reprocessados sem pedir os arquivos de novo.
3. **Auditoria.** Dá para responder "de onde veio este número" apontando o
   documento e a linha.
"""

from django.conf import settings
from django.db import models

from apps.common.models import Base, EscopoWorkspace


class TipoDocumento(models.TextChoices):
    FATURA_CARTAO = "FATURA_CARTAO", "Fatura de cartão de crédito"
    CONTA_CONSUMO = "CONTA_CONSUMO", "Conta de consumo (luz, água, gás)"
    FINANCIAMENTO = "FINANCIAMENTO", "Demonstrativo de financiamento"
    HOLERITE = "HOLERITE", "Holerite"
    DESCONHECIDO = "DESCONHECIDO", "Não reconhecido"


class StatusDocumento(models.TextChoices):
    EXTRAIDO = "EXTRAIDO", "Extraído, aguardando processamento"
    PROCESSADO = "PROCESSADO", "Processado"
    ERRO = "ERRO", "Erro na extração"
    IGNORADO = "IGNORADO", "Ignorado pelo usuário"


class Documento(EscopoWorkspace):
    nome_arquivo = models.CharField(max_length=255)
    # sha256 do arquivo. Único por workspace: reenviar o mesmo PDF não duplica.
    arquivo_hash = models.CharField(max_length=64)
    tipo = models.CharField(
        max_length=20, choices=TipoDocumento.choices, default=TipoDocumento.DESCONHECIDO
    )
    status = models.CharField(
        max_length=12, choices=StatusDocumento.choices, default=StatusDocumento.EXTRAIDO
    )

    referencia = models.CharField(max_length=120, blank=True)
    competencia = models.DateField(null=True, blank=True)
    vencimento = models.DateField(null=True, blank=True)
    valor_total = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    emitente = models.CharField(max_length=200, blank=True)
    titular = models.CharField(max_length=200, blank=True)

    # Extração completa, como o extrator devolveu. É o que permite
    # reprocessar sem o arquivo original.
    extracao = models.JSONField(default=dict, blank=True)
    # Avisos do extrator: conferência que não fechou, campo não encontrado.
    # Nunca esvaziado automaticamente — some quando o documento é reprocessado.
    avisos = models.JSONField(default=list, blank=True)
    erro = models.TextField(blank=True)

    importado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    processado_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-competencia", "-criado_em"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "arquivo_hash"], name="uq_documento_hash"
            )
        ]
        indexes = [
            models.Index(fields=["workspace", "tipo", "competencia"]),
            models.Index(fields=["workspace", "status"]),
        ]

    def __str__(self):
        return f"{self.get_tipo_display()} — {self.referencia or self.nome_arquivo}"

    @property
    def tem_avisos(self) -> bool:
        return bool(self.avisos)


class LinhaDocumento(Base):
    """
    Uma linha do documento, como o extrator entendeu.

    Fica separada do resultado de domínio de propósito: a linha é o que o PDF
    dizia, e o lançamento é o que decidimos que ela significa. Quando os dois
    divergem, dá para ver onde a interpretação entrou.
    """

    documento = models.ForeignKey(Documento, on_delete=models.CASCADE, related_name="linhas")
    ordem = models.PositiveIntegerField()
    descricao = models.CharField(max_length=255)
    valor = models.DecimalField(max_digits=14, decimal_places=2)
    data = models.DateField(null=True, blank=True)
    extras = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["documento", "ordem"]
        constraints = [
            models.UniqueConstraint(fields=["documento", "ordem"], name="uq_linha_ordem")
        ]

    def __str__(self):
        return f"{self.descricao} — {self.valor}"
