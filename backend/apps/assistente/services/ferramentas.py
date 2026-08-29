"""
Ferramentas que o assistente pode executar sobre os dados financeiros.

Por que não text-to-SQL
-----------------------
A tentação óbvia é dar o schema ao modelo e deixá-lo escrever SQL. Não fazemos
isso, por três razões concretas:

1. **Isolamento.** O workspace precisa ser garantido em toda query. Um SQL
   gerado pelo modelo pode simplesmente esquecer o `WHERE workspace_id = ...`,
   e o resultado é vazamento de dados financeiros entre famílias. Aqui o
   workspace é injetado pelo servidor e o modelo não tem como influenciá-lo —
   ele nem aparece no schema das ferramentas.

2. **Correção.** As regras deste sistema não são triviais: competência é
   sempre dia 1, receita e despesa têm sinal derivado do tipo, previsto e
   realizado se cruzam por competência. Um SQL plausível pode somar receita com
   despesa e devolver um número que parece certo. As ferramentas reusam
   exatamente os mesmos serviços que alimentam as telas, então o assistente e o
   gráfico nunca discordam.

3. **Superfície de ataque.** Sem SQL gerado, prompt injection não vira
   `DROP TABLE` nem `SELECT` em tabela de outro tenant. O pior que uma injeção
   consegue é chamar uma ferramenta de leitura com parâmetros estranhos, dentro
   do próprio workspace.

O custo dessa escolha é rigidez: pergunta fora do conjunto de ferramentas não é
respondida com dado. Preferimos "não sei responder isso ainda" a um número
errado com ar de autoridade — em finanças, um número errado é pior que
nenhuma resposta.

Toda ferramenta aqui é somente leitura. Nenhuma escreve, exclui ou altera.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Callable

MAX_LINHAS = 200  # teto de linhas devolvidas ao modelo, para não estourar contexto


class ErroFerramenta(Exception):
    """Falha esperada na execução de uma ferramenta (parâmetro inválido, etc.)."""


@dataclass(frozen=True)
class Ferramenta:
    nome: str
    descricao: str
    parametros: dict
    executar: Callable[..., Any]

    def schema(self) -> dict:
        """Formato de tool esperado pela API da Anthropic."""
        return {
            "name": self.nome,
            "description": self.descricao,
            "input_schema": {
                "type": "object",
                "properties": self.parametros,
                "required": [
                    k for k, v in self.parametros.items() if v.pop("_obrigatorio", False)
                ],
            },
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _competencia(valor: str | None, padrao: date | None = None) -> date:
    if not valor:
        return padrao or date.today().replace(day=1)
    try:
        partes = [int(p) for p in valor.split("-")[:2]]
        return date(partes[0], partes[1], 1)
    except (ValueError, IndexError) as exc:
        raise ErroFerramenta(
            f"Data '{valor}' não reconhecida. Use o formato AAAA-MM."
        ) from exc


def _fim_do_mes(competencia: date) -> date:
    return competencia.replace(day=calendar.monthrange(competencia.year, competencia.month)[1])


def _dinheiro(valor) -> float:
    """Decimal não é serializável em JSON; o modelo recebe float."""
    return float(Decimal(valor or 0).quantize(Decimal("0.01")))


# ---------------------------------------------------------------------------
# Implementações
# ---------------------------------------------------------------------------

def consultar_fluxo_caixa(workspace, *, inicio: str = None, fim: str = None) -> dict:
    from apps.relatorios.services import fluxo_caixa

    dt_inicio = _competencia(inicio, date.today().replace(day=1))
    dt_fim = _competencia(fim, dt_inicio.replace(year=dt_inicio.year + 1))

    linhas = fluxo_caixa.fluxo_mensal(workspace, inicio=dt_inicio, fim=dt_fim)[:MAX_LINHAS]
    return {
        "meses": [
            {
                "competencia": l["competencia"].strftime("%Y-%m"),
                "receita": _dinheiro(l["receita_prevista"]),
                "despesa": _dinheiro(l["despesa_prevista"]),
                "resultado": _dinheiro(l["resultado_previsto"]),
                "saldo_acumulado": _dinheiro(l["saldo_acumulado"]),
                "projetado": l["projetado"],
            }
            for l in linhas
        ],
        "observacao": (
            "Meses com projetado=true usam a projeção dos contratos; "
            "os demais usam o realizado quando existe."
        ),
    }


def listar_contratos(
    workspace, *, tipo: str = None, classificacao: str = None, apenas_ativos: bool = True
) -> dict:
    from apps.contratos.models import Contrato

    consulta = Contrato.objects.filter(workspace=workspace).select_related(
        "categoria", "classificacao", "estabelecimento"
    )
    if tipo:
        consulta = consulta.filter(tipo=tipo.upper())
    if classificacao:
        consulta = consulta.filter(classificacao__nome__icontains=classificacao)
    if apenas_ativos:
        consulta = consulta.filter(status="ATIVO")

    return {
        "contratos": [
            {
                "descricao": c.descricao,
                "estabelecimento": c.estabelecimento.nome,
                "tipo": c.tipo,
                "categoria": c.categoria.nome,
                "classificacao": c.classificacao.nome,
                "valor": _dinheiro(c.valor_unitario),
                "frequencia": c.get_frequencia_display(),
                "vigencia": f"{c.data_inicio} a {c.data_fim}",
            }
            for c in consulta.order_by("-valor_unitario")[:MAX_LINHAS]
        ],
        "total_encontrado": consulta.count(),
    }


def resumo_por_classificacao(workspace, *, inicio: str = None, fim: str = None) -> dict:
    from apps.relatorios.services import fluxo_caixa

    dt_inicio = _competencia(inicio, date.today().replace(month=1, day=1))
    dt_fim = _competencia(fim, date.today().replace(month=12, day=1))

    linhas = fluxo_caixa.resumo_por_classificacao(workspace, inicio=dt_inicio, fim=dt_fim)
    return {
        "periodo": f"{dt_inicio:%Y-%m} a {dt_fim:%Y-%m}",
        "classificacoes": [
            {
                "nome": l["classificacao"],
                "total": _dinheiro(l["total"]),
                "percentual": float(l["percentual"]),
            }
            for l in linhas
        ],
        "observacao": "Considera apenas despesas previstas.",
    }


def comparar_previsto_realizado(workspace, *, competencia: str = None) -> dict:
    from apps.relatorios.services import fluxo_caixa

    mes = _competencia(competencia)
    linhas = fluxo_caixa.aderencia_por_contrato(workspace, competencia=mes)
    return {
        "competencia": mes.strftime("%Y-%m"),
        "linhas": [
            {
                "descricao": l["descricao"],
                "categoria": l["categoria"],
                "previsto": _dinheiro(l["previsto"]),
                "realizado": _dinheiro(l["realizado"]),
                "desvio": _dinheiro(l["desvio"]),
                "situacao": l["situacao"],
            }
            for l in linhas[:MAX_LINHAS]
        ],
        "legenda_situacao": {
            "ok": "pago exatamente como previsto",
            "acima": "pago mais que o previsto",
            "abaixo": "pago menos que o previsto",
            "nao_pago": "previsto, mas sem pagamento registrado",
            "sem_previsao": "pago sem previsão correspondente",
        },
    }


def consultar_gastos_mercado(workspace, *, inicio: str = None, fim: str = None) -> dict:
    from apps.fiscal.services.consolidacao import consolidado_via_orm

    dt_inicio = _competencia(inicio, date.today().replace(day=1).replace(month=1))
    dt_fim = _fim_do_mes(_competencia(fim, date.today()))

    linhas = consolidado_via_orm(workspace, inicio=dt_inicio, fim=dt_fim)
    return {
        "meses": [
            {
                "competencia": l["competencia"].strftime("%Y-%m"),
                "total": _dinheiro(l["valor_total"]),
                "cupons": l["quantidade_notas"],
                "ticket_medio": _dinheiro(l["ticket_medio"]),
            }
            for l in linhas[:MAX_LINHAS]
        ]
    }


def buscar_produtos_comprados(
    workspace, *, termo: str = None, inicio: str = None, fim: str = None
) -> dict:
    """Histórico de preço de um produto nos cupons — útil para 'o café subiu?'."""
    from django.db.models import Avg, Count, Sum

    from apps.fiscal.models import ItemNotaFiscal

    consulta = ItemNotaFiscal.objects.filter(
        nota__workspace=workspace, nota__status="IMPORTADA"
    )
    if termo:
        consulta = consulta.filter(descricao__icontains=termo)
    if inicio:
        consulta = consulta.filter(nota__data_emissao__date__gte=_competencia(inicio))
    if fim:
        consulta = consulta.filter(nota__data_emissao__date__lte=_fim_do_mes(_competencia(fim)))

    linhas = (
        consulta.values("descricao")
        .annotate(
            compras=Count("id"),
            total=Sum("valor_total"),
            preco_medio=Avg("valor_unitario"),
        )
        .order_by("-total")[:MAX_LINHAS]
    )
    return {
        "produtos": [
            {
                "descricao": l["descricao"],
                "compras": l["compras"],
                "total_gasto": _dinheiro(l["total"]),
                "preco_medio": _dinheiro(l["preco_medio"]),
            }
            for l in linhas
        ]
    }


def simular_cancelamento(workspace, *, descricao: str, a_partir_de: str = None) -> dict:
    """
    Quanto sobra se um contrato for cancelado. Só simula — não altera nada.
    """
    from apps.contratos.models import Contrato

    contrato = (
        Contrato.objects.filter(workspace=workspace, descricao__icontains=descricao)
        .order_by("-valor_unitario")
        .first()
    )
    if contrato is None:
        raise ErroFerramenta(
            f"Nenhum contrato com '{descricao}' no nome. "
            "Use listar_contratos para ver os nomes disponíveis."
        )

    corte = _competencia(a_partir_de)
    restantes = contrato.parcelas.filter(competencia__gte=corte)
    economia = sum((p.valor_previsto for p in restantes), Decimal("0"))

    return {
        "contrato": contrato.descricao,
        "classificacao": contrato.classificacao.nome,
        "valor_mensal": _dinheiro(contrato.valor_unitario),
        "parcelas_restantes": restantes.count(),
        "economia_total": _dinheiro(economia),
        "a_partir_de": corte.strftime("%Y-%m"),
        "aviso": "Simulação. Nenhum contrato foi alterado.",
    }


# ---------------------------------------------------------------------------
# Registro
# ---------------------------------------------------------------------------

_MES = {"type": "string", "description": "Competência no formato AAAA-MM."}

REGISTRO: dict[str, Ferramenta] = {
    f.nome: f
    for f in [
        Ferramenta(
            nome="consultar_fluxo_caixa",
            descricao=(
                "Receitas, despesas, resultado e saldo acumulado mês a mês. "
                "Use para perguntas sobre sobra, aperto, saldo futuro ou "
                "em que mês o dinheiro acaba."
            ),
            parametros={"inicio": dict(_MES), "fim": dict(_MES)},
            executar=consultar_fluxo_caixa,
        ),
        Ferramenta(
            nome="listar_contratos",
            descricao=(
                "Lista as entradas e saídas cadastradas com valor, categoria e "
                "classificação. Use para saber o que a pessoa paga ou recebe."
            ),
            parametros={
                "tipo": {"type": "string", "enum": ["RECEITA", "DESPESA"]},
                "classificacao": {
                    "type": "string",
                    "description": "Filtro por nome, ex.: 'Ruins', 'Essenciais'.",
                },
                "apenas_ativos": {"type": "boolean"},
            },
            executar=listar_contratos,
        ),
        Ferramenta(
            nome="resumo_por_classificacao",
            descricao=(
                "Quanto pesa cada classificação (Essenciais, Bons, Ruins, "
                "Custos Operacionais) nas despesas. Use para 'onde dá para cortar'."
            ),
            parametros={"inicio": dict(_MES), "fim": dict(_MES)},
            executar=resumo_por_classificacao,
        ),
        Ferramenta(
            nome="comparar_previsto_realizado",
            descricao=(
                "Compara previsto e realizado contrato a contrato num mês. "
                "Use para 'o que saiu do previsto' ou 'o que ainda não paguei'."
            ),
            parametros={"competencia": dict(_MES)},
            executar=comparar_previsto_realizado,
        ),
        Ferramenta(
            nome="consultar_gastos_mercado",
            descricao=(
                "Total gasto em supermercado por mês, a partir dos cupons "
                "fiscais lidos, com número de cupons e ticket médio."
            ),
            parametros={"inicio": dict(_MES), "fim": dict(_MES)},
            executar=consultar_gastos_mercado,
        ),
        Ferramenta(
            nome="buscar_produtos_comprados",
            descricao=(
                "Produtos comprados nos cupons, com preço médio e total gasto. "
                "Use para perguntas sobre um item específico ou o que puxou a "
                "conta do mercado."
            ),
            parametros={
                "termo": {"type": "string", "description": "Parte do nome do produto."},
                "inicio": dict(_MES),
                "fim": dict(_MES),
            },
            executar=buscar_produtos_comprados,
        ),
        Ferramenta(
            nome="simular_cancelamento",
            descricao=(
                "Calcula a economia de cancelar um contrato a partir de um mês. "
                "Apenas simula, não altera nada."
            ),
            parametros={
                "descricao": {
                    "type": "string",
                    "description": "Nome ou parte do nome do contrato.",
                    "_obrigatorio": True,
                },
                "a_partir_de": dict(_MES),
            },
            executar=simular_cancelamento,
        ),
    ]
}


def schemas() -> list[dict]:
    return [f.schema() for f in REGISTRO.values()]


def executar(nome: str, workspace, argumentos: dict) -> dict:
    """
    Executa uma ferramenta pelo nome.

    O `workspace` é posicional e vem do servidor: mesmo que o modelo tente
    mandar um `workspace` nos argumentos, ele é descartado aqui.
    """
    ferramenta = REGISTRO.get(nome)
    if ferramenta is None:
        raise ErroFerramenta(f"Ferramenta '{nome}' não existe.")

    permitidos = set(ferramenta.parametros.keys())
    limpos = {k: v for k, v in (argumentos or {}).items() if k in permitidos}
    return ferramenta.executar(workspace, **limpos)
