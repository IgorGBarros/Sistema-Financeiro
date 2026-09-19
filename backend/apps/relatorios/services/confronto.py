"""
Confronto entre previsto e realizado, competência a competência.

Conceito portado do modelo do Power BI, medida `Valor_Recorrente_ou_Prestacoes`:

    IF(NOT ISBLANK(ValorRecorrente), ValorRecorrente, ValorPrestacoes)

Ou seja: **o realizado substitui o previsto naquela competência**. Enquanto a
nota não chega, vale a projeção; quando chega, ela manda. É o que permite somar
uma série que mistura passado e futuro sem contar nada duas vezes.

Um cuidado que o DAX original não tem
-------------------------------------
Substituir cegamente quebra no pagamento parcial. Se a parcela prevista é
R$ 1.000 e só R$ 400 foram pagos, trocar 1.000 por 400 faz o mês parecer mais
barato do que é — sendo que ainda faltam R$ 600. Aqui a substituição só vale
quando a competência já fechou; no mês corrente o efetivo é
`max(previsto, realizado)`, porque o resto ainda pode chegar.

Duas correções em relação às medidas originais
----------------------------------------------
`ValoresFuturos_2024` e `ValoresHistorico<2024` comparam mês e ano em campos
separados:

    MONTH(Data) > MesAtual && YEAR(Data) = AnoAtual

Isso falha em dezembro: nenhum mês é maior que 12, e a medida zera. O
histórico, com `MONTH < MesAtual && YEAR < AnoAtual`, perde tudo que aconteceu
em meses posteriores ao atual em anos anteriores — em março, ignora de março a
dezembro do ano passado. Medido numa série de 36 parcelas: 12 de 14 somem.

A comparação correta é entre competências inteiras, que é o que este módulo
faz: `competencia < hoje.replace(day=1)`.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.db.models import Sum

from apps.common.datas import competencia_atual
from apps.relatorios.services.matriz import meses_entre

ZERO = Decimal("0")


def normalizar(texto: str) -> str:
    """Caixa alta, sem acento e sem pontuação — para casar descrições."""
    sem_acento = unicodedata.normalize("NFKD", texto or "")
    limpo = "".join(c for c in sem_acento if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]", " ", limpo.upper())).strip()


def efetivo(previsto: Decimal, realizado: Decimal, *, fechada: bool) -> Decimal:
    """
    Valor que vale para aquela competência.

    Fechada: manda o realizado, mesmo sendo zero — se o mês passou e nada foi
    pago, a despesa não aconteceu, e insistir na projeção seria inventar
    movimento.

    Aberta: o maior dos dois. O realizado pode ser parcial e o resto ainda
    chegar; usar só ele faria o mês parecer mais barato do que vai terminar.
    """
    return realizado if fechada else max(previsto, realizado)


def confronto_mensal(workspace, *, inicio: date, fim: date, contrato=None) -> dict:
    """
    Série de previsto, realizado e efetivo por competência.

    O `efetivo` é a linha para somar o período: ele já resolve a sobreposição
    entre projeção e o que aconteceu de fato.
    """
    from apps.common.models import TipoLancamento
    from apps.contratos.models import ParcelaPrevista
    from apps.realizados.models import Realizado

    meses = meses_entre(inicio, fim)
    chaves = [m.isoformat() for m in meses]
    corrente = competencia_atual()

    previstas = ParcelaPrevista.objects.filter(
        contrato__workspace=workspace,
        competencia__gte=meses[0],
        competencia__lte=meses[-1],
    ).exclude(contrato__status="ENCERRADO")
    realizados = Realizado.objects.filter(
        workspace=workspace, competencia__gte=meses[0], competencia__lte=meses[-1]
    )
    if contrato is not None:
        previstas = previstas.filter(contrato=contrato)
        realizados = realizados.filter(contrato=contrato)

    def agrupar(consulta, campo_tipo, campo_valor):
        mapa: dict[tuple[str, str], Decimal] = defaultdict(lambda: ZERO)
        linhas = (
            consulta.values("competencia", campo_tipo)
            .annotate(total=Sum(campo_valor))
            .values_list("competencia", campo_tipo, "total")
        )
        for competencia, tipo, total in linhas:
            mapa[(competencia.isoformat(), tipo)] += total or ZERO
        return mapa

    mapa_previsto = agrupar(previstas, "contrato__tipo", "valor_previsto")
    mapa_realizado = agrupar(realizados, "tipo", "valor")

    linhas = []
    acumulado = ZERO
    for chave, competencia in zip(chaves, meses):
        fechada = competencia < corrente
        registro: dict = {"competencia": chave, "fechada": fechada}
        resultado = ZERO

        for tipo, sinal, rotulo in (
            (TipoLancamento.RECEITA, 1, "receita"),
            (TipoLancamento.DESPESA, -1, "despesa"),
        ):
            previsto = mapa_previsto.get((chave, tipo), ZERO)
            realizado = mapa_realizado.get((chave, tipo), ZERO)
            valor = efetivo(previsto, realizado, fechada=fechada)

            registro[f"{rotulo}_prevista"] = previsto
            registro[f"{rotulo}_realizada"] = realizado
            registro[f"{rotulo}_efetiva"] = valor
            registro[f"{rotulo}_desvio"] = realizado - previsto
            resultado += sinal * valor

        acumulado += resultado
        registro["resultado_efetivo"] = resultado
        registro["saldo_acumulado"] = acumulado
        linhas.append(registro)

    return {
        "meses": chaves,
        "linhas": linhas,
        "competencia_corrente": corrente.isoformat(),
    }


def saldo_a_realizar(workspace, *, contrato=None) -> dict:
    """
    Quanto do previsto ainda não virou realizado.

    Equivale ao `Saldo A Faturar` do modelo original — lá era contrato menos
    faturado; aqui é projeção menos o que foi pago ou recebido.

    Só conta competências fechadas, porque o mês corrente ainda está em
    andamento e apareceria como inadimplência falsa.
    """
    from apps.contratos.models import Contrato, ParcelaPrevista
    from apps.realizados.models import Realizado

    corrente = competencia_atual()
    contratos = Contrato.objects.filter(workspace=workspace, status="ATIVO")
    if contrato is not None:
        contratos = contratos.filter(pk=contrato.pk)

    previsto_total = dict(
        ParcelaPrevista.objects.filter(contrato__in=contratos)
        .values("contrato_id")
        .annotate(total=Sum("valor_previsto"))
        .values_list("contrato_id", "total")
    )
    previsto_fechado = dict(
        ParcelaPrevista.objects.filter(contrato__in=contratos, competencia__lt=corrente)
        .values("contrato_id")
        .annotate(total=Sum("valor_previsto"))
        .values_list("contrato_id", "total")
    )
    realizado_fechado = dict(
        Realizado.objects.filter(contrato__in=contratos, competencia__lt=corrente)
        .values("contrato_id")
        .annotate(total=Sum("valor"))
        .values_list("contrato_id", "total")
    )

    linhas = []
    for item in contratos.select_related("estabelecimento"):
        total = previsto_total.get(item.id) or ZERO
        ate_agora = previsto_fechado.get(item.id) or ZERO
        realizado = realizado_fechado.get(item.id) or ZERO
        linhas.append({
            "contrato": str(item.id),
            "descricao": item.descricao,
            "estabelecimento": item.estabelecimento.nome,
            "tipo": item.tipo,
            "previsto_total": total,
            "previsto_ate_agora": ate_agora,
            "realizado": realizado,
            # Positivo: previsto que não se concretizou — conta não paga, ou
            # receita que não entrou. Negativo: veio mais que o previsto.
            "em_aberto": ate_agora - realizado,
            "saldo_futuro": total - ate_agora,
        })

    return {
        "competencia_corrente": corrente.isoformat(),
        "linhas": sorted(linhas, key=lambda l: -abs(l["em_aberto"])),
        "total_em_aberto": sum((l["em_aberto"] for l in linhas), ZERO),
    }


def vincular_realizados_por_descricao(workspace, *, aplicar: bool = False) -> dict:
    """
    Liga realizados órfãos ao contrato de mesma descrição.

    O modelo original casava recorrência e faturamento por competência mais
    código do item. Aqui o equivalente é competência mais descrição
    normalizada, porque lançamento importado ou digitado à mão chega sem o
    vínculo com o contrato.

    Com `aplicar=False` apenas relata o que casaria. Vincular errado é pior
    que deixar órfão: o órfão aparece na lista de revisão, o vínculo errado se
    esconde dentro de um total que parece certo.
    """
    from apps.contratos.models import Contrato
    from apps.realizados.models import Realizado

    orfaos = Realizado.objects.filter(workspace=workspace, contrato__isnull=True)
    contratos = {
        normalizar(c.descricao): c for c in Contrato.objects.filter(workspace=workspace)
    }

    casados, sem_par = [], []
    for realizado in orfaos:
        alvo = contratos.get(normalizar(realizado.descricao))
        # A competência precisa cair dentro da vigência; senão é homônimo.
        dentro = (
            alvo
            and alvo.data_inicio.replace(day=1) <= realizado.competencia
            <= alvo.data_fim.replace(day=1)
        )
        registro = {
            "realizado": str(realizado.id),
            "descricao": realizado.descricao,
            "competencia": realizado.competencia.isoformat(),
            "valor": str(realizado.valor),
        }
        if dentro:
            registro |= {
                "contrato": str(alvo.id),
                "contrato_descricao": alvo.descricao,
            }
            casados.append(registro)
            if aplicar:
                Realizado.objects.filter(pk=realizado.pk).update(contrato=alvo)
        else:
            sem_par.append(registro)

    return {
        "aplicado": aplicar,
        "vinculados": casados,
        "sem_correspondencia": sem_par,
        "total_orfaos": len(casados) + len(sem_par),
    }
