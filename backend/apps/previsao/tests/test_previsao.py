"""
Modelos de previsão, seleção por backtest e simulação de cenários.

Séries sintéticas com comportamento conhecido: assim dá para afirmar qual
modelo *deveria* vencer e verificar se o backtest realmente o escolhe. Testar
só com dado real deixaria passar um seletor que escolhe sempre o mesmo.
"""

import statistics

import pytest

from apps.previsao.services import backtest, cenarios, modelos


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------

class TestModelos:
    def test_ingenuo_repete_o_ultimo(self):
        assert modelos.ingenuo([10, 20, 30], 3) == [30, 30, 30]

    def test_ingenuo_com_serie_vazia(self):
        assert modelos.ingenuo([], 2) == [0.0, 0.0]

    def test_mediana_ignora_mes_atipico(self):
        """
        O motivo de a mediana existir aqui.

        Um conserto de carro de R$ 5.000 no meio de meses de R$ 1.000 move a
        média para R$ 1.800 e faz o sistema projetar esse patamar para sempre.
        A mediana continua em R$ 1.000.
        """
        serie = [1000, 1000, 5000, 1000, 1000, 1000]
        assert modelos.mediana_movel(6)(serie, 1)[0] == 1000
        assert modelos.media_movel(6)(serie, 1)[0] > 1600

    def test_tendencia_capta_crescimento(self):
        serie = [100, 110, 120, 130, 140, 150]
        previsao = modelos.tendencia_linear(serie, 3)
        assert previsao == pytest.approx([160, 170, 180], abs=0.01)

    def test_tendencia_nao_projeta_negativo(self):
        """Despesa em queda acentuada não vira receita pela inclinação."""
        serie = [500, 400, 300, 200, 100, 50]
        assert all(v >= 0 for v in modelos.tendencia_linear(serie, 12))

    def test_tendencia_com_serie_plana(self):
        assert modelos.tendencia_linear([100] * 6, 2) == pytest.approx([100, 100])

    def test_holt_segue_a_tendencia(self):
        serie = [100, 110, 120, 130, 140, 150]
        previsao = modelos.suavizacao_holt()(serie, 1)[0]
        assert previsao > 150

    def test_sazonal_repete_o_ano_anterior(self):
        serie = list(range(1, 25))  # 24 meses
        previsao = modelos.sazonal_ingenuo(12)(serie, 3)
        assert previsao == [13.0, 14.0, 15.0]

    def test_modelo_declara_minimo_de_observacoes(self):
        """
        Sem esse mínimo, ajustar tendência com dois pontos produziria
        qualquer coisa e o backtest não teria como reprovar.
        """
        for modelo in modelos.REGISTRO:
            assert modelo.minimo_observacoes >= 1
        assert {m.nome for m in modelos.disponiveis(3)} == {
            "ingenuo", "mediana_3", "media_3"
        }
        assert "sazonal" not in {m.nome for m in modelos.disponiveis(12)}
        assert "sazonal" in {m.nome for m in modelos.disponiveis(24)}


# ---------------------------------------------------------------------------
# Backtest
# ---------------------------------------------------------------------------

class TestBacktest:
    def test_historico_curto_nao_e_confiavel(self):
        selecao = backtest.selecionar([100, 120])
        assert selecao.confiavel is False
        assert selecao.modelo.nome == "ingenuo"
        assert "histórico" in selecao.motivo

    def test_serie_constante_fica_no_ingenuo(self):
        """
        Com valor sempre igual, todo modelo acerta. Empatado, fica o mais
        simples — modelo complexo sem ganho medido é só mais uma explicação
        para dar quando errar.
        """
        selecao = backtest.selecionar([1000] * 10)
        assert selecao.modelo.nome == "ingenuo"

    def test_serie_com_tendencia_escolhe_tendencia(self):
        serie = [100 + 20 * i for i in range(12)]
        selecao = backtest.selecionar(serie)
        assert selecao.modelo.nome in ("tendencia", "holt")
        assert selecao.ganho_sobre_ingenuo > 0.5

    def test_serie_ruidosa_prefere_modelo_robusto(self):
        """Ruído em torno de um patamar: medianas e médias ganham do ingênuo."""
        serie = [1000, 1400, 800, 1100, 900, 1300, 950, 1050, 1200, 850, 1150, 1000]
        selecao = backtest.selecionar(serie)
        assert selecao.modelo.nome != "ingenuo"
        assert selecao.confiavel is True

    def test_reporta_o_ganho_sobre_o_ingenuo(self):
        selecao = backtest.selecionar([100 + 10 * i for i in range(12)])
        assert selecao.ganho_sobre_ingenuo is not None
        assert selecao.resultado.mae < 20

    def test_backtest_nao_vaza_o_futuro(self):
        """
        Cada previsão avaliada usa só dados anteriores a ela. Sem isso, um
        modelo pareceria ótimo no teste e falharia em produção.
        """
        serie = [100, 200, 300, 400, 500]
        resultado = backtest.avaliar(modelos.por_nome("ingenuo"), serie)
        # Prevê 400 com [100,200,300] -> erro 100; depois 500 com erro 100.
        assert resultado.avaliacoes == 2
        assert resultado.residuos == [100.0, 100.0]

    def test_intervalo_empirico_e_assimetrico(self):
        """
        Gasto pessoal tem cauda de um lado só. Uma normal simétrica
        subestimaria justamente o cenário que importa para planejar.
        """
        residuos = [-50, -30, -20, -10, 0, 10, 20, 40, 900]
        baixo, alto = backtest.intervalo(residuos, confianca=0.80)
        assert abs(alto) > abs(baixo)

    def test_intervalo_com_poucos_residuos(self):
        assert backtest.intervalo([10, 20]) == (0.0, 0.0)


