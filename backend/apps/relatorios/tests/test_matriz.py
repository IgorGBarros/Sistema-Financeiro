"""
Visões matriciais.

Duas coisas testadas aqui não são óbvias e são fáceis de quebrar numa
refatoração: a convenção de sinal e o significado de "comprometido".
"""

from datetime import date
from decimal import Decimal

from django.test import TestCase

from apps.accounts.models import Workspace
from apps.accounts.services.seed import popular_plano_de_contas
from apps.cartoes.models import Cartao, Compra
from apps.cartoes.services.parcelamento import gerar_parcelas
from apps.catalogo.models import Categoria, Estabelecimento
from apps.contratos.models import Contrato
from apps.contratos.services.projecao import gerar_parcelas as gerar_parcelas_contrato
from apps.relatorios.services.matriz import matriz_contratos, meses_entre, painel_cartoes


class TestMesesEntre(TestCase):
    def test_intervalo_simples(self):
        meses = meses_entre(date(2026, 1, 15), date(2026, 3, 1))
        assert meses == [date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1)]

    def test_atravessa_o_ano(self):
        meses = meses_entre(date(2026, 11, 1), date(2027, 2, 1))
        assert len(meses) == 4
        assert meses[-1] == date(2027, 2, 1)

    def test_mesmo_mes(self):
        assert meses_entre(date(2026, 5, 10), date(2026, 5, 20)) == [date(2026, 5, 1)]


