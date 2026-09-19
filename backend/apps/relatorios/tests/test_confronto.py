"""
Confronto previsto × realizado.

A regra central — o realizado substitui o previsto na competência — vem do
modelo do Power BI. O que se testa aqui é justamente onde a substituição
ingênua erra.
"""

from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from apps.accounts.models import Workspace
from apps.accounts.services.seed import popular_plano_de_contas
from apps.catalogo.models import Categoria, Estabelecimento
from apps.contratos.models import Contrato
from apps.contratos.services.projecao import gerar_parcelas
from apps.realizados.models import Realizado
from apps.relatorios.services.confronto import (
    confronto_mensal,
    efetivo,
    normalizar,
    saldo_a_realizar,
    vincular_realizados_por_descricao,
)

CORRENTE = date(2026, 6, 1)


class TestEfetivo(TestCase):
    def test_mes_fechado_manda_o_realizado(self):
        assert efetivo(Decimal("1000"), Decimal("980"), fechada=True) == Decimal("980")

    def test_mes_fechado_sem_pagamento_vale_zero(self):
        """
        Se o mês passou e nada foi pago, a despesa não aconteceu. Insistir na
        projeção inventaria movimento que nunca existiu.
        """
        assert efetivo(Decimal("1000"), Decimal("0"), fechada=True) == Decimal("0")

    def test_mes_aberto_com_pagamento_parcial_mantem_o_previsto(self):
        """
        O erro que a substituição ingênua do DAX comete.

        Parcela de R$ 1.000 com R$ 400 pagos até agora: trocar 1.000 por 400
        faria o mês parecer mais barato, sendo que faltam R$ 600 para chegar.
        """
        assert efetivo(Decimal("1000"), Decimal("400"), fechada=False) == Decimal("1000")

    def test_mes_aberto_com_gasto_acima_do_previsto(self):
        # Estourou a previsão: vale o que já saiu de fato.
        assert efetivo(Decimal("1000"), Decimal("1300"), fechada=False) == Decimal("1300")

    def test_mes_aberto_sem_pagamento_vale_a_projecao(self):
        assert efetivo(Decimal("1000"), Decimal("0"), fechada=False) == Decimal("1000")


class TestNormalizar(TestCase):
    def test_remove_acento_e_pontuacao(self):
        assert normalizar("Educação — Colégio Ômega") == "EDUCACAO COLEGIO OMEGA"

    def test_colapsa_espacos(self):
        assert normalizar("  Luz   Coelba  ") == "LUZ COELBA"


