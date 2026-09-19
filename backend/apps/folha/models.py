"""
Folha de pagamento — receita, isolada de propósito.

Por que este app não alimenta o fluxo de caixa ainda
----------------------------------------------------
Você pediu para manter a receita separada até vermos como o resto se comporta.
Concordo, e há um motivo técnico além do pedido.

A receita do salário já existe no sistema como contrato previsto. Ligar o
holerite direto no `Realizado` sem antes conferir criaria duas fontes para a
mesma entrada, e o valor cadastrado no contrato **não bate** com o holerite —
a planilha original tem salário de R$ 5.543 e o recibo mostra líquido de
R$ 6.493,77. Integrar antes de resolver essa divergência transformaria um
dado errado em dois.

O ponto de integração já existe e está marcado abaixo. Quando decidirmos, é
uma função.

O que o holerite entrega além do valor
--------------------------------------
Verba a verba. Isso permite responder coisas que o valor líquido esconde:
quanto foi para o INSS no ano, se o vale-transporte está sendo descontado
indevidamente, qual a base de FGTS. O líquido é um número; o holerite é a
explicação dele.
"""

from django.db import models

from apps.common.models import Base, EscopoWorkspace


class TipoFolha(models.TextChoices):
    MENSAL = "MENSAL", "Folha mensal"
    DECIMO_TERCEIRO_ADIANTAMENTO = "DECIMO_TERCEIRO_ADIANTAMENTO", "13º — adiantamento"
    DECIMO_TERCEIRO_INTEGRAL = "DECIMO_TERCEIRO_INTEGRAL", "13º — integral"
    FERIAS = "FERIAS", "Férias"
    RESCISAO = "RESCISAO", "Rescisão"


class Empregador(EscopoWorkspace):
    razao_social = models.CharField(max_length=200)
    cnpj = models.CharField(max_length=14, blank=True)

    class Meta:
        ordering = ["razao_social"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "cnpj"], name="uq_empregador_cnpj",
                condition=models.Q(cnpj__gt=""),
            )
        ]

    def __str__(self):
        return self.razao_social


class Holerite(EscopoWorkspace):
    empregador = models.ForeignKey(
        Empregador, on_delete=models.PROTECT, related_name="holerites"
    )
    documento = models.ForeignKey(
        "documentos.Documento", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="holerites",
    )
    funcionario = models.CharField(max_length=160, blank=True)
    competencia = models.DateField()
    tipo_folha = models.CharField(
        max_length=32, choices=TipoFolha.choices, default=TipoFolha.MENSAL
    )

    total_vencimentos = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_descontos = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    valor_liquido = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    salario_base = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    base_inss = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    base_fgts = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    fgts_mes = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)

    # A extração se auto-confere: soma das verbas contra o líquido impresso.
    # False significa que alguma verba foi classificada errado — o valor não
    # deve ser usado sem revisão.
    conferencia_ok = models.BooleanField(default=False)

    # --- Ponto de integração com o fluxo de caixa ---------------------------
    # Preencher este campo é o que liga o holerite à receita realizada.
    # Enquanto for nulo, a folha vive isolada e o fluxo usa o contrato.
    realizado = models.OneToOneField(
        "realizados.Realizado", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="holerite",
    )

    class Meta:
        ordering = ["-competencia"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "empregador", "competencia", "tipo_folha"],
                name="uq_holerite_competencia",
            )
        ]
        indexes = [models.Index(fields=["workspace", "competencia"])]

    def __str__(self):
        return f"{self.get_tipo_folha_display()} {self.competencia:%m/%Y}"

    @property
    def integrado(self) -> bool:
        return self.realizado_id is not None


class NaturezaVerba(models.TextChoices):
    VENCIMENTO = "VENCIMENTO", "Vencimento"
    DESCONTO = "DESCONTO", "Desconto"


class Verba(Base):
    holerite = models.ForeignKey(Holerite, on_delete=models.CASCADE, related_name="verbas")
    codigo = models.CharField(max_length=10, blank=True)
    descricao = models.CharField(max_length=120)
    referencia = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="Dias, percentual ou quantidade — depende da verba.",
    )
    valor = models.DecimalField(max_digits=14, decimal_places=2)
    natureza = models.CharField(max_length=10, choices=NaturezaVerba.choices)

    class Meta:
        ordering = ["natureza", "codigo"]

    def __str__(self):
        return f"{self.descricao} — {self.valor}"
