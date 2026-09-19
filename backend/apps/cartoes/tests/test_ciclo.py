"""
Ciclo de faturamento do cartão.

Duas regras aqui são fonte de erro recorrente em controle financeiro:
a data de corte e a divisão de centavos.
"""

from datetime import date
from decimal import Decimal

import pytest

from apps.cartoes.services.ciclo import (
    competencia_da_compra,
    dividir_parcelas,
    projetar_parcelas,
    vencimento_da_fatura,
)


class TestCompetenciaDaCompra:
    def test_antes_do_fechamento_entra_na_fatura_do_mes(self):
        assert competencia_da_compra(date(2026, 3, 10), dia_fechamento=25) == date(2026, 3, 1)

    def test_no_dia_do_fechamento_ainda_entra(self):
        assert competencia_da_compra(date(2026, 3, 25), dia_fechamento=25) == date(2026, 3, 1)

    def test_depois_do_fechamento_vai_para_a_seguinte(self):
        # A regra que mais gera surpresa: comprar dia 26 num cartão que fecha
        # dia 25 significa pagar só no mês seguinte.
        assert competencia_da_compra(date(2026, 3, 26), dia_fechamento=25) == date(2026, 4, 1)

    def test_virada_de_ano(self):
        assert competencia_da_compra(date(2026, 12, 28), dia_fechamento=25) == date(2027, 1, 1)


class TestVencimentoDaFatura:
    def test_vencimento_depois_do_fechamento_no_mesmo_mes(self):
        # Fecha dia 5, vence dia 15: os dois no mesmo mês.
        assert vencimento_da_fatura(date(2026, 3, 1), dia_vencimento=15, dia_fechamento=5) == date(2026, 3, 15)

    def test_vencimento_antes_do_fechamento_cai_no_mes_seguinte(self):
        # Fecha dia 25, vence dia 5: o dia 5 é do mês que vem.
        assert vencimento_da_fatura(date(2026, 3, 1), dia_vencimento=5, dia_fechamento=25) == date(2026, 4, 5)

    def test_dia_31_em_mes_de_30(self):
        assert vencimento_da_fatura(date(2026, 4, 1), dia_vencimento=31, dia_fechamento=1) == date(2026, 4, 30)

    def test_dia_30_em_fevereiro(self):
        assert vencimento_da_fatura(date(2026, 2, 1), dia_vencimento=30, dia_fechamento=1) == date(2026, 2, 28)


class TestDividirParcelas:
    def test_divisao_exata(self):
        assert dividir_parcelas(Decimal("300.00"), 3) == [Decimal("100.00")] * 3

    def test_sobra_de_centavos_vai_para_a_primeira(self):
        # 100/3 = 33,333... A sobra precisa ir para alguma parcela, senão a
        # soma não fecha e a conciliação com a fatura nunca bate.
        parcelas = dividir_parcelas(Decimal("100.00"), 3)
        assert parcelas == [Decimal("33.34"), Decimal("33.33"), Decimal("33.33")]

    def test_soma_sempre_fecha_com_o_total(self):
        for total, n in [("100.00", 3), ("0.01", 2), ("1234.57", 7), ("999.99", 12)]:
            parcelas = dividir_parcelas(Decimal(total), n)
            assert sum(parcelas) == Decimal(total), f"{total} em {n}x"

    def test_parcela_unica(self):
        assert dividir_parcelas(Decimal("49.90"), 1) == [Decimal("49.90")]

    def test_quantidade_invalida(self):
        with pytest.raises(ValueError):
            dividir_parcelas(Decimal("10.00"), 0)


class TestProjetarParcelas:
    def test_parcelas_mensais_consecutivas(self):
        projecao = projetar_parcelas(
            data_compra=date(2026, 3, 10),
            valor_total=Decimal("300.00"),
            quantidade=3,
            dia_fechamento=25,
        )
        assert [c for _, c, _ in projecao] == [
            date(2026, 3, 1), date(2026, 4, 1), date(2026, 5, 1)
        ]

    def test_compra_apos_o_fechamento_desloca_tudo(self):
        projecao = projetar_parcelas(
            data_compra=date(2026, 3, 26),
            valor_total=Decimal("300.00"),
            quantidade=3,
            dia_fechamento=25,
        )
        assert [c for _, c, _ in projecao][0] == date(2026, 4, 1)

    def test_soma_das_parcelas_e_o_valor_da_compra(self):
        projecao = projetar_parcelas(
            data_compra=date(2026, 1, 5),
            valor_total=Decimal("1000.00"),
            quantidade=12,
            dia_fechamento=25,
        )
        assert sum(v for _, _, v in projecao) == Decimal("1000.00")

    def test_parcelamento_longo_atravessa_anos(self):
        projecao = projetar_parcelas(
            data_compra=date(2026, 11, 5),
            valor_total=Decimal("2400.00"),
            quantidade=18,
            dia_fechamento=25,
        )
        assert len(projecao) == 18
        assert projecao[-1][1] == date(2028, 4, 1)

    def test_nao_ha_dupla_contagem_num_mes(self):
        """
        A propriedade central do desenho: a soma das parcelas que caem num mês
        é a despesa daquele mês. Não existe um lançamento separado da fatura
        que somaria de novo.
        """
        compras = [
            projetar_parcelas(
                data_compra=date(2026, 3, 10), valor_total=Decimal("300.00"),
                quantidade=3, dia_fechamento=25,
            ),
            projetar_parcelas(
                data_compra=date(2026, 3, 15), valor_total=Decimal("150.00"),
                quantidade=1, dia_fechamento=25,
            ),
        ]
        marco = sum(
            valor
            for projecao in compras
            for _, competencia, valor in projecao
            if competencia == date(2026, 3, 1)
        )
        # 100 da primeira parcela + 150 à vista. Não 450 (compra + fatura).
        assert marco == Decimal("250.00")
