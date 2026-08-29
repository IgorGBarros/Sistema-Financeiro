"""Testes da leitura do QR Code da NFC-e."""

from datetime import date

import pytest

from apps.fiscal.services.nfce_qrcode import (
    QRCodeInvalido, calcular_dv, parse_chave, parse_qrcode, validar_chave,
)

# Cupom real da Redemix Supermercados, Salvador/BA, 28/08/2026.
QR_REAL = (
    "http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p="
    "29260806337087001579650110002303451225761309|2|1|1|"
    "E7977D669E2ED9FAFAF6E2F2381A395CA35DC1E4"
)
CHAVE_REAL = "29260806337087001579650110002303451225761309"

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
