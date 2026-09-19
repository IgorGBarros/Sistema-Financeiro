"""Testes da projeção — equivalência com a lógica DAX do Power BI."""

from datetime import date
from decimal import Decimal

import pytest

from apps.contratos.services.projecao import (
    edate, meses_calendario, numero_de_meses, projetar,
)

# ---------------------------------------------------------------------------
# Projeção
# ---------------------------------------------------------------------------

class TestEdate:
    def test_soma_simples(self):
        assert edate(date(2026, 1, 6), 1) == date(2026, 2, 6)

    def test_vira_o_ano(self):
        assert edate(date(2026, 12, 10), 1) == date(2027, 1, 10)

    def test_clampa_no_ultimo_dia_do_mes(self):
        # 31 de janeiro + 1 mês = 28 de fevereiro, não 3 de março.
        assert edate(date(2026, 1, 31), 1) == date(2026, 2, 28)

    def test_ano_bissexto(self):
        assert edate(date(2028, 1, 31), 1) == date(2028, 2, 29)


class TestNumeroDeMeses:
    def test_datediff_conta_fronteiras_nao_dias(self):
        # A armadilha do DAX: 1 dia de diferença, 1 mês de DATEDIFF.
        assert meses_calendario(date(2026, 1, 31), date(2026, 2, 1)) == 1

    def test_ajuste_do_mes_final_quando_dia_fim_maior(self):
        assert numero_de_meses(date(2026, 1, 6), date(2027, 12, 6)) == 24

    def test_sem_ajuste_quando_dia_fim_menor(self):
        assert numero_de_meses(date(2026, 1, 15), date(2027, 12, 10)) == 23

    def test_inicio_igual_fim_gera_uma_parcela(self):
        # 13º salário, restituição de IR: evento único.
        assert numero_de_meses(date(2026, 11, 20), date(2026, 11, 20)) == 1

    def test_nunca_negativo(self):
        assert numero_de_meses(date(2027, 1, 1), date(2026, 1, 1)) == 0


class TestProjetar:
    @pytest.mark.parametrize(
        "descricao,inicio,fim,frequencia,esperado_qtd,esperada_ultima",
        [
            ("Salário", date(2026, 1, 6), date(2027, 12, 6), "M", 24, date(2027, 12, 6)),
            ("Colégio", date(2026, 1, 10), date(2026, 12, 10), "M", 12, date(2026, 12, 10)),
            ("Ultragaz", date(2026, 1, 15), date(2027, 12, 10), "M", 23, date(2027, 11, 15)),
            ("13º", date(2026, 11, 20), date(2026, 11, 20), "A", 1, date(2026, 11, 20)),
        ],
    )
    def test_contratos_da_planilha(
        self, descricao, inicio, fim, frequencia, esperado_qtd, esperada_ultima
    ):
        parcelas = projetar(
            data_inicio=inicio, data_fim=fim,
            valor_unitario=Decimal("100"), frequencia=frequencia,
        )
        assert len(parcelas) == esperado_qtd, descricao
        assert parcelas[0].data_planejada == inicio
        assert parcelas[-1].data_planejada == esperada_ultima

    def test_competencia_e_sempre_dia_um(self):
        parcelas = projetar(
            data_inicio=date(2026, 1, 15), data_fim=date(2026, 6, 15),
            valor_unitario=Decimal("50"),
        )
        assert all(p.competencia.day == 1 for p in parcelas)

    def test_valor_total_do_contrato(self):
        parcelas = projetar(
            data_inicio=date(2026, 1, 10), data_fim=date(2026, 12, 10),
            valor_unitario=Decimal("1480"),
        )
        assert sum(p.valor_previsto for p in parcelas) == Decimal("17760.00")

    def test_rescisao_corta_a_projecao(self):
        parcelas = projetar(
            data_inicio=date(2026, 1, 10), data_fim=date(2027, 12, 10),
            valor_unitario=Decimal("100"), data_rescisao=date(2026, 6, 10),
        )
        assert len(parcelas) == 6
        assert parcelas[-1].data_planejada == date(2026, 6, 10)

    def test_frequencia_anual_avanca_doze_meses(self):
        parcelas = projetar(
            data_inicio=date(2026, 3, 1), data_fim=date(2029, 3, 1),
            valor_unitario=Decimal("1200"), frequencia="A",
        )
        assert [p.data_planejada.year for p in parcelas] == [2026, 2027, 2028, 2029]

    def test_reajuste_anual_aplica_no_aniversario(self):
        parcelas = projetar(
            data_inicio=date(2026, 1, 1), data_fim=date(2027, 12, 1),
            valor_unitario=Decimal("1000"), reajuste_anual_pct=Decimal("10"),
        )
        assert parcelas[0].valor_previsto == Decimal("1000.00")
        assert parcelas[11].valor_previsto == Decimal("1000.00")   # mês 12, ainda ano 1
        assert parcelas[12].valor_previsto == Decimal("1100.00")   # aniversário

    def test_periodo_invertido_devolve_vazio(self):
        assert projetar(
            data_inicio=date(2027, 1, 1), data_fim=date(2026, 1, 1),
            valor_unitario=Decimal("10"),
        ) == []

    def test_frequencia_unica_gera_uma_parcela(self):
        parcelas = projetar(
            data_inicio=date(2026, 2, 5), data_fim=date(2029, 2, 5),
            valor_unitario=Decimal("2150"), frequencia="U",
        )
        assert len(parcelas) == 1
