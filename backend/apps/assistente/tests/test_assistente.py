"""
Testes do assistente.

A propriedade mais importante testada aqui é o isolamento: nenhuma ferramenta
pode devolver dado de um workspace que não seja o injetado pelo servidor.
Se um destes testes falhar, é vazamento de dado financeiro entre famílias —
não um bug cosmético.

Rodar: pytest apps/assistente/tests/ (precisa de pytest-django ou use
       python manage.py test apps.assistente)
"""

from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.accounts.models import Workspace
from apps.accounts.services.seed import popular_plano_de_contas
from apps.assistente.services import ferramentas
from apps.assistente.services.ferramentas import ErroFerramenta
from apps.catalogo.models import Categoria, Estabelecimento
from apps.contratos.models import Contrato
from apps.contratos.services.projecao import gerar_parcelas

User = get_user_model()


class BaseAssistente(TestCase):
    """Dois workspaces com dados distintos — a base de todo teste de isolamento."""

    @classmethod
    def setUpTestData(cls):
        cls.ws_a = Workspace.objects.create(nome="Família A")
        cls.ws_b = Workspace.objects.create(nome="Família B")
        for ws in (cls.ws_a, cls.ws_b):
            popular_plano_de_contas(ws)

        cls.contrato_a = cls._contrato(cls.ws_a, "Aluguel do A", Decimal("2000"))
        cls.contrato_b = cls._contrato(cls.ws_b, "Aluguel do B", Decimal("9999"))

    @classmethod
    def _contrato(cls, workspace, descricao, valor):
        categoria = Categoria.objects.get(workspace=workspace, nome="Moradia")
        estabelecimento = Estabelecimento.objects.create(
            workspace=workspace, nome=f"Imobiliária {workspace.nome}"
        )
        contrato = Contrato.objects.create(
            workspace=workspace,
            estabelecimento=estabelecimento,
            descricao=descricao,
            tipo="DESPESA",
            categoria=categoria,
            classificacao=categoria.classificacao,
            valor_unitario=valor,
            frequencia="M",
            data_inicio=date(2026, 1, 10),
            data_fim=date(2026, 12, 10),
        )
        # O signal usa transaction.on_commit, que NUNCA dispara dentro de
        # TestCase — todo o teste roda numa transação que sofre rollback. Sem
        # esta chamada explícita o contrato ficaria sem projeção e os testes
        # passariam a validar o vazio.
        gerar_parcelas(contrato)
        return contrato


class TestIsolamento(BaseAssistente):
    def test_listar_contratos_nao_vaza_outro_workspace(self):
        resultado = ferramentas.executar("listar_contratos", self.ws_a, {})
        descricoes = [c["descricao"] for c in resultado["contratos"]]
        assert "Aluguel do A" in descricoes
        assert "Aluguel do B" not in descricoes

    def test_workspace_nos_argumentos_e_ignorado(self):
        """
        Defesa contra prompt injection: mesmo que o modelo seja convencido a
        mandar um workspace nos argumentos, ele é descartado. O workspace real
        é posicional e vem do servidor.
        """
        resultado = ferramentas.executar(
            "listar_contratos", self.ws_a, {"workspace": str(self.ws_b.id)}
        )
        descricoes = [c["descricao"] for c in resultado["contratos"]]
        assert descricoes == ["Aluguel do A"]

    def test_simular_cancelamento_nao_alcanca_outro_workspace(self):
        with pytest.raises(ErroFerramenta, match="Nenhum contrato"):
            ferramentas.executar(
                "simular_cancelamento", self.ws_a, {"descricao": "Aluguel do B"}
            )

    def test_todas_as_ferramentas_aceitam_workspace_posicional(self):
        """
        Garante que uma ferramenta nova não seja adicionada sem o parâmetro de
        isolamento — o erro seria descoberto só em produção, com dado vazado.
        """
        import inspect

        for nome, ferramenta in ferramentas.REGISTRO.items():
            parametros = list(inspect.signature(ferramenta.executar).parameters)
            assert parametros[0] == "workspace", (
                f"A ferramenta '{nome}' precisa receber workspace como primeiro "
                "parâmetro posicional."
            )
            assert "workspace" not in ferramenta.parametros, (
                f"A ferramenta '{nome}' não pode expor 'workspace' no schema — "
                "isso deixaria o modelo escolher o workspace."
            )


