"""
Previsão de fluxo de caixa: junta o que se sabe com o que se estima.

A separação é a decisão central
-------------------------------
    conhecido    contratos, financiamento, parcelas de cartão já compradas
                 → entra igual em todos os cenários

    estimado     mercado, consumo variável, compras avulsas
                 → sai de um modelo escolhido por backtest, com intervalo

Misturar os dois num modelo único seria o erro mais caro possível aqui. O
financiamento tem 246 parcelas publicadas pelo banco, com centavos; passar isso
por uma regressão adicionaria erro onde havia certeza. E o gasto de mercado não
tem contrato nenhum; tratá-lo como determinístico produziria confiança falsa.

O sistema fica melhor sozinho
-----------------------------
Com zero meses de histórico, a previsão é só o contratado, e a tela diz isso.
A cada mês de uso o backtest tem mais um ponto, modelos antes indisponíveis
passam a competir, e o intervalo aperta porque foi medido em mais casos. Não
há retreino manual: a seleção roda a cada consulta.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db.models import Sum

from apps.common.datas import competencia_atual
from apps.previsao.services import backtest, cenarios
from apps.previsao.services.modelos import para_decimal
from apps.relatorios.services.matriz import meses_entre

ZERO = Decimal("0")
# Componentes sem contrato, que precisam ser estimados.
ORIGENS_VARIAVEIS = ("MERCADO", "MANUAL", "OFX")


def serie_historica(workspace, *, meses: int = 24) -> tuple[list[str], list[float]]:
    """
    Resultado líquido mensal já realizado, do mais antigo ao mais recente.

    Só competências fechadas: o mês corrente está incompleto e entraria como
    uma queda que não existe, puxando qualquer modelo para baixo.
    """
    from apps.common.models import TipoLancamento
    from apps.realizados.models import Realizado

    corrente = competencia_atual()
    inicio = meses_entre(
        date(corrente.year - (meses // 12) - 1, corrente.month, 1), corrente
    )[-meses:][0]

    linhas = (
        Realizado.objects.filter(
            workspace=workspace, competencia__gte=inicio, competencia__lt=corrente
        )
        .values("competencia", "tipo")
        .annotate(total=Sum("valor"))
        .values_list("competencia", "tipo", "total")
    )

    por_mes: dict[date, Decimal] = {}
    for competencia, tipo, total in linhas:
        sinal = 1 if tipo == TipoLancamento.RECEITA else -1
        por_mes[competencia] = por_mes.get(competencia, ZERO) + sinal * (total or ZERO)

    ordenados = sorted(por_mes)
    return ([c.isoformat() for c in ordenados], [float(por_mes[c]) for c in ordenados])


def serie_variavel(workspace, *, meses: int = 24) -> list[float]:
    """
    Só a parte sem contrato — o que de fato precisa ser previsto.

    Um realizado ligado a contrato já é coberto pela projeção determinística.
    Incluí-lo aqui contaria a mesma despesa duas vezes.
    """
    from apps.common.models import TipoLancamento
    from apps.realizados.models import Realizado

    corrente = competencia_atual()
    linhas = (
        Realizado.objects.filter(
            workspace=workspace, competencia__lt=corrente, contrato__isnull=True
        )
        .values("competencia", "tipo")
        .annotate(total=Sum("valor"))
        .values_list("competencia", "tipo", "total")
    )

    por_mes: dict[date, Decimal] = {}
    for competencia, tipo, total in linhas:
        sinal = 1 if tipo == TipoLancamento.RECEITA else -1
        por_mes[competencia] = por_mes.get(competencia, ZERO) + sinal * (total or ZERO)

    return [float(por_mes[c]) for c in sorted(por_mes)][-meses:]


def _deterministico_por_mes(workspace, competencias: list[date]) -> dict[str, Decimal]:
    """
    Soma das três fontes de valor já conhecido.

    Reusa exatamente as funções que alimentam o fluxo de caixa — se a previsão
    calculasse por conta própria, os dois números divergiriam e nenhum seria
    confiável.
    """
    from apps.relatorios.services.fluxo_caixa import fluxo_mensal

    linhas = fluxo_mensal(workspace, inicio=competencias[0], fim=competencias[-1])
    return {
        linha["competencia"].isoformat(): linha["resultado_previsto"]
        for linha in linhas
    }


def prever(
    workspace,
    *,
    horizonte: int = 12,
    saldo_inicial: Decimal = ZERO,
    cenarios_simulados: int = 5000,
) -> dict:
    """Projeção completa dos próximos meses, com faixa e risco."""
    corrente = competencia_atual()
    competencias = meses_entre(
        corrente,
        date(
            corrente.year + (corrente.month + horizonte - 1) // 12,
            (corrente.month + horizonte - 1) % 12 + 1,
            1,
        ),
    )[:horizonte]
    chaves = [c.isoformat() for c in competencias]

    deterministico = _deterministico_por_mes(workspace, competencias)
    historico = serie_variavel(workspace)
    selecao = backtest.selecionar(historico)

    if historico:
        estimativas = selecao.modelo.prever(historico, horizonte)
    else:
        estimativas = [0.0] * horizonte

    residuos = selecao.resultado.residuos if selecao.resultado else []

    simulacao = cenarios.simular(
        competencias=chaves,
        deterministico=[float(deterministico.get(c, ZERO)) for c in chaves],
        estimado=estimativas,
        residuos=residuos,
        saldo_inicial=float(saldo_inicial),
        cenarios=cenarios_simulados,
    )

    return {
        "competencia_inicial": chaves[0],
        "horizonte": horizonte,
        "modelo": {
            "nome": selecao.modelo.nome,
            "descricao": selecao.modelo.descricao,
            "motivo": selecao.motivo,
            "confiavel": selecao.confiavel,
            "observacoes": selecao.observacoes,
            "erro_medio": (
                para_decimal(selecao.resultado.mae) if selecao.resultado else None
            ),
            "ganho_sobre_ingenuo": (
                round(selecao.ganho_sobre_ingenuo, 3)
                if selecao.ganho_sobre_ingenuo is not None
                else None
            ),
            "candidatos": [
                {
                    "modelo": c.modelo,
                    "descricao": c.descricao,
                    "erro_medio": para_decimal(c.mae),
                    "avaliacoes": c.avaliacoes,
                }
                for c in selecao.candidatos
            ],
        },
        "meses": [
            {
                "competencia": mes.competencia,
                "contratado": para_decimal(mes.deterministico),
                "estimado": para_decimal(mes.estimado),
                "resultado_p50": para_decimal(mes.deterministico + mes.p50),
                "saldo_p10": para_decimal(mes.saldo_p10),
                "saldo_p50": para_decimal(mes.saldo_p50),
                "saldo_p90": para_decimal(mes.saldo_p90),
                "probabilidade_negativo": round(mes.probabilidade_negativo, 3),
            }
            for mes in simulacao.meses
        ],
        "risco": {
            "probabilidade_algum_mes_negativo": round(
                simulacao.probabilidade_algum_mes_negativo, 3
            ),
            "primeiro_mes_de_risco": simulacao.primeiro_mes_de_risco,
            "saldo_final_p10": para_decimal(simulacao.saldo_final_p10),
            "saldo_final_p50": para_decimal(simulacao.saldo_final_p50),
            "saldo_final_p90": para_decimal(simulacao.saldo_final_p90),
            "cenarios_simulados": simulacao.cenarios,
            "confiavel": simulacao.confiavel,
        },
        "resumo": cenarios.resumo_legivel(simulacao),
        "aviso": simulacao.aviso,
    }