class BaseConfronto(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.ws = Workspace.objects.create(nome="Teste")
        popular_plano_de_contas(cls.ws)
        cls.estabelecimento = Estabelecimento.objects.create(
            workspace=cls.ws, nome="Coelba"
        )
        cls.categoria = Categoria.objects.get(
            workspace=cls.ws, nome="Luz", tipo="DESPESA"
        )
        cls.contrato = Contrato.objects.create(
            workspace=cls.ws,
            estabelecimento=cls.estabelecimento,
            descricao="Luz",
            tipo="DESPESA",
            categoria=cls.categoria,
            classificacao=cls.categoria.classificacao,
            valor_unitario=Decimal("320.00"),
            frequencia="M",
            data_inicio=date(2026, 1, 11),
            data_fim=date(2026, 12, 11),
        )
        # on_commit não dispara em TestCase.
        gerar_parcelas(cls.contrato)

    @classmethod
    def _realizado(cls, competencia, valor, descricao="Luz", contrato=True):
        return Realizado.objects.create(
            workspace=cls.ws,
            contrato=cls.contrato if contrato else None,
            categoria=cls.categoria,
            descricao=descricao,
            tipo="DESPESA",
            competencia=competencia,
            data_pagamento=competencia,
            valor=Decimal(valor),
        )


class TestConfrontoMensal(BaseConfronto):
    def _confronto(self, **kwargs):
        with patch(
            "apps.relatorios.services.confronto.competencia_atual", return_value=CORRENTE
        ):
            return confronto_mensal(
                self.ws, inicio=date(2026, 1, 1), fim=date(2026, 8, 1), **kwargs
            )

    def test_mes_fechado_usa_o_realizado(self):
        self._realizado(date(2026, 3, 1), "295.40")
        linha = next(
            l for l in self._confronto()["linhas"] if l["competencia"] == "2026-03-01"
        )
        assert linha["fechada"] is True
        assert linha["despesa_prevista"] == Decimal("320.00")
        assert linha["despesa_realizada"] == Decimal("295.40")
        assert linha["despesa_efetiva"] == Decimal("295.40")
        assert linha["despesa_desvio"] == Decimal("-24.60")

    def test_mes_futuro_usa_a_projecao(self):
        linha = next(
            l for l in self._confronto()["linhas"] if l["competencia"] == "2026-08-01"
        )
        assert linha["fechada"] is False
        assert linha["despesa_efetiva"] == Decimal("320.00")

    def test_mes_corrente_com_pagamento_parcial(self):
        """No mês em curso, o previsto segura o valor até o resto chegar."""
        self._realizado(CORRENTE, "100.00")
        linha = next(
            l for l in self._confronto()["linhas"] if l["competencia"] == "2026-06-01"
        )
        assert linha["fechada"] is False
        assert linha["despesa_realizada"] == Decimal("100.00")
        assert linha["despesa_efetiva"] == Decimal("320.00")

    def test_mes_fechado_sem_pagamento_nao_soma(self):
        linha = next(
            l for l in self._confronto()["linhas"] if l["competencia"] == "2026-02-01"
        )
        assert linha["despesa_prevista"] == Decimal("320.00")
        assert linha["despesa_efetiva"] == Decimal("0")

    def test_saldo_acumulado_usa_o_efetivo(self):
        self._realizado(date(2026, 1, 1), "300.00")
        linhas = self._confronto()["linhas"]
        janeiro = linhas[0]
        # Só janeiro teve pagamento; fevereiro a maio fecharam sem nada.
        assert janeiro["saldo_acumulado"] == Decimal("-300.00")
        assert linhas[4]["saldo_acumulado"] == Decimal("-300.00")
        # Junho é o mês corrente: volta a contar a projeção.
        assert linhas[5]["saldo_acumulado"] == Decimal("-620.00")

    def test_filtro_por_contrato(self):
        resultado = self._confronto(contrato=self.contrato)
        assert len(resultado["linhas"]) == 8


class TestSaldoARealizar(BaseConfronto):
    def test_conta_nao_paga_aparece_em_aberto(self):
        self._realizado(date(2026, 1, 1), "320.00")
        self._realizado(date(2026, 2, 1), "320.00")
        # Março, abril e maio fecharam sem pagamento: 3 × 320.
        with patch(
            "apps.relatorios.services.confronto.competencia_atual", return_value=CORRENTE
        ):
            resultado = saldo_a_realizar(self.ws)

        linha = resultado["linhas"][0]
        assert linha["previsto_ate_agora"] == Decimal("1600.00")
        assert linha["realizado"] == Decimal("640.00")
        assert linha["em_aberto"] == Decimal("960.00")

    def test_mes_corrente_nao_conta_como_inadimplencia(self):
        """
        Sem excluir o mês em curso, todo contrato apareceria devendo a parcela
        do próprio mês já no dia 1º.
        """
        with patch(
            "apps.relatorios.services.confronto.competencia_atual", return_value=CORRENTE
        ):
            resultado = saldo_a_realizar(self.ws)
        # Janeiro a maio: 5 parcelas, não 6.
        assert resultado["linhas"][0]["previsto_ate_agora"] == Decimal("1600.00")

    def test_saldo_futuro_e_o_que_ainda_vai_vencer(self):
        with patch(
            "apps.relatorios.services.confronto.competencia_atual", return_value=CORRENTE
        ):
            linha = saldo_a_realizar(self.ws)["linhas"][0]
        assert linha["previsto_total"] == Decimal("3840.00")
        assert linha["saldo_futuro"] == Decimal("2240.00")


class TestVincularPorDescricao(BaseConfronto):
    def test_casa_por_descricao_normalizada(self):
        self._realizado(date(2026, 3, 1), "300.00", descricao="  luz  ", contrato=False)
        resultado = vincular_realizados_por_descricao(self.ws)
        assert len(resultado["vinculados"]) == 1
        assert resultado["aplicado"] is False

    def test_simular_nao_altera_nada(self):
        orfao = self._realizado(date(2026, 3, 1), "300.00", contrato=False)
        vincular_realizados_por_descricao(self.ws)
        orfao.refresh_from_db()
        assert orfao.contrato_id is None

    def test_aplicar_vincula(self):
        orfao = self._realizado(date(2026, 3, 1), "300.00", contrato=False)
        vincular_realizados_por_descricao(self.ws, aplicar=True)
        orfao.refresh_from_db()
        assert orfao.contrato_id == self.contrato.id

    def test_competencia_fora_da_vigencia_nao_casa(self):
        """
        Mesmo nome, período errado: é homônimo, não a mesma conta. Vincular
        aqui esconderia o lançamento dentro de um total que parece certo.
        """
        self._realizado(date(2025, 3, 1), "300.00", contrato=False)
        resultado = vincular_realizados_por_descricao(self.ws)
        assert resultado["vinculados"] == []
        assert len(resultado["sem_correspondencia"]) == 1

    def test_descricao_desconhecida_fica_para_revisao(self):
        self._realizado(
            date(2026, 3, 1), "89.90", descricao="Assinatura qualquer", contrato=False
        )
        resultado = vincular_realizados_por_descricao(self.ws)
        assert len(resultado["sem_correspondencia"]) == 1
