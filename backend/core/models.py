"""
Modelo de dados do sistema financeiro.

Convenções centrais
-------------------
1. Valores são SEMPRE armazenados positivos. O sinal é derivado de `tipo`
   (RECEITA soma, DESPESA subtrai). A planilha original guardava receita como
   número negativo — o importador normaliza isso.
2. `competencia` é sempre o dia 1 do mês (equivalente ao
   Date(YEAR(...), MONTH(...), 1) do DAX). É a chave de junção entre
   Previsto x Realizado.
3. Toda nota fiscal é identificada pela chave de acesso (44 dígitos), que é
   única por definição. Isso torna o scan idempotente: escanear o mesmo cupom
   duas vezes não duplica lançamento.
"""

import uuid

from django.conf import settings
from django.core.validators import MinValueValidator, RegexValidator
from django.db import models
from django.utils import timezone


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class TipoLancamento(models.TextChoices):
    RECEITA = "RECEITA", "Entrada — Receita"
    DESPESA = "DESPESA", "Saída — Despesa"


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


class OrigemLancamento(models.TextChoices):
    MANUAL = "MANUAL", "Manual"
    MERCADO = "MERCADO", "Consolidado do mercado (NFC-e)"
    IMPORTACAO = "IMPORTACAO", "Importação de planilha"
    OFX = "OFX", "Extrato bancário"


class StatusNota(models.TextChoices):
    PENDENTE = "PENDENTE", "Aguardando consulta na SEFAZ"
    IMPORTADA = "IMPORTADA", "Importada"
    ERRO = "ERRO", "Erro na consulta"
    MANUAL = "MANUAL", "Digitada manualmente"


# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------

class Base(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Workspace(Base):
    """Isola os dados por usuário/família. Toda query do DRF filtra por aqui."""
    nome = models.CharField(max_length=120)
    membros = models.ManyToManyField(
        settings.AUTH_USER_MODEL, related_name="workspaces", blank=True
    )

    def __str__(self):
        return self.nome


class EscopoWorkspace(Base):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="+")

    class Meta:
        abstract = True


# ---------------------------------------------------------------------------
# Classificação e Categoria — o usuário cadastra novas livremente
# ---------------------------------------------------------------------------

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
        Classificacao, on_delete=models.PROTECT, related_name="categorias"
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
        Categoria, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ["nome"]
        indexes = [models.Index(fields=["workspace", "cnpj"])]

    def __str__(self):
        return self.nome


# ---------------------------------------------------------------------------
# Tabela Mercado — notas fiscais (NFC-e)
# ---------------------------------------------------------------------------

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
        Estabelecimento, on_delete=models.SET_NULL, null=True, blank=True,
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
        Categoria, on_delete=models.PROTECT, related_name="notas", null=True, blank=True
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
    nota = models.ForeignKey(NotaFiscal, on_delete=models.CASCADE, related_name="itens")
    numero_item = models.PositiveSmallIntegerField()
    codigo = models.CharField(max_length=60, blank=True)   # EAN ou código interno
    descricao = models.CharField(max_length=200)
    quantidade = models.DecimalField(max_digits=12, decimal_places=4, default=1)
    unidade = models.CharField(max_length=10, blank=True)
    valor_unitario = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    valor_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # Subcategoria opcional do produto (Padaria, Laticínios, Limpeza...)
    categoria = models.ForeignKey(
        Categoria, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
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


# ---------------------------------------------------------------------------
# Tabela Entrada e Saída = Contratos Previstos
# ---------------------------------------------------------------------------

class Contrato(EscopoWorkspace):
    """
    Tabela Entrada e Saída. Cada linha é uma receita ou despesa com vigência
    (data_inicio → data_fim), a partir da qual a projeção é gerada.
    """
    numero = models.PositiveIntegerField(null=True, blank=True)
    estabelecimento = models.ForeignKey(
        Estabelecimento, on_delete=models.PROTECT, related_name="contratos"
    )
    descricao = models.CharField(max_length=200)
    tipo = models.CharField(max_length=8, choices=TipoLancamento.choices)
    categoria = models.ForeignKey(
        Categoria, on_delete=models.PROTECT, related_name="contratos"
    )
    # Redundante em relação a categoria.classificacao de propósito: permite
    # reclassificar um contrato específico sem mexer na categoria inteira.
    classificacao = models.ForeignKey(
        Classificacao, on_delete=models.PROTECT, related_name="contratos"
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
        Contrato, on_delete=models.CASCADE, related_name="parcelas"
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


class Realizado(EscopoWorkspace):
    """
    O que efetivamente entrou ou saiu. Comparado com ParcelaPrevista pela
    competência para medir aderência do previsto x realizado.
    """
    contrato = models.ForeignKey(
        Contrato, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="realizados",
    )
    parcela = models.OneToOneField(
        ParcelaPrevista, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="realizado",
    )
    categoria = models.ForeignKey(
        Categoria, on_delete=models.PROTECT, related_name="realizados"
    )
    descricao = models.CharField(max_length=200)
    tipo = models.CharField(max_length=8, choices=TipoLancamento.choices)
    competencia = models.DateField()
    data_pagamento = models.DateField()
    valor = models.DecimalField(
        max_digits=14, decimal_places=2, validators=[MinValueValidator(0)]
    )
    forma_pagamento = models.CharField(max_length=60, blank=True)
    origem = models.CharField(
        max_length=12, choices=OrigemLancamento.choices, default=OrigemLancamento.MANUAL
    )
    # Preenchido quando a linha nasce do consolidado mensal do mercado.
    competencia_mercado = models.DateField(null=True, blank=True)
    observacao = models.TextField(blank=True)

    class Meta:
        ordering = ["-data_pagamento"]
        indexes = [
            models.Index(fields=["workspace", "competencia"]),
            models.Index(fields=["workspace", "tipo", "competencia"]),
        ]
        constraints = [
            # Só pode existir um realizado de mercado por mês por workspace.
            models.UniqueConstraint(
                fields=["workspace", "competencia_mercado"],
                condition=models.Q(origem=OrigemLancamento.MERCADO),
                name="uq_realizado_mercado_mes",
            )
        ]

    def __str__(self):
        return f"{self.descricao} {self.competencia:%m/%Y} — R$ {self.valor}"

    @property
    def sinal(self) -> int:
        return 1 if self.tipo == TipoLancamento.RECEITA else -1
