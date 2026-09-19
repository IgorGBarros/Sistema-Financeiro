"""
Financiamento imobiliário.

Um contrato de financiamento não é um contrato comum do sistema. A diferença
está no valor da parcela:

- contrato comum: valor fixo, projetado por regra (`apps/contratos`)
- financiamento SAC: valor **decrescente**, e o banco já publica a tabela
  inteira no Demonstrativo Descritivo de Crédito

Como o DDC traz o valor exato de cada uma das centenas de parcelas, com a
situação de cada uma, não faz sentido projetar. Importar é melhor que
calcular: o banco sabe o índice de correção que aplicou, nós não.

Medido no DDC real de 296 parcelas: tratar o financiamento como contrato de
valor fixo (R$ 2.090) superestima o desembolso restante em R$ 142.658 — 38%.
A parcela cai de R$ 2.088 hoje para R$ 867 na última.
"""

from django.db import models

from apps.common.models import Base, EscopoWorkspace


class SistemaAmortizacao(models.TextChoices):
    SAC = "SAC", "SAC (parcela decrescente)"
    PRICE = "PRICE", "Price (parcela constante)"
    SACRE = "SACRE", "SACRE (misto)"
    OUTRO = "OUTRO", "Outro"


class Financiamento(EscopoWorkspace):
    numero_contrato = models.CharField(max_length=40)
    instituicao = models.CharField(max_length=80, blank=True)
    titular = models.CharField(max_length=160, blank=True)
    # O financiamento pode estar no nome de outra pessoa e mesmo assim sair do
    # seu bolso. Sem separar titular de quem paga, o fluxo de caixa erra.
    paga_do_proprio_bolso = models.BooleanField(default=True)

    categoria = models.ForeignKey(
        "catalogo.Categoria", on_delete=models.PROTECT, related_name="financiamentos"
    )
    sistema_amortizacao = models.CharField(
        max_length=6, choices=SistemaAmortizacao.choices, default=SistemaAmortizacao.SAC
    )
    prazo_total = models.PositiveSmallIntegerField(null=True, blank=True)
    taxa_juros_anual = models.CharField(max_length=30, blank=True)
    valor_operacao = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    data_ultima_parcela = models.DateField(null=True, blank=True)

    documento = models.ForeignKey(
        "documentos.Documento", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="financiamentos",
    )
    atualizado_pelo_documento_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["numero_contrato"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "numero_contrato"], name="uq_financiamento_contrato"
            )
        ]

    def __str__(self):
        return f"Financiamento {self.numero_contrato}"


class SituacaoParcela(models.TextChoices):
    PAGA = "PAGA", "Paga"
    ABERTA = "ABERTA", "Aberta"
    PROJETADA = "PROJETADA", "Projetada"
    VENCIDA = "VENCIDA", "Vencida"


class ParcelaFinanciamento(Base):
    """
    Uma parcela vinda do DDC.

    A `situacao` do documento é a ponte com o modelo previsto × realizado do
    sistema: PAGA vira realizado, ABERTA e PROJETADA seguem como previsão.
    Um PDF só entrega os dois lados de vinte e cinco anos.
    """

    financiamento = models.ForeignKey(
        Financiamento, on_delete=models.CASCADE, related_name="parcelas"
    )
    numero = models.PositiveSmallIntegerField()
    competencia = models.DateField()
    vencimento = models.DateField()
    valor_total = models.DecimalField(max_digits=14, decimal_places=2)
    situacao = models.CharField(max_length=10, choices=SituacaoParcela.choices)

    # A composição importa: só a amortização reduz a dívida. Juros e seguro
    # são custo. Quem olha só o valor total não vê que, no começo do SAC,
    # a maior parte da parcela é juro.
    amortizacao = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    juros = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    seguro_mip = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    seguro_dfi = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    taxa_administracao = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    encargos = models.DecimalField(
        max_digits=14, decimal_places=2, default=0,
        help_text="Multa, mora e ajuste financeiro somados.",
    )
    saldo_devedor = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        ordering = ["numero"]
        constraints = [
            models.UniqueConstraint(
                fields=["financiamento", "numero"], name="uq_parcela_financiamento"
            )
        ]
        indexes = [models.Index(fields=["competencia", "situacao"])]

    def __str__(self):
        return f"Parcela {self.numero} — {self.vencimento}"

    @property
    def prevista(self) -> bool:
        return self.situacao != SituacaoParcela.PAGA
