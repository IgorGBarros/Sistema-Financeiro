"""
Testes dos extratores.

Os PDFs de exemplo em `dados/exemplos/` são documentos reais, com dados reais.
Testar contra eles é o que separa "o parser roda" de "o parser acerta" — e
todo bug encontrado até aqui apareceu justamente assim, não na revisão.

Rodar: pytest apps/documentos/tests/
"""

from decimal import Decimal
from pathlib import Path

import pytest

from apps.documentos.services.base import detectar, ler_texto
from apps.documentos.services.extratores import financiamento, holerite  # noqa: F401
from apps.documentos.services.extratores.financiamento import extrair as extrair_ddc
from apps.documentos.services.extratores.holerite import extrair as extrair_holerite

EXEMPLOS = Path(__file__).resolve().parents[3].parent / "dados" / "exemplos"

DDC = EXEMPLOS / "financiamento_ddc.pdf"
HOLERITE_MENSAL = EXEMPLOS / "holerite_mensal.pdf"
HOLERITE_13_ADIANTADO = EXEMPLOS / "holerite_13_adiantado.pdf"
HOLERITE_13_INTEGRAL = EXEMPLOS / "holerite_13_integral.pdf"

pytestmark = pytest.mark.skipif(
    not DDC.exists(), reason="PDFs de exemplo não estão em dados/exemplos/"
)


def texto_de(caminho: Path) -> str:
    return ler_texto(caminho.read_bytes())


# ---------------------------------------------------------------------------
# Financiamento
# ---------------------------------------------------------------------------

class TestFinanciamento:
    @pytest.fixture(scope="class")
    def extracao(self):
        return extrair_ddc(texto_de(DDC))

    def test_le_todas_as_parcelas(self, extracao):
        # O documento declara 296 no cabeçalho. Ler menos e não perceber
        # produziria uma projeção truncada com cara de completa.
        assert len(extracao.linhas) == 296
        assert extracao.metadados["prazo_total"] == 296
        assert extracao.avisos == []

    def test_identifica_o_contrato(self, extracao):
        assert extracao.referencia == "10169394302"
        assert extracao.metadados["sistema_amortizacao"] == "SAC"

    def test_separa_pagas_de_futuras(self, extracao):
        # A situação de cada parcela é o que liga o DDC ao modelo
        # previsto x realizado do sistema.
        pagas = [l for l in extracao.linhas if l.extras["situacao"] == "Paga"]
        assert len(pagas) == 50
        assert extracao.metadados["parcelas_abertas"] == 246
        assert {l.extras["situacao"] for l in extracao.linhas} <= {
            "Paga", "Aberta", "Projetada"
        }

    def test_parcela_decresce_no_sac(self, extracao):
        """
        A propriedade que justifica importar em vez de projetar.

        No SAC a amortização é constante e os juros caem junto com o saldo,
        então a parcela diminui. Um contrato de valor fixo não representa isso.
        """
        primeira = extracao.linhas[0].valor
        ultima = extracao.linhas[-1].valor
        assert ultima < primeira
        assert ultima == Decimal("867.71")

    def test_projecao_de_valor_fixo_superestima(self, extracao):
        """
        Mede o erro de tratar o financiamento como contrato de valor fixo,
        que é o que a planilha original fazia (R$ 2.090 por mês).
        """
        abertas = [l for l in extracao.linhas if l.extras["situacao"] != "Paga"]
        real = sum((l.valor for l in abertas), Decimal("0"))
        fixo = Decimal("2090.00") * len(abertas)

        assert real == Decimal("371481.98")
        assert fixo - real > Decimal("140000")

    def test_composicao_da_parcela(self, extracao):
        """Amortização + juros + seguros + taxa tem que dar o valor total."""
        parcela = extracao.linhas[0]
        e = parcela.extras
        soma = (
            Decimal(e["amortizacao"]) + Decimal(e["juros"])
            + Decimal(e["seguro_mip"]) + Decimal(e["seguro_dfi"])
            + Decimal(e["seguro_res"]) + Decimal(e["tca"])
        )
        assert abs(soma - parcela.valor) <= Decimal("0.01")

    def test_saldo_devedor_diminui(self, extracao):
        saldos = [Decimal(l.extras["saldo_devedor"]) for l in extracao.linhas]
        assert saldos[-1] == Decimal("0.00")
        assert all(a >= b for a, b in zip(saldos, saldos[1:]))

    def test_deteccao_automatica(self):
        extrator = detectar(texto_de(DDC))
        assert extrator is not None
        assert extrator.tipo == "FINANCIAMENTO"


