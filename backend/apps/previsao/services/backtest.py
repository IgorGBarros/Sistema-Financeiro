"""
Backtesting: escolhe o modelo pelo erro medido, não por preferência.

É aqui que está o aprendizado. Nenhum modelo é escolhido por ser mais moderno
ou por parecer adequado ao domínio — cada um é testado contra o histórico real
da série, com origem móvel, e vence quem erra menos.

Origem móvel (rolling origin)
-----------------------------
Treina com os primeiros k meses, prevê o k+1, compara com o real. Avança um mês
e repete. Cada previsão avaliada usa apenas dados anteriores a ela, o que
elimina vazamento — o erro clássico de testar um modelo com dados que ele não
teria no momento da decisão.

    jan fev mar | abr        treina com 3, prevê abr
    jan..abr    | mai        treina com 4, prevê mai
    jan..mai    | jun        treina com 5, prevê jun

Por que MAE, e não MAPE nem RMSE
--------------------------------
**MAE** (erro absoluto médio) está em reais e responde direto: "este modelo
erra R$ 180 por mês, em média". É o número que serve para decidir.

**MAPE** divide pelo valor real e explode quando o mês foi próximo de zero —
comum em categoria que não tem movimento todo mês.

**RMSE** eleva ao quadrado e deixa um único mês atípico dominar a escolha.
Gasto pessoal é cheio de mês atípico; escolher o modelo por causa da viagem de
julho é escolher errado para os outros onze meses.

Ganho sobre o ingênuo
---------------------
Todo resultado reporta quanto o modelo escolhido melhora sobre "mês que vem
igual ao passado". Se o ganho for negativo ou irrisório, o sistema diz isso em
vez de fingir sofisticação — e usa o ingênuo, que é mais barato de explicar.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field

from apps.previsao.services import modelos
from apps.previsao.services.modelos import Modelo, Serie

# Mínimo para qualquer avaliação: três para treinar, um para testar.
MINIMO_PARA_BACKTEST = 4
# Abaixo deste ganho relativo sobre o ingênuo, não vale trocar de modelo.
GANHO_MINIMO = 0.05


@dataclass
class ResultadoModelo:
    modelo: str
    descricao: str
    mae: float
    # Erros de cada previsão do backtest. Viram o intervalo de previsão, por
    # quantis empíricos — sem supor distribuição normal, que série financeira
    # curta raramente tem.
    residuos: list[float] = field(default_factory=list)
    avaliacoes: int = 0


@dataclass
class Selecao:
    modelo: Modelo
    resultado: ResultadoModelo | None
    ganho_sobre_ingenuo: float | None
    candidatos: list[ResultadoModelo]
    observacoes: int
    confiavel: bool
    motivo: str


def avaliar(modelo: Modelo, serie: Serie, *, minimo_treino: int = 3) -> ResultadoModelo | None:
    """Origem móvel sobre a série inteira, um passo à frente."""
    valores = [float(v) for v in serie]
    if len(valores) < max(MINIMO_PARA_BACKTEST, modelo.minimo_observacoes + 1):
        return None

    inicio = max(minimo_treino, modelo.minimo_observacoes)
    residuos = []
    for corte in range(inicio, len(valores)):
        previsto = modelo.prever(valores[:corte], 1)[0]
        residuos.append(valores[corte] - previsto)

    if not residuos:
        return None

    return ResultadoModelo(
        modelo=modelo.nome,
        descricao=modelo.descricao,
        mae=statistics.fmean(abs(r) for r in residuos),
        residuos=residuos,
        avaliacoes=len(residuos),
    )


def selecionar(serie: Serie) -> Selecao:
    """
    Escolhe o melhor modelo para esta série.

    Com histórico curto demais para backtest, devolve o ingênuo marcado como
    não confiável. Prever assim mesmo e omitir a ressalva seria pior: o número
    apareceria na tela com a mesma aparência de um que foi validado.
    """
    valores = [float(v) for v in serie]
    n = len(valores)

    if n < MINIMO_PARA_BACKTEST:
        return Selecao(
            modelo=modelos.por_nome("ingenuo"),
            resultado=None,
            ganho_sobre_ingenuo=None,
            candidatos=[],
            observacoes=n,
            confiavel=False,
            motivo=(
                f"Só {n} mês(es) de histórico. São necessários "
                f"{MINIMO_PARA_BACKTEST} para validar qualquer modelo."
            ),
        )

    candidatos = [
        resultado
        for modelo in modelos.disponiveis(n)
        if (resultado := avaliar(modelo, valores)) is not None
    ]
    if not candidatos:
        return Selecao(
            modelo=modelos.por_nome("ingenuo"),
            resultado=None,
            ganho_sobre_ingenuo=None,
            candidatos=[],
            observacoes=n,
            confiavel=False,
            motivo="Nenhum modelo pôde ser avaliado com este histórico.",
        )

    candidatos.sort(key=lambda r: r.mae)
    melhor = candidatos[0]
    base = next((c for c in candidatos if c.modelo == "ingenuo"), None)

    ganho = None
    if base and base.mae > 0:
        ganho = (base.mae - melhor.mae) / base.mae

    # Empate técnico com o ingênuo: fica o ingênuo. Modelo mais complexo sem
    # ganho medido é só uma explicação a mais para dar quando errar.
    if base and (ganho is None or ganho < GANHO_MINIMO):
        melhor = base
        motivo = (
            "Nenhum modelo superou de forma relevante a repetição do último "
            "mês. Usando o mais simples."
        )
    else:
        motivo = f"Menor erro médio no backtest: R$ {melhor.mae:,.2f} por mês."

    return Selecao(
        modelo=modelos.por_nome(melhor.modelo),
        resultado=melhor,
        ganho_sobre_ingenuo=ganho,
        candidatos=candidatos,
        observacoes=n,
        # Seis meses é o mínimo para o erro medido significar alguma coisa:
        # com quatro, o backtest avalia uma única previsão.
        confiavel=n >= 6 and melhor.avaliacoes >= 3,
        motivo=motivo,
    )


def intervalo(residuos: list[float], confianca: float = 0.80) -> tuple[float, float]:
    """
    Faixa de erro por quantis empíricos dos resíduos do backtest.

    Empírico, e não `média ± 2σ`, porque gasto pessoal é assimétrico: existe
    mês muito acima da média, quase nenhum muito abaixo. A normal simétrica
    subestimaria justamente a cauda que importa para planejamento.
    """
    if len(residuos) < 3:
        return (0.0, 0.0)

    ordenados = sorted(residuos)
    margem = (1 - confianca) / 2

    def quantil(p: float) -> float:
        posicao = p * (len(ordenados) - 1)
        baixo = int(posicao)
        alto = min(baixo + 1, len(ordenados) - 1)
        peso = posicao - baixo
        return ordenados[baixo] * (1 - peso) + ordenados[alto] * peso

    return (quantil(margem), quantil(1 - margem))