# ---------------------------------------------------------------------------
# Cenários
# ---------------------------------------------------------------------------

class TestSimulacao:
    def test_sem_residuos_devolve_projecao_sem_faixa(self):
        simulacao = cenarios.simular(
            competencias=["2026-01-01", "2026-02-01"],
            deterministico=[1000.0, 1000.0],
            estimado=[-200.0, -200.0],
            residuos=[],
        )
        assert simulacao.confiavel is False
        assert "incerteza" in simulacao.aviso
        assert simulacao.meses[0].saldo_p10 == simulacao.meses[0].saldo_p90

    def test_faixa_alarga_com_o_horizonte(self):
        """
        Prever daqui a um mês é diferente de prever daqui a doze. A incerteza
        acumulada segue a raiz do horizonte.
        """
        simulacao = cenarios.simular(
            competencias=[f"2026-{m:02d}-01" for m in range(1, 13)],
            deterministico=[1000.0] * 12,
            estimado=[-500.0] * 12,
            residuos=[-200, -100, 0, 100, 200],
            cenarios=2000,
        )
        primeira = simulacao.meses[0].saldo_p90 - simulacao.meses[0].saldo_p10
        ultima = simulacao.meses[-1].saldo_p90 - simulacao.meses[-1].saldo_p10
        assert ultima > primeira * 2

    def test_probabilidade_de_negativo(self):
        simulacao = cenarios.simular(
            competencias=["2026-01-01"],
            deterministico=[0.0],
            estimado=[0.0],
            residuos=[-1000, -500, 500, 1000],
            saldo_inicial=0.0,
            cenarios=4000,
        )
        # Metade dos resíduos é negativa, então a chance deve rondar 50%.
        assert 0.4 < simulacao.meses[0].probabilidade_negativo < 0.6

    def test_saldo_sobra_em_todos_os_cenarios(self):
        simulacao = cenarios.simular(
            competencias=["2026-01-01", "2026-02-01"],
            deterministico=[5000.0, 5000.0],
            estimado=[-100.0, -100.0],
            residuos=[-50, 0, 50],
            cenarios=1000,
        )
        assert simulacao.probabilidade_algum_mes_negativo == 0.0
        assert simulacao.primeiro_mes_de_risco is None

    def test_resultado_reprodutivel(self):
        """
        Probabilidade que muda a cada F5 destrói a confiança na tela inteira,
        e o ganho de aleatoriedade real aqui é zero.
        """
        argumentos = dict(
            competencias=["2026-01-01"] * 1,
            deterministico=[0.0],
            estimado=[0.0],
            residuos=[-100, 0, 100],
            cenarios=500,
        )
        a = cenarios.simular(**argumentos)
        b = cenarios.simular(**argumentos)
        assert a.saldo_final_p50 == b.saldo_final_p50

    def test_quantis_ordenados(self):
        simulacao = cenarios.simular(
            competencias=[f"2026-{m:02d}-01" for m in range(1, 7)],
            deterministico=[1000.0] * 6,
            estimado=[-800.0] * 6,
            residuos=[-300, -100, 0, 100, 300],
            cenarios=2000,
        )
        for mes in simulacao.meses:
            assert mes.saldo_p10 <= mes.saldo_p50 <= mes.saldo_p90

    def test_resumo_avisa_quando_o_risco_e_alto(self):
        simulacao = cenarios.simular(
            competencias=["2026-01-01", "2026-02-01"],
            deterministico=[-1000.0, -1000.0],
            estimado=[0.0, 0.0],
            residuos=[-100, 0, 100],
            cenarios=1000,
        )
        texto = cenarios.resumo_legivel(simulacao)
        assert "Atenção" in texto
