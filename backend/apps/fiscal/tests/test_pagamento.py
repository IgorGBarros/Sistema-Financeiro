"""
Pagamento da nota — o elo que faltava entre o scan e o fluxo de caixa.

Antes deste serviço, o cupom era lido e virava `NotaFiscal`, e nada mais
acontecia: o banco acumulava notas com zero realizados. O que se testa aqui é
que cada forma de pagamento gera exatamente um lançamento, no lugar certo.
"""

from datetime import datetime
from decimal import Decimal

import pytest
from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import Workspace
from apps.accounts.services.seed import popular_plano_de_contas
from apps.cartoes.models import Cartao, Compra, ParcelaCompra
from apps.catalogo.models import Categoria, Estabelecimento
from apps.fiscal.models import NotaFiscal, PagamentoNota, StatusNota
from apps.fiscal.services.pagamento import (
    forma_a_partir_do_texto,
    notas_sem_pagamento,
    registrar_pagamento,
    sugerir_pagamento,
)
from apps.realizados.models import Realizado


class TestTraducaoDaForma(TestCase):
    def test_reconhece_o_texto_do_portal(self):
        casos = {
            "Cartão de Crédito": "CREDITO",
            "Cartão de Débito": "DEBITO",
            "Dinheiro": "DINHEIRO",
            "Credito loja": "CREDITO_LOJA",
            "PIX": "PIX",
            "Vale Alimentação": "VALE_ALIMENTACAO",
        }
        for texto, esperado in casos.items():
            assert forma_a_partir_do_texto(texto) == esperado, texto

    def test_texto_desconhecido_nao_chuta(self):
        assert forma_a_partir_do_texto("Forma esquisita") == "OUTRO"
        assert forma_a_partir_do_texto("") == "OUTRO"


class BasePagamento(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.ws = Workspace.objects.create(nome="Teste")
        popular_plano_de_contas(cls.ws)
        cls.categoria = Categoria.objects.get(
            workspace=cls.ws, nome="Alimentação", tipo="DESPESA"
        )
        cls.estabelecimento = Estabelecimento.objects.create(
            workspace=cls.ws,
            nome="Redemix",
            cnpj="06337087001579",
            categoria_padrao=cls.categoria,
        )
        cls.cartao = Cartao.objects.create(
            workspace=cls.ws,
            apelido="Nubank",
            limite=Decimal("8300"),
            dia_fechamento=14,
            dia_vencimento=21,
        )

    def _nota(self, valor="450.00", forma="Cartão de Crédito", chave=None):
        return NotaFiscal.objects.create(
            workspace=self.ws,
            chave_acesso=chave or ("2" * 44),
            estabelecimento=self.estabelecimento,
            nome_emitente="REDEMIX SUPERMERCADOS",
            valor_total=Decimal(valor),
            data_emissao=timezone.make_aware(datetime(2026, 9, 10, 19, 30)),
            forma_pagamento=forma,
            status=StatusNota.IMPORTADA,
        )


class TestRegistrarPagamento(BasePagamento):
    def test_credito_gera_compra_e_parcelas(self):
        """No crédito o dinheiro sai na fatura, não na data da compra."""
        nota = self._nota()
        resultado = registrar_pagamento(
            nota=nota, forma="CREDITO", cartao=self.cartao, parcelas=3
        )

        assert resultado["realizado"] is None
        assert resultado["compra"].parcelas_total == 3
        assert resultado["compra"].parcelas.count() == 3
        assert sum(p.valor for p in resultado["compra"].parcelas.all()) == Decimal("450.00")

    def test_a_vista_gera_realizado_na_data(self):
        nota = self._nota(forma="Dinheiro")
        resultado = registrar_pagamento(nota=nota, forma="DINHEIRO")

        assert resultado["compra"] is None
        realizado = resultado["realizado"]
        assert realizado.valor == Decimal("450.00")
        assert realizado.data_pagamento.day == 10
        assert realizado.competencia.day == 1

    def test_corrigir_a_forma_nao_deixa_lancamento_orfao(self):
        """
        Trocar "crédito" por "débito" precisa desfazer as parcelas. Sem isso,
        a correção somaria as duas versões e a despesa apareceria dobrada.
        """
        nota = self._nota()
        registrar_pagamento(nota=nota, forma="CREDITO", cartao=self.cartao, parcelas=3)
        assert ParcelaCompra.objects.filter(compra__nota=nota).count() == 3

        registrar_pagamento(nota=nota, forma="DEBITO")

        assert Compra.objects.filter(nota=nota).count() == 0
        assert ParcelaCompra.objects.filter(compra__nota=nota).count() == 0
        assert PagamentoNota.objects.filter(nota=nota).count() == 1
        assert Realizado.objects.filter(observacao__contains=str(nota.id)).count() == 1

    def test_credito_sem_cartao_e_recusado(self):
        nota = self._nota()
        with pytest.raises(ValueError, match="cartão"):
            registrar_pagamento(nota=nota, forma="CREDITO")

    def test_sem_categoria_em_lugar_nenhum_e_recusado(self):
        self.estabelecimento.categoria_padrao = None
        self.estabelecimento.save()
        nota = self._nota()
        nota.categoria = None
        nota.save()

        with pytest.raises(ValueError, match="categoria"):
            registrar_pagamento(nota=nota, forma="PIX")

    def test_valor_parcial(self):
        """Pagamento dividido: parte no cartão, parte em dinheiro."""
        nota = self._nota(valor="100.00")
        resultado = registrar_pagamento(
            nota=nota, forma="DINHEIRO", valor=Decimal("40.00")
        )
        assert resultado["realizado"].valor == Decimal("40.00")


class TestSugestao(BasePagamento):
    def test_forma_vem_da_nota(self):
        sugestao = sugerir_pagamento(self._nota(forma="Cartão de Débito"))
        assert sugestao["forma"] == "DEBITO"

    def test_categoria_vem_do_estabelecimento(self):
        sugestao = sugerir_pagamento(self._nota())
        assert sugestao["categoria"] == str(self.categoria.id)
        assert sugestao["origem_da_sugestao"] == "estabelecimento"

    def test_historico_sobrepoe_o_estabelecimento(self):
        """
        Na terceira compra no mesmo lugar, o sistema já sabe o cartão e o
        parcelamento. É o que faz ele dar menos trabalho com o tempo.
        """
        nota = self._nota()
        registrar_pagamento(nota=nota, forma="CREDITO", cartao=self.cartao, parcelas=2)

        sugestao = sugerir_pagamento(self._nota(chave="3" * 44))
        assert sugestao["origem_da_sugestao"] == "historico"
        assert sugestao["cartao"] == str(self.cartao.id)
        assert sugestao["parcelas"] == 2


class TestFilaDePendencias(BasePagamento):
    def test_nota_sem_pagamento_aparece_na_fila(self):
        self._nota()
        assert notas_sem_pagamento(self.ws).count() == 1

    def test_some_da_fila_ao_registrar(self):
        nota = self._nota()
        registrar_pagamento(nota=nota, forma="PIX")
        assert notas_sem_pagamento(self.ws).count() == 0

    def test_nota_com_erro_nao_entra_na_fila(self):
        """
        Nota que a SEFAZ não respondeu não tem valor confiável. Cobrar a forma
        de pagamento dela seria pedir uma decisão sobre um dado incompleto.
        """
        NotaFiscal.objects.create(
            workspace=self.ws,
            chave_acesso="4" * 44,
            status=StatusNota.ERRO,
            valor_total=Decimal("0"),
        )
        assert notas_sem_pagamento(self.ws).count() == 0
