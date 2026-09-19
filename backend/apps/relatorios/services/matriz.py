"""
Visões matriciais: linhas por entidade, colunas por mês.

É o formato de tabela dinâmica que o Power BI produzia, e ele resolve uma
pergunta que a lista mensal não resolve: *o que muda de um mês para o outro,
linha a linha*. Numa lista, comparar março com abril exige trocar de tela duas
vezes; na matriz, é olhar para o lado.

Duas matrizes com estruturas parecidas mas fontes diferentes:

    matriz_contratos   estabelecimento × mês, a partir das parcelas previstas
    painel_cartoes     cartão × mês, a partir das parcelas de compra
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.db.models import Sum

from apps.common.datas import hoje_local


ZERO = Decimal("0")


def meses_entre(inicio: date, fim: date) -> list[date]:
    """Lista de competências, do primeiro dia de cada mês."""
    meses = []
    atual = inicio.replace(day=1)
    limite = fim.replace(day=1)
    while atual <= limite:
        meses.append(atual)
        atual = (
            date(atual.year + 1, 1, 1)
            if atual.month == 12
            else date(atual.year, atual.month + 1, 1)
        )
    return meses


def matriz_contratos(
    workspace, *, inicio: date, fim: date, agrupar_por: str = "estabelecimento"
) -> dict:
    """
    Entradas e saídas previstas, uma linha por estabelecimento e uma coluna
    por mês.

    Sinal: receita positiva, despesa negativa. É o oposto da planilha original,
    onde receita era negativa — mas é a convenção do resto do sistema, e ter
    duas convenções na mesma tela seria pior que divergir da planilha antiga.
    O total da coluna passa a ser o resultado do mês: positivo sobra, negativo
    falta.
    """
    from apps.common.models import TipoLancamento
    from apps.contratos.models import ParcelaPrevista

    campos = {
        "estabelecimento": ("contrato__estabelecimento__nome", "contrato__estabelecimento_id"),
        "categoria": ("contrato__categoria__nome", "contrato__categoria_id"),
        "classificacao": ("contrato__classificacao__nome", "contrato__classificacao_id"),
    }
    if agrupar_por not in campos:
        raise ValueError(
            f"Agrupamento '{agrupar_por}' não existe. Use: {', '.join(campos)}."
        )
    campo_nome, campo_id = campos[agrupar_por]

    meses = meses_entre(inicio, fim)
    chaves = [m.isoformat() for m in meses]

    parcelas = (
        ParcelaPrevista.objects.filter(
            contrato__workspace=workspace,
            competencia__gte=meses[0],
            competencia__lte=meses[-1],
        )
        .exclude(contrato__status="ENCERRADO")
        .values(campo_nome, campo_id, "contrato__tipo", "competencia")
        .annotate()
        .values_list(campo_nome, campo_id, "contrato__tipo", "competencia", "valor_previsto")
    )

    linhas: dict[tuple, dict] = {}
    for nome, identificador, tipo, competencia, valor in parcelas:
        sinal = 1 if tipo == TipoLancamento.RECEITA else -1
        chave = (nome or "Sem nome", str(identificador))
        linha = linhas.setdefault(
            chave,
            {
                "nome": chave[0],
                "id": chave[1],
                "tipo": tipo,
                "valores": defaultdict(lambda: ZERO),
                "total": ZERO,
            },
        )
        # Uma entidade pode ter contrato de entrada e de saída. Nesse caso a
        # linha vira mista e o tipo deixa de fazer sentido sozinho.
        if linha["tipo"] != tipo:
            linha["tipo"] = "MISTO"
        linha["valores"][competencia.isoformat()] += sinal * valor
        linha["total"] += sinal * valor

    totais_mes = {chave: ZERO for chave in chaves}
    resultado = []
    for linha in sorted(linhas.values(), key=lambda l: l["nome"]):
        valores = {chave: linha["valores"].get(chave, ZERO) for chave in chaves}
        for chave, valor in valores.items():
            totais_mes[chave] += valor
        resultado.append({
            "id": linha["id"],
            "nome": linha["nome"],
            "tipo": linha["tipo"],
            "valores": valores,
            "total": linha["total"],
        })

    # Acumulado: responde "quando o buraco começa" sem precisar somar de cabeça.
    acumulado, corrente = {}, ZERO
    for chave in chaves:
        corrente += totais_mes[chave]
        acumulado[chave] = corrente

    return {
        "agrupamento": agrupar_por,
        "meses": chaves,
        "linhas": resultado,
        "totais": totais_mes,
        "acumulado": acumulado,
        "total_geral": sum(totais_mes.values(), ZERO),
    }


def painel_cartoes(workspace, *, inicio: date, fim: date) -> dict:
    """
    Cartão × mês, com o comprometido de cada um e o limite disponível.

    "Comprometido" é a soma das parcelas que ainda vão cair, incluindo as de
    compras antigas parceladas. É esse número que consome limite — não o gasto
    do mês.

    O saldo disponível é `limite − comprometido`. Um cartão pode estar com a
    fatura do mês baixa e mesmo assim sem limite, porque doze parcelas futuras
    já reservaram o espaço.
    """
    from apps.cartoes.models import Cartao, ParcelaCompra
    from apps.cartoes.services.ciclo import vencimento_da_fatura

    meses = meses_entre(inicio, fim)
    chaves = [m.isoformat() for m in meses]
    hoje = hoje_local().replace(day=1)

    cartoes = list(
        Cartao.objects.filter(workspace=workspace, ativo=True).order_by("apelido")
    )
    por_cartao = {str(c.id): {chave: ZERO for chave in chaves} for c in cartoes}

    parcelas = ParcelaCompra.objects.filter(
        compra__workspace=workspace,
        competencia__gte=meses[0],
        competencia__lte=meses[-1],
    ).values_list("compra__cartao_id", "competencia", "valor")

    for cartao_id, competencia, valor in parcelas:
        linha = por_cartao.get(str(cartao_id))
        if linha is not None:
            linha[competencia.isoformat()] += valor

    # Comprometido total inclui parcelas além da janela mostrada: um
    # parcelamento em 18x consome limite que a tela de 6 meses não mostra.
    comprometido = dict(
        ParcelaCompra.objects.filter(
            compra__workspace=workspace, competencia__gte=hoje
        )
        .values("compra__cartao_id")
        .annotate(total=Sum("valor"))
        .values_list("compra__cartao_id", "total")
    )

    linhas = []
    for cartao in cartoes:
        valores = por_cartao[str(cartao.id)]
        usado = comprometido.get(cartao.id, ZERO) or ZERO
        limite = cartao.limite
        disponivel = (limite - usado) if limite is not None else None

        linhas.append({
            "id": str(cartao.id),
            "apelido": cartao.apelido,
            "bandeira": cartao.bandeira,
            "ultimos_digitos": cartao.ultimos_digitos,
            "dia_fechamento": cartao.dia_fechamento,
            "dia_vencimento": cartao.dia_vencimento,
            "proximo_vencimento": vencimento_da_fatura(
                hoje, cartao.dia_vencimento, cartao.dia_fechamento
            ).isoformat(),
            "valores": valores,
            "total_periodo": sum(valores.values(), ZERO),
            "limite": limite,
            "comprometido": usado,
            "disponivel": disponivel,
            "utilizacao_pct": (
                (usado / limite * 100).quantize(Decimal("0.1"))
                if limite and limite > 0
                else None
            ),
        })

    totais_mes = {
        chave: sum((l["valores"][chave] for l in linhas), ZERO) for chave in chaves
    }
    limite_total = sum((l["limite"] or ZERO for l in linhas), ZERO)
    comprometido_total = sum((l["comprometido"] for l in linhas), ZERO)

    return {
        "meses": chaves,
        "linhas": linhas,
        "totais": totais_mes,
        "resumo": {
            "limite_total": limite_total,
            "comprometido_total": comprometido_total,
            "disponivel_total": limite_total - comprometido_total,
            "utilizacao_pct": (
                (comprometido_total / limite_total * 100).quantize(Decimal("0.1"))
                if limite_total > 0
                else None
            ),
            "cartoes_ativos": len(linhas),
        },
    }