class TestFerramentas(BaseAssistente):
    def test_ferramenta_inexistente(self):
        with pytest.raises(ErroFerramenta, match="não existe"):
            ferramentas.executar("apagar_tudo", self.ws_a, {})

    def test_argumento_desconhecido_e_descartado(self):
        resultado = ferramentas.executar(
            "listar_contratos", self.ws_a, {"tipo": "DESPESA", "sql": "DROP TABLE"}
        )
        assert resultado["total_encontrado"] == 1

    def test_competencia_invalida_da_erro_legivel(self):
        with pytest.raises(ErroFerramenta, match="AAAA-MM"):
            ferramentas.executar(
                "comparar_previsto_realizado", self.ws_a, {"competencia": "ontem"}
            )

    def test_fluxo_caixa_usa_o_mesmo_calculo_das_telas(self):
        """
        O assistente e o gráfico precisam concordar. Se divergirem, um dos dois
        está mentindo para a pessoa.
        """
        from apps.relatorios.services import fluxo_caixa

        via_ferramenta = ferramentas.executar(
            "consultar_fluxo_caixa", self.ws_a, {"inicio": "2026-01", "fim": "2026-03"}
        )
        via_servico = fluxo_caixa.fluxo_mensal(
            self.ws_a, inicio=date(2026, 1, 1), fim=date(2026, 3, 1)
        )
        assert len(via_ferramenta["meses"]) == len(via_servico)
        assert via_ferramenta["meses"][0]["despesa"] == float(
            via_servico[0]["despesa_prevista"]
        )

    def test_simular_cancelamento_nao_altera_nada(self):
        antes = self.contrato_a.parcelas.count()
        resultado = ferramentas.executar(
            "simular_cancelamento", self.ws_a, {"descricao": "Aluguel", "a_partir_de": "2026-07"}
        )
        assert resultado["parcelas_restantes"] == 6
        assert resultado["economia_total"] == 12000.0
        assert self.contrato_a.parcelas.count() == antes
        assert Contrato.objects.filter(id=self.contrato_a.id).exists()

    def test_schemas_sao_validos_para_a_api(self):
        for schema in ferramentas.schemas():
            assert schema["name"] and schema["description"]
            assert schema["input_schema"]["type"] == "object"
            for nome, prop in schema["input_schema"]["properties"].items():
                assert "type" in prop, f"{schema['name']}.{nome} sem 'type'"


class TestLoopConversa(BaseAssistente):
    """
    Exercita o laço de tool use sem chamar a API de verdade, substituindo o
    transporte HTTP. Testar contra a API real deixaria a suíte lenta, cara e
    dependente de rede.
    """

    def _resposta_falsa(self, blocos, parada="end_turn"):
        return {"content": blocos, "stop_reason": parada}

    def test_executa_ferramenta_e_devolve_texto(self, monkeypatch=None):
        from unittest.mock import patch

        from apps.assistente.services import cliente

        chamadas = []

        def fake(mensagens, *, modelo, sessao):
            # Cópia: a lista original continua sendo mutada pelo laço, então
            # guardar a referência faria todas as entradas apontarem para o
            # mesmo objeto e o teste inspecionaria o estado final, não o envio.
            chamadas.append(list(mensagens))
            if len(chamadas) == 1:
                return self._resposta_falsa([
                    {"type": "tool_use", "id": "t1", "name": "listar_contratos",
                     "input": {"tipo": "DESPESA"}}
                ])
            return self._resposta_falsa([
                {"type": "text", "text": "Você tem um contrato de despesa."}
            ])

        with patch.object(cliente, "_chamar_modelo", side_effect=fake):
            resultado = cliente.responder(
                workspace=self.ws_a, pergunta="Quais são minhas despesas?"
            )

        assert resultado["resposta"] == "Você tem um contrato de despesa."
        assert resultado["ferramentas_usadas"][0]["nome"] == "listar_contratos"
        assert resultado["ferramentas_usadas"][0]["erro"] is False
        assert resultado["rodadas"] == 2

    def test_erro_de_ferramenta_volta_para_o_modelo_corrigir(self):
        from unittest.mock import patch

        from apps.assistente.services import cliente

        chamadas = []

        def fake(mensagens, *, modelo, sessao):
            chamadas.append(list(mensagens))
            if len(chamadas) == 1:
                return self._resposta_falsa([
                    {"type": "tool_use", "id": "t1", "name": "simular_cancelamento",
                     "input": {"descricao": "contrato que não existe"}}
                ])
            return self._resposta_falsa([
                {"type": "text", "text": "Não encontrei esse contrato."}
            ])

        with patch.object(cliente, "_chamar_modelo", side_effect=fake):
            resultado = cliente.responder(workspace=self.ws_a, pergunta="Cancelar X?")

        assert resultado["ferramentas_usadas"][0]["erro"] is True
        # O erro virou tool_result, não exceção: o modelo teve chance de se
        # corrigir na rodada seguinte.
        tool_result = chamadas[1][-1]
        assert tool_result["role"] == "user"
        assert tool_result["content"][0]["is_error"] is True
        assert "Nenhum contrato" in tool_result["content"][0]["content"]

    def test_teto_de_rodadas_evita_laco_infinito(self):
        from unittest.mock import patch

        from apps.assistente.services import cliente

        def sempre_pede_ferramenta(mensagens, *, modelo, sessao):
            return self._resposta_falsa([
                {"type": "tool_use", "id": "t", "name": "listar_contratos", "input": {}}
            ])

        with patch.object(cliente, "_chamar_modelo", side_effect=sempre_pede_ferramenta):
            with pytest.raises(cliente.ErroAssistente, match="complexa demais"):
                cliente.responder(workspace=self.ws_a, pergunta="Loop")

    def test_sem_chave_configurada_da_erro_acionavel(self):
        from django.test import override_settings

        from apps.assistente.services import cliente

        with override_settings(ANTHROPIC_API_KEY=""):
            with pytest.raises(cliente.AssistenteIndisponivel, match="ANTHROPIC_API_KEY"):
                cliente.responder(workspace=self.ws_a, pergunta="Oi")
