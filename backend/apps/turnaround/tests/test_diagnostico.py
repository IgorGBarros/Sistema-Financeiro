"""Testa o serviço de diagnóstico sem banco."""

from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.turnaround.services.diagnostico import (
    _comprometimento_pct,
    _score_saude,
    diagnosticar,
)


class ComprometimentoTestCase(SimpleTestCase):
    def test_calcula_percentual(self):
        resultado = _comprometimento_pct(Decimal("10000"), Decimal("4000"))
        self.assertEqual(resultado, Decimal("40.0"))

    def test_renda_zero_retorna_100(self):
        resultado = _comprometimento_pct(Decimal("0"), Decimal("1000"))
        self.assertEqual(resultado, Decimal("100"))


class ScoreSaudeTestCase(SimpleTestCase):
    def test_comprometimento_baixo_tem_score_alto(self):
        self.assertGreaterEqual(_score_saude(Decimal("25"), False), 80)

    def test_comprometimento_alto_tem_score_baixo(self):
        self.assertLessEqual(_score_saude(Decimal("95"), False), 20)

    def test_plano_ativo_adiciona_bonus(self):
        sem = _score_saude(Decimal("40"), False)
        com = _score_saude(Decimal("40"), True)
        self.assertGreater(com, sem)


class DiagnosticarTestCase(SimpleTestCase):
    """Diagnosticar retorna estrutura esperada mesmo sem banco."""

    def _workspace_mock(self):
        return MagicMock()

    @patch("apps.turnaround.services.diagnostico._somar_parcelas", return_value=Decimal("0"))
    @patch("apps.turnaround.services.diagnostico._divida_total", return_value=Decimal("0"))
    @patch("apps.turnaround.models.PlanoTurnaround.objects")
    def test_retorna_chaves_esperadas(self, mock_plano, mock_divida, mock_parcelas):
        mock_plano.filter.return_value.exists.return_value = False
        resultado = diagnosticar(self._workspace_mock())
        chaves = {
            "renda_mensal_media",
            "despesa_mensal_media",
            "comprometimento_pct",
            "divida_total",
            "score_saude",
            "semaforo",
            "tem_plano_ativo",
            "projecao_3_meses",
            "regras",
        }
        self.assertTrue(chaves.issubset(resultado.keys()))

    @patch("apps.turnaround.services.diagnostico._somar_parcelas", return_value=Decimal("0"))
    @patch("apps.turnaround.services.diagnostico._divida_total", return_value=Decimal("0"))
    @patch("apps.turnaround.models.PlanoTurnaround.objects")
    def test_projecao_tem_3_meses(self, mock_plano, mock_divida, mock_parcelas):
        mock_plano.filter.return_value.exists.return_value = False
        resultado = diagnosticar(self._workspace_mock())
        self.assertEqual(len(resultado["projecao_3_meses"]), 3)
