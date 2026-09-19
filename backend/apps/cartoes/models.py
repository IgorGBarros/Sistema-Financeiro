"""
Cartão de crédito: compras, parcelas e faturas.

A decisão que sustenta tudo aqui está em docs/CARTAO_DE_CREDITO.md: a despesa
é reconhecida **parcela a parcela, na competência da fatura em que cada uma
cai**. A soma das parcelas de um mês é a fatura. Assim não existe dupla
contagem entre "a compra" e "o pagamento da fatura".
"""

from django.db import models

from apps.common.models import Base, EscopoWorkspace


class Bandeira(models.TextChoices):
    VISA = "VISA", "Visa"
    MASTERCARD = "MASTERCARD", "Mastercard"
    ELO = "ELO", "Elo"
    AMEX = "AMEX", "American Express"
    HIPERCARD = "HIPERCARD", "Hipercard"
    OUTRA = "OUTRA", "Outra"


class Cartao(EscopoWorkspace):
    apelido = models.CharField(max_length=80)
    bandeira = models.CharField(max_length=12, choices=Bandeira.choices, default=Bandeira.OUTRA)
    ultimos_digitos = models.CharField(max_length=4, blank=True)
    emissor = models.CharField(max_length=80, blank=True)
    limite = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)

    # Definem em qual fatura cada compra cai. Compra feita depois do
    # fechamento vai para a fatura seguinte — é a regra que mais gera
    # "achei que ia cair esse mês".
    dia_fechamento = models.PositiveSmallIntegerField(default=1)
    dia_vencimento = models.PositiveSmallIntegerField(default=10)

    # Cartão adicional aponta para o titular: as compras entram na mesma
    # fatura, mas dá para saber de quem foi o gasto.
    cartao_titular = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="adicionais"
    )
    ativo = models.BooleanField(default=True)

    class Meta:
        ordering = ["apelido"]

    def __str__(self):
        final = f" ••{self.ultimos_digitos}" if self.ultimos_digitos else ""
        return f"{self.apelido}{final}"


class Compra(EscopoWorkspace):
    """
    Uma compra no cartão. Pode nascer de um cupom escaneado ou de uma linha da
    fatura que não tinha cupom.
    """

    nota = models.ForeignKey(
        "fiscal.NotaFiscal", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="compras",
    )
    cartao = models.ForeignKey(Cartao, on_delete=models.PROTECT, related_name="compras")
    estabelecimento = models.ForeignKey(
        "catalogo.Estabelecimento", on_delete=models.PROTECT, related_name="compras"
    )
    categoria = models.ForeignKey(
        "catalogo.Categoria", on_delete=models.PROTECT, related_name="compras"
    )
    descricao = models.CharField(max_length=200)
    data_compra = models.DateField()
    valor_total = models.DecimalField(max_digits=14, decimal_places=2)
    parcelas_total = models.PositiveSmallIntegerField(default=1)
    observacao = models.TextField(blank=True)

    class Meta:
        ordering = ["-data_compra"]
        indexes = [models.Index(fields=["workspace", "data_compra"])]

    def __str__(self):
        sufixo = f" em {self.parcelas_total}x" if self.parcelas_total > 1 else ""
        return f"{self.descricao}{sufixo}"


class ParcelaCompra(Base):
    """
    Previsão de desembolso de uma parcela.

    Mesmo papel de ParcelaPrevista para contratos: derivada da compra, regerada
    por signal, nunca editada à mão.
    """

    compra = models.ForeignKey(Compra, on_delete=models.CASCADE, related_name="parcelas")
    numero = models.PositiveSmallIntegerField()
    competencia = models.DateField()  # mês da fatura em que cai
    valor = models.DecimalField(max_digits=14, decimal_places=2)
    conciliada_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["competencia", "numero"]
        constraints = [
            models.UniqueConstraint(fields=["compra", "numero"], name="uq_parcela_compra")
        ]
        indexes = [models.Index(fields=["competencia"])]

    def __str__(self):
        return f"{self.compra.descricao} {self.numero}/{self.compra.parcelas_total}"


class StatusFatura(models.TextChoices):
    ABERTA = "ABERTA", "Aberta"
    FECHADA = "FECHADA", "Fechada"
    PAGA = "PAGA", "Paga"


class Fatura(EscopoWorkspace):
    """
    Uma fatura importada.

    **Não gera despesa.** Serve de conferência: o total informado é comparado
    com a soma das parcelas daquela competência. Divergiu, algo escapou da
    conciliação e o sistema avisa em vez de silenciosamente errar o mês.
    """

    cartao = models.ForeignKey(Cartao, on_delete=models.CASCADE, related_name="faturas")
    documento = models.ForeignKey(
        "documentos.Documento", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="faturas",
    )
    competencia = models.DateField()
    data_vencimento = models.DateField()
    valor_total_informado = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(
        max_length=8, choices=StatusFatura.choices, default=StatusFatura.FECHADA
    )

    class Meta:
        ordering = ["-competencia"]
        constraints = [
            models.UniqueConstraint(
                fields=["cartao", "competencia"], name="uq_fatura_cartao_competencia"
            )
        ]

    def __str__(self):
        return f"{self.cartao} — {self.competencia:%m/%Y}"


class SecaoFatura(models.TextChoices):
    CORRENTE = "CORRENTE", "Fatura corrente"
    FUTURA = "FUTURA", "Parcela de fatura futura"


class LancamentoFatura(Base):
    """Uma linha do PDF da fatura, com o resultado da conciliação."""

    fatura = models.ForeignKey(Fatura, on_delete=models.CASCADE, related_name="lancamentos")
    descricao_original = models.CharField(max_length=255)
    descricao = models.CharField(max_length=255)
    data_compra = models.DateField(null=True, blank=True)
    valor = models.DecimalField(max_digits=14, decimal_places=2)
    parcela_atual = models.PositiveSmallIntegerField(null=True, blank=True)
    parcela_total = models.PositiveSmallIntegerField(null=True, blank=True)
    secao = models.CharField(
        max_length=8, choices=SecaoFatura.choices, default=SecaoFatura.CORRENTE
    )

    parcela_compra = models.OneToOneField(
        ParcelaCompra, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="lancamento",
    )
    estabelecimento = models.ForeignKey(
        "catalogo.Estabelecimento", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="lancamentos_fatura",
    )
    categoria = models.ForeignKey(
        "catalogo.Categoria", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="lancamentos_fatura",
    )
    # Como a linha foi casada, para a tela saber o que destacar para revisão.
    metodo_conciliacao = models.CharField(max_length=20, blank=True)

    class Meta:
        ordering = ["data_compra", "id"]
        indexes = [models.Index(fields=["fatura", "secao"])]

    def __str__(self):
        return f"{self.descricao} — {self.valor}"
