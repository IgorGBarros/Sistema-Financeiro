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
    apelido = models.CharField(
        max_length=80, blank=True, help_text="Como você chama este lugar."
    )
    cnpj = models.CharField(
        max_length=14, blank=True,
        validators=[RegexValidator(r"^\d{14}$", "CNPJ deve ter 14 dígitos")],
    )
    # Os 8 primeiros dígitos identificam a empresa; os 4 seguintes, a filial.
    # Sem agrupar por raiz, "quanto gastei na Redemix este ano" não responde
    # nada: a rede tem dezenas de lojas, cada uma com CNPJ próprio. O cupom de
    # exemplo é da filial 0015.
    cnpj_raiz = models.CharField(max_length=8, blank=True, db_index=True)
    municipio = models.CharField(max_length=120, blank=True)
    uf = models.CharField(max_length=2, blank=True)
    categoria_padrao = models.ForeignKey(
        "catalogo.Categoria", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ["nome"]
        indexes = [models.Index(fields=["workspace", "cnpj"])]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "cnpj"],
                condition=models.Q(cnpj__gt=""),
                name="uq_estabelecimento_cnpj",
            )
        ]

    def __str__(self):
        return self.apelido or self.nome

    def save(self, *args, **kwargs):
        # A raiz é derivada, nunca digitada.
        if self.cnpj and len(self.cnpj) == 14:
            self.cnpj_raiz = self.cnpj[:8]
        super().save(*args, **kwargs)


class OrigemApelido(models.TextChoices):
    MANUAL = "MANUAL", "Cadastrado pelo usuário"
    CONCILIACAO = "CONCILIACAO", "Aprendido ao conciliar"
    SUGERIDO = "SUGERIDO", "Sugerido pelo sistema"


class ApelidoEstabelecimento(Base):
    """
    Como o estabelecimento aparece em outros documentos.

    A fatura do cartão não traz CNPJ. Traz "REDEMIX SUPERM 03/12" ou
    "PAG*Redemix". Esta tabela faz a ponte — e aprende: quando a pessoa
    concilia uma linha na mão, o texto vira apelido e casa sozinho da próxima
    vez. Aprendizado sem modelo nenhum, só guardando o que já foi ensinado.
    """

    estabelecimento = models.ForeignKey(
        Estabelecimento, on_delete=models.CASCADE, related_name="apelidos"
    )
    # Normalizado: caixa alta, sem acento, sem pontuação.
    texto = models.CharField(max_length=120, db_index=True)
    origem = models.CharField(
        max_length=12, choices=OrigemApelido.choices, default=OrigemApelido.MANUAL
    )

    class Meta:
        ordering = ["texto"]
        constraints = [
            models.UniqueConstraint(
                fields=["estabelecimento", "texto"], name="uq_apelido_texto"
            )
        ]

    def __str__(self):
        return f"{self.texto} → {self.estabelecimento}"
