"""
Contas de consumo: luz, água, gás.

O que distingue estas contas de uma despesa qualquer é o **consumo**. O valor
já viria do extrato; a leitura do medidor, não.

Isso muda a pergunta que o sistema responde. Sem consumo, "a luz subiu" é uma
frase sobre o valor. Com consumo, dá para separar as duas causas — gastei mais
energia, ou a tarifa aumentou — que pedem reações opostas.
"""

from django.db import models

from apps.common.models import Base, EscopoWorkspace


class TipoServico(models.TextChoices):
    ENERGIA = "ENERGIA", "Energia elétrica"
    AGUA = "AGUA", "Água e esgoto"
    GAS = "GAS", "Gás encanado"


class UnidadeConsumidora(EscopoWorkspace):
    servico = models.CharField(max_length=8, choices=TipoServico.choices)
    codigo_cliente = models.CharField(max_length=40)
    apelido = models.CharField(max_length=80, blank=True)
    concessionaria = models.CharField(max_length=80, blank=True)
    endereco = models.CharField(max_length=200, blank=True)
    # A conta de luz normalmente já existe como contrato mensal previsto.
    # A conta importada confirma o realizado daquele mês.
    contrato = models.ForeignKey(
        "contratos.Contrato", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="unidades_consumidoras",
    )

    class Meta:
        ordering = ["servico", "apelido"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "servico", "codigo_cliente"],
                name="uq_unidade_consumidora",
            )
        ]

    def __str__(self):
        return self.apelido or f"{self.get_servico_display()} {self.codigo_cliente}"


class ContaConsumo(EscopoWorkspace):
    unidade = models.ForeignKey(
        UnidadeConsumidora, on_delete=models.CASCADE, related_name="contas"
    )
    documento = models.ForeignKey(
        "documentos.Documento", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="contas_consumo",
    )
    competencia = models.DateField()
    vencimento = models.DateField(null=True, blank=True)
    valor_total = models.DecimalField(max_digits=14, decimal_places=2)

    consumo = models.DecimalField(
        max_digits=12, decimal_places=3, null=True, blank=True,
        help_text="kWh para energia, m³ para água e gás.",
    )
    leitura_anterior = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    leitura_atual = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    dias_faturados = models.PositiveSmallIntegerField(null=True, blank=True)

    realizado = models.OneToOneField(
        "realizados.Realizado", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="conta_consumo",
    )

    class Meta:
        ordering = ["-competencia"]
        constraints = [
            models.UniqueConstraint(
                fields=["unidade", "competencia"], name="uq_conta_unidade_competencia"
            )
        ]

    def __str__(self):
        return f"{self.unidade} — {self.competencia:%m/%Y}"

    @property
    def tarifa_media(self):
        """
        Custo por unidade consumida.

        É o número que separa "gastei mais" de "ficou mais caro". Sem ele, as
        duas coisas parecem a mesma na conta.
        """
        if not self.consumo:
            return None
        return (self.valor_total / self.consumo).quantize(__import__("decimal").Decimal("0.000001"))


class ItemContaConsumo(Base):
    conta = models.ForeignKey(ContaConsumo, on_delete=models.CASCADE, related_name="itens")
    descricao = models.CharField(max_length=160)
    valor = models.DecimalField(max_digits=14, decimal_places=2)
    detalhes = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return self.descricao
