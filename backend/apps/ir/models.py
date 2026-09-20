"""
Imposto de Renda — declaração anual.

Por que aqui e não espalhado nos outros apps
--------------------------------------------
Declaração de IR é uma visão anual que agrega dados de várias fontes
(holerites, receitas, notas fiscais) e acrescenta informações que só existem
para fins fiscais (dependentes, capital variável, deduções).

Manter num app próprio separa o ciclo de vida: IR é anual e retroativo —
a pessoa declara 2024 em 2025 olhando para dados que o sistema já tem.
Salvar aqui o que for preenchido manualmente não polui os outros domínios.

Modalidades
-----------
- INDIVIDUAL: uma pessoa declara sozinha.
- CONJUNTA: casal declara junto — rendimentos e deduções de ambos somam.
  O sistema calcula os dois cenários para comparar qual é menor imposto.

Invariante de valor
-------------------
Todos os campos `valor`, `valor_bruto`, `imposto_retido` são sempre positivos.
O sinal vem do contexto (dedução reduz base; rendimento aumenta).
"""

from django.db import models

from apps.common.models import Base, EscopoWorkspace


class ModalidadeDeclaracao(models.TextChoices):
    INDIVIDUAL = "INDIVIDUAL", "Individual"
    CONJUNTA = "CONJUNTA", "Conjunta (casal)"


class StatusDeclaracao(models.TextChoices):
    RASCUNHO = "RASCUNHO", "Rascunho"
    FINALIZADA = "FINALIZADA", "Finalizada"


class TipoParentesco(models.TextChoices):
    CONJUGE = "CONJUGE", "Cônjuge / Companheiro(a)"
    FILHO = "FILHO", "Filho(a)"
    ENTEADO = "ENTEADO", "Enteado(a)"
    PAI_MAE = "PAI_MAE", "Pai / Mãe"
    AVO = "AVO", "Avô / Avó"
    OUTRO = "OUTRO", "Outro"


class TipoDespesaMedica(models.TextChoices):
    CONSULTA = "CONSULTA", "Consulta médica"
    EXAME = "EXAME", "Exame laboratorial / imagem"
    INTERNACAO = "INTERNACAO", "Internação / cirurgia"
    DENTAL = "DENTAL", "Odontológico"
    PSICOLOGIA = "PSICOLOGIA", "Psicologia / terapia"
    FISIOTERAPIA = "FISIOTERAPIA", "Fisioterapia"
    PLANO_SAUDE = "PLANO_SAUDE", "Plano de saúde"
    OUTROS = "OUTROS", "Outros"


class TipoCapitalVariavel(models.TextChoices):
    DIVIDENDO = "DIVIDENDO", "Dividendo (isento)"
    JCP = "JCP", "JCP — Juros sobre capital próprio"
    GANHO_CAPITAL = "GANHO_CAPITAL", "Ganho de capital (venda de ações)"
    FII = "FII", "FII — Fundo imobiliário"
    CRIPTOATIVO = "CRIPTOATIVO", "Criptoativo"
    RENDA_FIXA = "RENDA_FIXA", "Renda fixa (CDB, LCI, LCA, Tesouro)"
    OUTRO = "OUTRO", "Outro rendimento de capital"


class TipoOutraDedução(models.TextChoices):
    EDUCACAO = "EDUCACAO", "Educação"
    PREVIDENCIA_PRIVADA = "PREVIDENCIA_PRIVADA", "Previdência privada (PGBL)"
    PENSAO_ALIMENTICIA = "PENSAO_ALIMENTICIA", "Pensão alimentícia judicial"
    LIVRO_CAIXA = "LIVRO_CAIXA", "Livro-caixa (autônomo)"
    DOACAO = "DOACAO", "Doação a fundo aprovado"
    OUTRO = "OUTRO", "Outro"


class DeclaracaoIR(EscopoWorkspace):
    """
    Declaração anual de IR — cabeçalho que agrupa tudo.

    Uma declaração por ano por workspace. A modalidade define se a pessoa
    declara sozinha ou com o cônjuge. Ambas as modalidades podem coexistir
    para comparação — o campo `modalidade` distingue qual é qual.
    """

    ano = models.PositiveSmallIntegerField()
    modalidade = models.CharField(
        max_length=20, choices=ModalidadeDeclaracao.choices,
        default=ModalidadeDeclaracao.INDIVIDUAL,
    )
    status = models.CharField(
        max_length=20, choices=StatusDeclaracao.choices,
        default=StatusDeclaracao.RASCUNHO,
    )
    # Titular da declaração (nome para o relatório)
    nome_titular = models.CharField(max_length=200, blank=True)
    cpf_titular = models.CharField(max_length=14, blank=True)
    # Para declaração conjunta: dados do cônjuge
    nome_conjuge = models.CharField(max_length=200, blank=True)
    cpf_conjuge = models.CharField(max_length=14, blank=True)
    observacao = models.TextField(blank=True)

    class Meta:
        ordering = ["-ano", "modalidade"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "ano", "modalidade"],
                name="uq_declaracao_ir_ano_modalidade",
            )
        ]

    def __str__(self):
        return f"IR {self.ano} — {self.get_modalidade_display()}"


