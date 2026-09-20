"""
Cálculo de imposto de renda — tabela progressiva 2024 (ano-base).

As faixas e deduções são as vigentes para o exercício 2025 (ano-base 2024).
Altere as constantes aqui quando a tabela mudar; o resto do código não precisa
saber o valor de cada limite.

Referência: Instrução Normativa RFB nº 2.178/2024.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from apps.ir.models import DeclaracaoIR

# ---------------------------------------------------------------------------
# Tabela progressiva 2024 (valores anuais)
# ---------------------------------------------------------------------------

FAIXAS = [
    # (limite_superior, aliquota, deducao_fixa)
    (Decimal("33888.00"),  Decimal("0"),     Decimal("0")),
    (Decimal("45012.60"),  Decimal("0.075"), Decimal("2534.40")),
    (Decimal("55976.16"),  Decimal("0.15"),  Decimal("5914.89")),
    (Decimal("67502.28"),  Decimal("0.225"), Decimal("10094.49")),
    (Decimal("9999999"),   Decimal("0.275"), Decimal("13467.76")),
]

DEDUCAO_POR_DEPENDENTE = Decimal("2275.08")
TETO_EDUCACAO_POR_PESSOA = Decimal("3561.50")
LIMITE_PGBL_PCT = Decimal("0.12")  # 12% da renda bruta tributável

# Ganho de capital — alíquotas por faixa anual
FAIXAS_GANHO_CAPITAL = [
    (Decimal("5000000"),  Decimal("0.15")),
    (Decimal("10000000"), Decimal("0.175")),
    (Decimal("30000000"), Decimal("0.20")),
    (Decimal("9999999999"), Decimal("0.225")),
]


# ---------------------------------------------------------------------------
# Estruturas de saída (dataclasses para serialização simples)
# ---------------------------------------------------------------------------

@dataclass
class ResultadoCalculo:
    """Resultado do cálculo de IR para uma modalidade."""

    modalidade: str
    renda_bruta_tributavel: Decimal
    total_deducoes: Decimal
    base_calculo: Decimal
    imposto_bruto: Decimal
    irrf_a_creditar: Decimal
    imposto_a_pagar_ou_restituir: Decimal  # negativo = restituição
    aliquota_efetiva: Decimal

    # Detalhamento das deduções
    deducao_dependentes: Decimal
    deducao_saude: Decimal
    deducao_educacao: Decimal
    deducao_pgbl: Decimal
    deducao_pensao: Decimal
    deducao_outras: Decimal

    # Detalhamento de rendimentos
    rendimentos_trabalho: Decimal
    rendimentos_capital_tributavel: Decimal
    rendimentos_isentos: Decimal
    irrf_trabalho: Decimal
    irrf_capital: Decimal

    avisos: list[str] = field(default_factory=list)


@dataclass
class ComparacaoModalidades:
    individual_titular: ResultadoCalculo
    individual_conjuge: ResultadoCalculo | None
    conjunta: ResultadoCalculo
    recomendacao: str
    diferenca: Decimal  # positivo = conjunta é mais barata; negativo = separado é melhor


# ---------------------------------------------------------------------------
# Funções auxiliares
# ---------------------------------------------------------------------------

def _imposto_progressivo(base: Decimal) -> Decimal:
    """Aplica a tabela progressiva a uma base de cálculo anual."""
    if base <= 0:
        return Decimal("0")
    for limite, aliquota, deducao in FAIXAS:
        if base <= limite:
            return base * aliquota - deducao
    # Não deveria chegar aqui, mas garante segurança
    return base * FAIXAS[-1][1] - FAIXAS[-1][2]


def _deducao_educacao(valor_pago: Decimal) -> Decimal:
    return min(valor_pago, TETO_EDUCACAO_POR_PESSOA)


def _deducao_pgbl(valor_pago: Decimal, renda_bruta: Decimal) -> Decimal:
    return min(valor_pago, renda_bruta * LIMITE_PGBL_PCT)


# ---------------------------------------------------------------------------
# Consolidação de rendimentos por declaração
# ---------------------------------------------------------------------------

def consolidar_rendimentos(declaracao: "DeclaracaoIR") -> dict[str, Decimal]:
    """
    Soma os rendimentos registrados na declaração.

    Os rendimentos de trabalho (salários, pró-labore) estão nos holerites.
    Capital variável vem dos RendimentoCapitalVariavel.
    Retorna um dicionário com chaves consistentes para facilitar o cálculo.
    """
    # Holerites: somar líquido + IRRF para obter bruto
    from apps.folha.models import Holerite
    holerites = Holerite.objects.filter(workspace=declaracao.workspace)
    # Ano da declaração
    holerites = holerites.filter(competencia__startswith=str(declaracao.ano))

    total_vencimentos = Decimal("0")
    total_irrf_trabalho = Decimal("0")
    for h in holerites:
        total_vencimentos += Decimal(str(h.total_vencimentos or 0))
        # IRRF está nas verbas com código iniciando em 7 (IRRF) — variável
        from apps.folha.models import Verba
        irrf = sum(
            Decimal(str(v.valor))
            for v in h.verbas.filter(natureza="DESCONTO", codigo__startswith="7")
        )
        total_irrf_trabalho += irrf

    # Capital variável
    capital_tributavel = Decimal("0")
    capital_isento = Decimal("0")
    irrf_capital = Decimal("0")

    for rcv in declaracao.capital_variavel.all():
        bruto = Decimal(str(rcv.valor_bruto))
        irrf = Decimal(str(rcv.imposto_retido))
        if rcv.isento:
            capital_isento += bruto
        else:
            capital_tributavel += bruto
            irrf_capital += irrf

    return {
        "rendimentos_trabalho": total_vencimentos,
        "rendimentos_capital_tributavel": capital_tributavel,
        "rendimentos_isentos": capital_isento,
        "irrf_trabalho": total_irrf_trabalho,
        "irrf_capital": irrf_capital,
    }


# ---------------------------------------------------------------------------
# Cálculo de deduções
# ---------------------------------------------------------------------------

def calcular_deducoes(declaracao: "DeclaracaoIR", renda_bruta: Decimal) -> dict[str, Decimal]:
    """
    Calcula todas as deduções permitidas para a declaração.

    Parâmetros
    ----------
    renda_bruta : Decimal
        Usado para limitar o PGBL a 12%.
    """
    # Dependentes
    dependentes_ativos = declaracao.dependentes.filter(gera_deducao=True)
    deducao_dep = len(dependentes_ativos) * DEDUCAO_POR_DEPENDENTE

    # Saúde — sem limite
    deducao_saude = sum(
        Decimal(str(d.valor)) for d in declaracao.despesas_medicas.all()
    )

    # Outras deduções por tipo
    deducao_educ = Decimal("0")
    deducao_pgbl = Decimal("0")
    deducao_pensao = Decimal("0")
    deducao_outras = Decimal("0")

    from apps.ir.models import TipoOutraDedução
    for ded in declaracao.outras_deducoes.all():
        valor = Decimal(str(ded.valor))
        if ded.tipo == TipoOutraDedução.EDUCACAO:
            deducao_educ += _deducao_educacao(valor)
        elif ded.tipo == TipoOutraDedução.PREVIDENCIA_PRIVADA:
            deducao_pgbl += valor  # O limite será aplicado na soma total abaixo
        elif ded.tipo == TipoOutraDedução.PENSAO_ALIMENTICIA:
            deducao_pensao += valor
        else:
            deducao_outras += valor

    # Aplicar limite do PGBL
    deducao_pgbl = _deducao_pgbl(deducao_pgbl, renda_bruta)

    return {
        "deducao_dependentes": deducao_dep,
        "deducao_saude": deducao_saude,
        "deducao_educacao": deducao_educ,
        "deducao_pgbl": deducao_pgbl,
        "deducao_pensao": deducao_pensao,
        "deducao_outras": deducao_outras,
    }


# ---------------------------------------------------------------------------
# Cálculo principal
# ---------------------------------------------------------------------------

def calcular_imposto_estimado(declaracao: "DeclaracaoIR") -> ResultadoCalculo:
    """
    Calcula o imposto estimado para uma declaração.

    Este cálculo é uma estimativa para o planejamento. A Receita Federal
    tem regras adicionais (deduções de dependentes com renda própria,
    carnê-leão, etc.) que o sistema não modela completamente.
    """
    rendimentos = consolidar_rendimentos(declaracao)
    renda_trabalho = rendimentos["rendimentos_trabalho"]
    renda_capital_tributavel = rendimentos["rendimentos_capital_tributavel"]
    renda_isenta = rendimentos["rendimentos_isentos"]
    irrf_trabalho = rendimentos["irrf_trabalho"]
    irrf_capital = rendimentos["irrf_capital"]

    renda_bruta = renda_trabalho + renda_capital_tributavel

    deducoes = calcular_deducoes(declaracao, renda_bruta)
    total_deducoes = sum(deducoes.values())

    base = max(Decimal("0"), renda_bruta - total_deducoes)
    imposto_bruto = max(Decimal("0"), _imposto_progressivo(base))
    total_irrf = irrf_trabalho + irrf_capital
    imposto_final = imposto_bruto - total_irrf

    aliquota_efetiva = (
        (imposto_bruto / renda_bruta * 100) if renda_bruta > 0 else Decimal("0")
    )

    avisos = []
    if renda_capital_tributavel > 0:
        avisos.append(
            "Rendimentos de capital variável tributável incluídos na base. "
            "Verifique se há ganhos de capital com alíquota exclusiva não cobertos."
        )
    if declaracao.ano < 2024:
        avisos.append(
            f"Os limites de dedução usados são os de 2024. "
            f"Para o ano {declaracao.ano} confirme os valores vigentes."
        )

    return ResultadoCalculo(
        modalidade=declaracao.modalidade,
        renda_bruta_tributavel=renda_bruta,
        total_deducoes=total_deducoes,
        base_calculo=base,
        imposto_bruto=imposto_bruto,
        irrf_a_creditar=total_irrf,
        imposto_a_pagar_ou_restituir=imposto_final,
        aliquota_efetiva=aliquota_efetiva.quantize(Decimal("0.01")),
        rendimentos_trabalho=renda_trabalho,
        rendimentos_capital_tributavel=renda_capital_tributavel,
        rendimentos_isentos=renda_isenta,
        irrf_trabalho=irrf_trabalho,
        irrf_capital=irrf_capital,
        **deducoes,
        avisos=avisos,
    )


def comparar_modalidades(
    declaracao_individual: "DeclaracaoIR",
    declaracao_conjunta: "DeclaracaoIR",
) -> ComparacaoModalidades:
    """
    Compara o imposto total entre declaração individual e conjunta.

    Na declaração individual o cônjuge declara separadamente — aqui o
    sistema não tem os dados do cônjuge, então usa a declaração_conjunta
    para simular ambos os lados (o usuário preenche os dados do cônjuge
    na declaração conjunta).

    Retorna qual modalidade é mais vantajosa e a diferença.
    """
    ind_titular = calcular_imposto_estimado(declaracao_individual)
    conj = calcular_imposto_estimado(declaracao_conjunta)

    # Para individual: o cônjuge não está no sistema — retornamos None
    # e o frontend exibe um aviso para inserir os dados do cônjuge.
    imposto_individual_total = ind_titular.imposto_a_pagar_ou_restituir
    imposto_conjunto_total = conj.imposto_a_pagar_ou_restituir

    diferenca = imposto_individual_total - imposto_conjunto_total

    if abs(diferenca) < Decimal("100"):
        recomendacao = (
            "As duas modalidades resultam em imposto muito próximo "
            "(diferença menor que R$ 100). Escolha a mais simples de preparar."
        )
    elif diferenca > 0:
        recomendacao = (
            f"A declaração conjunta é mais vantajosa: economia estimada de "
            f"R$ {diferenca:.2f} em relação à declaração individual."
        )
    else:
        recomendacao = (
            f"A declaração individual (separada) é mais vantajosa: economia "
            f"estimada de R$ {abs(diferenca):.2f} em relação à conjunta."
        )

    return ComparacaoModalidades(
        individual_titular=ind_titular,
        individual_conjuge=None,
        conjunta=conj,
        recomendacao=recomendacao,
        diferenca=diferenca,
    )
