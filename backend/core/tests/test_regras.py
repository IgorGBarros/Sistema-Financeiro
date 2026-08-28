"""
Testes das duas regras que não podem quebrar: a projeção (equivalência com o
DAX) e a leitura do QR Code.

Rodar sem Django:  pytest core/tests/test_regras.py
"""

from datetime import date
from decimal import Decimal

import pytest

from core.services.nfce_qrcode import (
    QRCodeInvalido, calcular_dv, parse_chave, parse_qrcode, validar_chave,
)
from core.services.projecao import (
    edate, meses_calendario, numero_de_meses, projetar, quantidade_parcelas,
)

# Cupom real da Redemix Supermercados, Salvador/BA, 28/08/2026.
QR_REAL = (
    "http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p="
    "29260806337087001579650110002303451225761309|2|1|1|"
    "E7977D669E2ED9FAFAF6E2F2381A395CA35DC1E4"
)
CHAVE_REAL = "29260806337087001579650110002303451225761309"


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


# ---------------------------------------------------------------------------
# QR Code / chave de acesso
# ---------------------------------------------------------------------------

class TestChaveAcesso:
    def test_dv_do_cupom_real(self):
        assert calcular_dv(CHAVE_REAL[:43]) == CHAVE_REAL[43]
        assert validar_chave(CHAVE_REAL)

    def test_decomposicao(self):
        chave = parse_chave(CHAVE_REAL)
        assert chave.uf == "BA"
        assert chave.ano == 2026 and chave.mes == 8
        assert chave.cnpj_emitente == "06337087001579"
        assert chave.cnpj_formatado == "06.337.087/0015-79"
        assert chave.modelo == "65"          # NFC-e
        assert chave.serie == "011"
        assert chave.numero == "000230345"
        assert chave.competencia == date(2026, 8, 1)

    def test_chave_com_dv_errado(self):
        errada = CHAVE_REAL[:43] + ("0" if CHAVE_REAL[43] != "0" else "1")
        with pytest.raises(QRCodeInvalido, match="verificador"):
            parse_chave(errada)

    def test_chave_curta(self):
        with pytest.raises(QRCodeInvalido, match="44 dígitos"):
            parse_chave("123")


class TestParseQRCode:
    def test_url_completa(self):
        qr = parse_qrcode(QR_REAL)
        assert qr.chave.chave == CHAVE_REAL
        assert qr.ambiente == "producao"
        assert qr.versao_qrcode == "2"
        assert qr.contingencia is False
        assert len(qr.hash_qrcode) == 40

    def test_apenas_o_parametro_p(self):
        parametro = QR_REAL.split("p=", 1)[1]
        assert parse_qrcode(parametro).chave.chave == CHAVE_REAL

    def test_apenas_a_chave_digitada(self):
        # Usuário digitando os 44 dígitos quando a câmera não coopera.
        assert parse_qrcode(CHAVE_REAL).chave.chave == CHAVE_REAL

    def test_chave_com_espacos_como_no_cupom_impresso(self):
        formatada = " ".join(
            CHAVE_REAL[i:i + 4] for i in range(0, len(CHAVE_REAL), 4)
        )
        assert parse_qrcode(formatada).chave.chave == CHAVE_REAL

    def test_contingencia_offline(self):
        parametro = (
            f"{CHAVE_REAL}|2|1|2026-08-28T07:50:26-03:00|30.37|0.00|"
            f"ABC123|1|HASH"
        )
        qr = parse_qrcode(parametro)
        assert qr.contingencia is True
        assert qr.valor_total == "30.37"

    def test_qr_de_outro_site(self):
        with pytest.raises(QRCodeInvalido):
            parse_qrcode("https://exemplo.com/promocao")

    def test_conteudo_vazio(self):
        with pytest.raises(QRCodeInvalido, match="vazio"):
            parse_qrcode("   ")