class Dependente(EscopoWorkspace):
    """
    Pessoa que gera dedução por dependente (R$ 2.275,08/ano em 2024).

    Se o cônjuge estiver na declaração conjunta, ele é dependente da
    declaração conjunta — mas não conta como dedução, só soma renda.
    Para fins de dedução, dependentes são filhos, pais, etc.
    """

    declaracao = models.ForeignKey(
        DeclaracaoIR, on_delete=models.CASCADE, related_name="dependentes"
    )
    nome = models.CharField(max_length=200)
    cpf = models.CharField(max_length=14, blank=True)
    data_nascimento = models.DateField(null=True, blank=True)
    parentesco = models.CharField(
        max_length=20, choices=TipoParentesco.choices,
        default=TipoParentesco.FILHO,
    )
    # Rendimento próprio do dependente — reduz o benefício se for alto
    rendimento_proprio = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="Rendimentos anuais do próprio dependente (ex: mesada, bolsa).",
    )
    gera_deducao = models.BooleanField(
        default=True,
        help_text="Desmarque se o dependente já declarou separadamente.",
    )

    class Meta:
        ordering = ["nome"]

    def __str__(self):
        return f"{self.nome} ({self.get_parentesco_display()})"


class DespesaMedica(EscopoWorkspace):
    """
    Despesa de saúde dedutível — sem limite legal em 2024.

    Pode ser vinculada a uma nota fiscal lida pelo scanner (NF-e de
    clínica/farmácia) ou inserida manualmente para consultas sem nota.
    """

    declaracao = models.ForeignKey(
        DeclaracaoIR, on_delete=models.CASCADE, related_name="despesas_medicas"
    )
    tipo = models.CharField(
        max_length=20, choices=TipoDespesaMedica.choices,
        default=TipoDespesaMedica.CONSULTA,
    )
    prestador = models.CharField(max_length=200)
    cnpj_prestador = models.CharField(max_length=18, blank=True)
    # A quem se refere: titular ou nome do dependente
    beneficiario = models.CharField(
        max_length=200, blank=True,
        help_text="Deixe em branco para o titular. Preencha com o nome do dependente.",
    )
    data = models.DateField()
    valor = models.DecimalField(max_digits=12, decimal_places=2)
    # Vínculo opcional com uma nota fiscal já no sistema
    nota_fiscal = models.ForeignKey(
        "fiscal.NotaFiscal", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="despesas_ir",
    )
    observacao = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["-data"]

    def __str__(self):
        return f"{self.prestador} — R$ {self.valor} em {self.data}"


class RendimentoCapitalVariavel(EscopoWorkspace):
    """
    Rendimento de capital variável e outros rendimentos de aplicações.

    - Dividendos de ações brasileiras: isentos de IR na fonte e na declaração.
    - JCP (Juros sobre capital próprio): tributados 15% na fonte (IRRF).
    - Ganho de capital em ações: 15% (até R$ 5M) ou 20-22,5% acima.
    - FII: rendimentos mensais isentos; ganho de capital tributado.
    - Renda fixa: tributação na fonte (15-22,5%).
    - Criptoativos: ganho tributado se alienação > R$ 35.000/mês.

    O campo `imposto_retido` representa o IRRF já pago na fonte,
    que entra como crédito na apuração final.
    """

    declaracao = models.ForeignKey(
        DeclaracaoIR, on_delete=models.CASCADE, related_name="capital_variavel"
    )
    tipo = models.CharField(
        max_length=20, choices=TipoCapitalVariavel.choices,
        default=TipoCapitalVariavel.DIVIDENDO,
    )
    descricao = models.CharField(
        max_length=200, help_text="Nome da empresa, fundo ou ativo."
    )
    cnpj_emissor = models.CharField(max_length=18, blank=True)
    valor_bruto = models.DecimalField(max_digits=12, decimal_places=2)
    imposto_retido = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="IRRF retido na fonte — vira crédito na declaração.",
    )
    isento = models.BooleanField(
        default=False,
        help_text="Marque para dividendos brasileiros e rendimentos isentos por lei.",
    )
    data = models.DateField()

    class Meta:
        ordering = ["-data"]

    def __str__(self):
        return f"{self.descricao} — R$ {self.valor_bruto}"


class OutraDedução(EscopoWorkspace):
    """
    Deduções legais além de saúde e dependentes.

    Educação: R$ 3.561,50/ano por pessoa (titular + cada dependente).
    PGBL: até 12% da renda bruta tributável.
    Pensão alimentícia: integral se judicial.
    """

    declaracao = models.ForeignKey(
        DeclaracaoIR, on_delete=models.CASCADE, related_name="outras_deducoes"
    )
    tipo = models.CharField(
        max_length=25, choices=TipoOutraDedução.choices,
        default=TipoOutraDedução.EDUCACAO,
    )
    beneficiario = models.CharField(
        max_length=200,
        help_text="Titular ou nome do dependente a quem se refere.",
    )
    instituicao = models.CharField(max_length=200, blank=True)
    cnpj_instituicao = models.CharField(max_length=18, blank=True)
    valor = models.DecimalField(max_digits=12, decimal_places=2)
    observacao = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["tipo", "beneficiario"]

    def __str__(self):
        return f"{self.get_tipo_display()} — {self.beneficiario} — R$ {self.valor}"
