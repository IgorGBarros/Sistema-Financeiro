"""
Tabela Entrada e Saída — os contratos previstos — e sua projeção mês a mês.

A projeção (ParcelaPrevista) é sempre derivada do contrato, nunca editada à
mão. Regras em apps/contratos/services/projecao.py.
"""

from django.core.validators import MinValueValidator
from django.db import models

from apps.common.models import Base, EscopoWorkspace, OrigemLancamento, TipoLancamento


class Frequencia(models.TextChoices):
    MENSAL = "M", "Mensal"
    BIMESTRAL = "B", "Bimestral"
    TRIMESTRAL = "T", "Trimestral"
    SEMESTRAL = "S", "Semestral"
    ANUAL = "A", "Anual"
    UNICA = "U", "Única"

    @property
    def passo_meses(self) -> int:
        return {"M": 1, "B": 2, "T": 3, "S": 6, "A": 12, "U": 0}[self.value]


PASSO_MESES = {"M": 1, "B": 2, "T": 3, "S": 6, "A": 12, "U": 0}


class StatusContrato(models.TextChoices):
    ATIVO = "ATIVO", "Ativo"
    SUSPENSO = "SUSPENSO", "Suspenso"
    RESCINDIDO = "RESCINDIDO", "Rescindido"
    ENCERRADO = "ENCERRADO", "Encerrado"


class TipoConta(models.TextChoices):
    FIXO = "FIXO", "Fixo"
    VARIAVEL = "VARIAVEL", "Variável"


class TipoRegistro(models.TextChoices):
    CONTRATO_FECHADO = "CONTRATO_FECHADO", "Contrato fechado"
    PREVISAO = "PREVISAO", "Previsão"
    RECORRENCIA = "RECORRENCIA", "Recorrência sem contrato"


class Contrato(EscopoWorkspace):
    """
    Tabela Entrada e Saída. Cada linha é uma receita ou despesa com vigência
    (data_inicio → data_fim), a partir da qual a projeção é gerada.
    """
    numero = models.PositiveIntegerField(null=True, blank=True)
    estabelecimento = models.ForeignKey(
        "catalogo.Estabelecimento", on_delete=models.PROTECT, related_name="contratos"
    )
    descricao = models.CharField(max_length=200)
    tipo = models.CharField(max_length=8, choices=TipoLancamento.choices)
    categoria = models.ForeignKey(
        "catalogo.Categoria", on_delete=models.PROTECT, related_name="contratos"
    )
    # Redundante em relação a categoria.classificacao de propósito: permite
    # reclassificar um contrato específico sem mexer na categoria inteira.
    classificacao = models.ForeignKey(
        "catalogo.Classificacao", on_delete=models.PROTECT, related_name="contratos"
    )

    valor_unitario = models.DecimalField(
        max_digits=14, decimal_places=2, validators=[MinValueValidator(0)],
        help_text="Sempre positivo. O sinal vem de `tipo`.",
    )
    frequencia = models.CharField(
        max_length=1, choices=Frequencia.choices, default=Frequencia.MENSAL
    )
    reajuste_anual_pct = models.DecimalField(
        max_digits=6, decimal_places=3, default=0,
        help_text="% aplicado a cada 12 meses na projeção (0 = sem reajuste).",
    )

    data_inicio = models.DateField()
    data_fim = models.DateField()
    data_rescisao = models.DateField(
        null=True, blank=True,
        help_text="Se preenchida, corta a projeção nesta data.",
    )

    status = models.CharField(
        max_length=12, choices=StatusContrato.choices, default=StatusContrato.ATIVO
    )
    tipo_registro = models.CharField(
        max_length=20, choices=TipoRegistro.choices,
        default=TipoRegistro.CONTRATO_FECHADO,
    )
    tipo_conta = models.CharField(
        max_length=10, choices=TipoConta.choices, default=TipoConta.FIXO
    )
    forma_pagamento = models.CharField(max_length=60, blank=True)
    origem = models.CharField(
        max_length=12, choices=OrigemLancamento.choices, default=OrigemLancamento.MANUAL
    )
    observacao = models.TextField(blank=True)

    class Meta:
        ordering = ["tipo", "descricao"]
        constraints = [
            # Django 5.0 usa `check=`; a partir do 5.1 o nome passou a ser
            # `condition=`. Mantido `check=` para casar com a versão fixada
            # no requirements.txt.
            models.CheckConstraint(
                check=models.Q(data_fim__gte=models.F("data_inicio")),
                name="ck_contrato_periodo_valido",
            ),
        ]
        indexes = [
            models.Index(fields=["workspace", "tipo", "status"]),
            models.Index(fields=["workspace", "data_inicio", "data_fim"]),
        ]

    def __str__(self):
        return f"{self.descricao} — {self.estabelecimento}"

    @property
    def sinal(self) -> int:
        return 1 if self.tipo == TipoLancamento.RECEITA else -1

    @property
    def data_termino_efetiva(self):
        if self.data_rescisao and self.data_rescisao < self.data_fim:
            return self.data_rescisao
        return self.data_fim


class ParcelaPrevista(Base):
    """
    Materialização da projeção — equivale à tabela calculada
    'Contrato_Guarda-Chuva Futuros' do Power BI.

    Regerada por core.services.projecao.gerar_parcelas(contrato) sempre que o
    contrato é salvo. Guardar em tabela (em vez de calcular na hora) permite
    indexar por competência e cruzar com o realizado em SQL.
    """
    contrato = models.ForeignKey(
        "contratos.Contrato", on_delete=models.CASCADE, related_name="parcelas"
    )
    indice = models.PositiveSmallIntegerField()          # [Value] do GENERATESERIES
    competencia = models.DateField()                     # dia 1 do mês
    data_planejada = models.DateField()                  # EDATE(inicio, indice)
    valor_previsto = models.DecimalField(max_digits=14, decimal_places=2)
    quantidade_planejada = models.PositiveSmallIntegerField()  # total de parcelas
    espacamento_dias = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )

    class Meta:
        ordering = ["data_planejada"]
        constraints = [
            models.UniqueConstraint(
                fields=["contrato", "indice"], name="uq_parcela_contrato_indice"
            )
        ]
        indexes = [models.Index(fields=["competencia"])]

    def __str__(self):
        return f"{self.contrato.descricao} {self.competencia:%m/%Y}"