class BaseMatriz(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.ws = Workspace.objects.create(nome="Teste")
        popular_plano_de_contas(cls.ws)
        cls.estabelecimento = Estabelecimento.objects.create(
            workspace=cls.ws, nome="Empregador"
        )
        cls.outro = Estabelecimento.objects.create(workspace=cls.ws, nome="Escola")

    @classmethod
    def _contrato(cls, descricao, tipo, categoria_nome, valor, estabelecimento):
        categoria = Categoria.objects.get(
            workspace=cls.ws, nome=categoria_nome, tipo=tipo
        )
        contrato = Contrato.objects.create(
            workspace=cls.ws,
            estabelecimento=estabelecimento,
            descricao=descricao,
            tipo=tipo,
            categoria=categoria,
            classificacao=categoria.classificacao,
            valor_unitario=Decimal(valor),
            frequencia="M",
            data_inicio=date(2026, 1, 5),
            data_fim=date(2026, 6, 5),
        )
        # on_commit não dispara em TestCase, então o signal não roda.
        gerar_parcelas_contrato(contrato)
        return contrato


class TestMatrizContratos(BaseMatriz):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls._contrato("Salário", "RECEITA", "Salário", "5000.00", cls.estabelecimento)
        cls._contrato("Escola", "DESPESA", "Educação", "1500.00", cls.outro)

    def test_receita_positiva_despesa_negativa(self):
        """
        A convenção é o oposto da planilha original, onde receita era
        negativa. Inverter isso sem querer numa refatoração faria o total do
        mês trocar de sinal e o sistema mentir sobre sobrar ou faltar.
        """
        m = matriz_contratos(self.ws, inicio=date(2026, 1, 1), fim=date(2026, 3, 1))
        por_nome = {l["nome"]: l for l in m["linhas"]}
        janeiro = "2026-01-01"

        assert por_nome["Empregador"]["valores"][janeiro] == Decimal("5000.00")
        assert por_nome["Escola"]["valores"][janeiro] == Decimal("-1500.00")

    def test_total_do_mes_e_o_resultado(self):
        m = matriz_contratos(self.ws, inicio=date(2026, 1, 1), fim=date(2026, 3, 1))
        assert m["totais"]["2026-01-01"] == Decimal("3500.00")

    def test_acumulado_soma_os_meses_anteriores(self):
        m = matriz_contratos(self.ws, inicio=date(2026, 1, 1), fim=date(2026, 3, 1))
        assert m["acumulado"]["2026-01-01"] == Decimal("3500.00")
        assert m["acumulado"]["2026-02-01"] == Decimal("7000.00")
        assert m["acumulado"]["2026-03-01"] == Decimal("10500.00")

    def test_mes_sem_movimento_vem_zerado(self):
        """A coluna precisa existir mesmo vazia, senão a tabela desalinha."""
        m = matriz_contratos(self.ws, inicio=date(2025, 11, 1), fim=date(2026, 1, 1))
        assert m["meses"] == ["2025-11-01", "2025-12-01", "2026-01-01"]
        assert m["totais"]["2025-11-01"] == Decimal("0")

    def test_agrupamentos_alternativos(self):
        por_categoria = matriz_contratos(
            self.ws, inicio=date(2026, 1, 1), fim=date(2026, 2, 1),
            agrupar_por="categoria",
        )
        assert {l["nome"] for l in por_categoria["linhas"]} == {"Salário", "Educação"}

    def test_agrupamento_invalido(self):
        with self.assertRaises(ValueError):
            matriz_contratos(
                self.ws, inicio=date(2026, 1, 1), fim=date(2026, 2, 1),
                agrupar_por="inexistente",
            )

    def test_isolamento_entre_workspaces(self):
        outro = Workspace.objects.create(nome="Outro")
        popular_plano_de_contas(outro)
        m = matriz_contratos(outro, inicio=date(2026, 1, 1), fim=date(2026, 3, 1))
        assert m["linhas"] == []


class TestPainelCartoes(BaseMatriz):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.cartao = Cartao.objects.create(
            workspace=cls.ws, apelido="Cartão A", limite=Decimal("10000.00"),
            dia_fechamento=25, dia_vencimento=5,
        )
        categoria = Categoria.objects.get(
            workspace=cls.ws, nome="Alimentação", tipo="DESPESA"
        )
        compra = Compra.objects.create(
            workspace=cls.ws, cartao=cls.cartao, estabelecimento=cls.outro,
            categoria=categoria, descricao="Notebook",
            data_compra=date(2026, 1, 10), valor_total=Decimal("1200.00"),
            parcelas_total=12,
        )
        gerar_parcelas(compra)

    def test_parcelas_distribuidas_pelos_meses(self):
        p = painel_cartoes(self.ws, inicio=date(2026, 1, 1), fim=date(2026, 3, 1))
        linha = p["linhas"][0]
        assert linha["valores"]["2026-01-01"] == Decimal("100.00")
        assert linha["valores"]["2026-02-01"] == Decimal("100.00")

    def test_disponivel_desconta_parcelas_fora_da_janela(self):
        """
        A propriedade que a planilha não tinha: o comprometido inclui as
        parcelas além dos meses visíveis. Um parcelamento em 12x consome
        limite que a tela de 3 meses não mostra — e é justamente esse limite
        que falta na hora da próxima compra.
        """
        p = painel_cartoes(self.ws, inicio=date(2026, 1, 1), fim=date(2026, 3, 1))
        linha = p["linhas"][0]
        soma_visivel = sum(linha["valores"].values())

        assert soma_visivel == Decimal("300.00")
        assert linha["comprometido"] > soma_visivel

    def test_disponivel_e_limite_menos_comprometido(self):
        p = painel_cartoes(self.ws, inicio=date(2026, 1, 1), fim=date(2026, 6, 1))
        linha = p["linhas"][0]
        assert linha["disponivel"] == linha["limite"] - linha["comprometido"]

    def test_cartao_sem_limite_nao_calcula_disponivel(self):
        """Melhor um travessão que um número inventado."""
        Cartao.objects.create(workspace=self.ws, apelido="Sem limite", limite=None)
        p = painel_cartoes(self.ws, inicio=date(2026, 1, 1), fim=date(2026, 2, 1))
        sem_limite = next(l for l in p["linhas"] if l["apelido"] == "Sem limite")
        assert sem_limite["disponivel"] is None
        assert sem_limite["utilizacao_pct"] is None

    def test_cartao_inativo_fica_de_fora(self):
        Cartao.objects.create(workspace=self.ws, apelido="Antigo", ativo=False)
        p = painel_cartoes(self.ws, inicio=date(2026, 1, 1), fim=date(2026, 2, 1))
        assert "Antigo" not in {l["apelido"] for l in p["linhas"]}