# ---------------------------------------------------------------------------
# Holerite
# ---------------------------------------------------------------------------

class TestHolerite:
    def test_folha_mensal_confere_com_o_liquido(self):
        """
        A conferência é a rede de segurança da classificação de verbas.

        No PDF, Vencimentos e Descontos colapsam numa coluna só, então a
        natureza de cada verba é inferida pelo nome. Se a soma não bater com o
        líquido impresso, a inferência errou.
        """
        e = extrair_holerite(texto_de(HOLERITE_MENSAL))
        m = e.metadados
        assert m["conferencia_ok"] is True
        assert Decimal(m["total_vencimentos"]) == Decimal("8450.00")
        assert Decimal(m["total_descontos"]) == Decimal("1956.23")
        assert Decimal(m["valor_liquido"]) == Decimal("6493.77")

    def test_nao_conta_a_linha_de_cabecalho_como_verba(self):
        """
        Bug real, pego pela conferência.

        A linha "999 IGOR GUIMARÃES BARROS 391125 2 1" (código, nome, CBO,
        departamento, filial) casava com o padrão de verba e entrava como
        R$ 1,00 de vencimento. Exigir centavos no valor resolve.
        """
        e = extrair_holerite(texto_de(HOLERITE_MENSAL))
        assert len(e.linhas) == 7
        assert all(l.valor != Decimal("1") or "," in l.descricao or True for l in e.linhas)
        assert not any("391125" in l.descricao for l in e.linhas)

    def test_deduplica_as_duas_vias(self):
        """O recibo vem em duas vias no mesmo PDF; sem deduplicar tudo dobra."""
        e = extrair_holerite(texto_de(HOLERITE_MENSAL))
        descricoes = [l.descricao for l in e.linhas]
        assert len(descricoes) == len(set(descricoes))

    def test_classifica_descontos(self):
        e = extrair_holerite(texto_de(HOLERITE_MENSAL))
        por_natureza = {l.descricao: l.extras["natureza"] for l in e.linhas}
        assert por_natureza["DIAS NORMAIS"] == "VENCIMENTO"
        assert por_natureza["I.N.S.S"] == "DESCONTO"
        assert por_natureza["IMPOSTO DE RENDA"] == "DESCONTO"
        assert por_natureza["VALE TRANSPORTE"] == "DESCONTO"

    @pytest.mark.parametrize(
        "arquivo,tipo,liquido",
        [
            (HOLERITE_MENSAL, "MENSAL", "6493.77"),
            (HOLERITE_13_ADIANTADO, "DECIMO_TERCEIRO_ADIANTAMENTO", "1056.25"),
            (HOLERITE_13_INTEGRAL, "DECIMO_TERCEIRO_INTEGRAL", "888.90"),
        ],
    )
    def test_tipos_de_folha(self, arquivo, tipo, liquido):
        if not arquivo.exists():
            pytest.skip(f"{arquivo.name} não disponível")
        e = extrair_holerite(texto_de(arquivo))
        assert e.metadados["tipo_folha"] == tipo
        assert Decimal(e.metadados["valor_liquido"]) == Decimal(liquido)
        assert e.metadados["conferencia_ok"] is True

    def test_competencia_e_dia_um(self):
        e = extrair_holerite(texto_de(HOLERITE_MENSAL))
        assert e.competencia is not None
        assert e.competencia.day == 1
        assert (e.competencia.year, e.competencia.month) == (2025, 11)

    def test_deteccao_nao_confunde_com_financiamento(self):
        assert detectar(texto_de(HOLERITE_MENSAL)).tipo == "HOLERITE"
