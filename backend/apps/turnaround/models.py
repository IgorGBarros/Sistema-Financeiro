"""
Turnaround Pessoal — Recuperação Financeira.

O plano de turnaround não é um relatório gerado automaticamente. É um contrato
que a pessoa faz consigo mesma: "a partir de hoje, qualquer contrato classificado
como RUIM entra no radar de eliminação e nenhum crédito novo é contratado sem
passar pelo filtro ESSENCIAL/BOM/RUIM."

A classificação não substitui a categoria (que é estrutural). Ela é uma camada
de prioridade sobreposta durante o período de recuperação.
"""

from django.db import models

from apps.common.models import Base, EscopoWorkspace


class StatusPlano(models.TextChoices):
    RASCUNHO = "RASCUNHO", "Rascunho"
    ATIVO = "ATIVO", "Em execução"
    CONCLUIDO = "CONCLUIDO", "Concluído"
    PAUSADO = "PAUSADO", "Pausado"


class TipoClassificacao(models.TextChoices):
    ESSENCIAL = "ESSENCIAL", "Essencial — mantém a vida funcionando, nunca cortar"
    BOM = "BOM", "Bom — aumenta previsibilidade ou capacidade produtiva"
    RUIM = "RUIM", "Ruim — juros altos, consumo emocional ou sem retorno"


class PlanoTurnaround(EscopoWorkspace):
    """
    O plano de recuperação financeira. Só um plano por workspace pode estar
    ATIVO ao mesmo tempo — a constraint de negócio fica no serializer.
    """
    nome = models.CharField(max_length=120)
    status = models.CharField(
        max_length=10, choices=StatusPlano.choices, default=StatusPlano.RASCUNHO
    )
    data_inicio = models.DateField()
    meta_saldo = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        help_text="Saldo alvo ao término do plano.",
    )
    meta_comprometimento_pct = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
        help_text="% da renda comprometida com dívidas — meta a atingir (ex.: 30).",
    )
    observacao = models.TextField(blank=True)

    class Meta:
        ordering = ["-criado_em"]

    def __str__(self):
        return f"{self.nome} ({self.status})"


class ClassificacaoContrato(EscopoWorkspace):
    """
    Classificação de um contrato dentro do turnaround.

    ESSENCIAL: proteger, nunca cortar.
    BOM: manter e monitorar.
    RUIM: eliminar ou renegociar — alvo prioritário.
    """
    plano = models.ForeignKey(
        PlanoTurnaround,
        on_delete=models.CASCADE,
        related_name="classificacoes",
    )
    contrato = models.ForeignKey(
        "contratos.Contrato",
        on_delete=models.CASCADE,
        related_name="classificacoes_turnaround",
    )
    tipo = models.CharField(max_length=10, choices=TipoClassificacao.choices)
    justificativa = models.TextField(blank=True)

    class Meta:
        ordering = ["tipo", "contrato__descricao"]
        constraints = [
            models.UniqueConstraint(
                fields=["plano", "contrato"],
                name="uq_classificacao_plano_contrato",
            )
        ]

    def __str__(self):
        return f"{self.contrato.descricao} → {self.tipo}"
