"""
Loop de conversa do assistente.

Fluxo de uma pergunta:

    pergunta → Claude → (quer uma ferramenta?) → executamos localmente
             → devolvemos o resultado → Claude → resposta em texto

O laço repete até o modelo parar de pedir ferramentas, com teto rígido de
MAX_RODADAS. Sem esse teto, um modelo confuso pode ficar chamando ferramenta
indefinidamente e queimar créditos.

Chamada HTTP direta, sem SDK, pelo mesmo motivo do Asaas: uma dependência a
menos para versionar e auditar.
"""

from __future__ import annotations

import json
import logging

import requests
from django.conf import settings

from apps.assistente.services import ferramentas
from apps.assistente.services.ferramentas import ErroFerramenta

logger = logging.getLogger(__name__)

URL_API = "https://api.anthropic.com/v1/messages"
VERSAO_API = "2023-06-01"
MODELO_PADRAO = "claude-sonnet-4-6"
MAX_RODADAS = 6
TIMEOUT = 60

INSTRUCOES = """Você é o assistente financeiro de um sistema de controle de \
receitas e despesas pessoais, no Brasil.

Como trabalhar:
- Responda SEMPRE a partir das ferramentas. Você não tem acesso aos dados de \
outra forma e não deve estimar, arredondar de memória nem inventar números.
- Se as ferramentas não cobrirem a pergunta, diga com franqueza que ainda não \
consegue responder aquilo, e sugira o que consegue.
- Valores em reais, formato brasileiro: R$ 1.234,56.
- Seja direto. Duas ou três frases resolvem a maioria das perguntas. Tabela \
apenas quando a comparação for realmente o ponto.

Sobre o domínio:
- "Competência" é o mês de referência, sempre no dia 1.
- Meses futuros são projeção dos contratos; meses passados usam o que foi pago.
- As classificações são: Contratos Essenciais, Contratos Bons, Contratos Ruins \
e Custos Operacionais. "Ruins" costuma ser o primeiro lugar a cortar.

Cuidado com conselho financeiro:
- Você pode mostrar números, comparar cenários e apontar onde o dinheiro está \
indo. Isso é análise dos dados da própria pessoa.
- Não recomende investimentos, produtos financeiros nem empréstimos \
específicos, e não se apresente como consultor financeiro habilitado.
"""


class ErroAssistente(RuntimeError):
    pass


class AssistenteIndisponivel(ErroAssistente):
    """Falta configuração — a chave da API não está definida."""


def _chave() -> str:
    chave = getattr(settings, "ANTHROPIC_API_KEY", "")
    if not chave:
        raise AssistenteIndisponivel(
            "O assistente precisa de uma chave da API. Defina ANTHROPIC_API_KEY "
            "no .env do backend."
        )
    return chave


def _chamar_modelo(mensagens: list[dict], *, modelo: str, sessao: requests.Session) -> dict:
    resposta = sessao.post(
        URL_API,
        headers={
            "x-api-key": _chave(),
            "anthropic-version": VERSAO_API,
            "content-type": "application/json",
        },
        json={
            "model": modelo,
            "max_tokens": 2000,
            "system": INSTRUCOES,
            "tools": ferramentas.schemas(),
            "messages": mensagens,
        },
        timeout=TIMEOUT,
    )

    if resposta.status_code == 401:
        raise AssistenteIndisponivel("A chave da API foi recusada. Confira ANTHROPIC_API_KEY.")
    if resposta.status_code == 429:
        raise ErroAssistente("Limite de uso atingido. Tente de novo em alguns minutos.")
    if resposta.status_code >= 500:
        raise ErroAssistente("O serviço de IA está instável agora. Tente de novo em instantes.")
    if resposta.status_code != 200:
        detalhe = resposta.json().get("error", {}).get("message", resposta.text[:200])
        raise ErroAssistente(f"A IA recusou a requisição: {detalhe}")

    return resposta.json()


def _texto(conteudo: list[dict]) -> str:
    return "\n".join(b.get("text", "") for b in conteudo if b.get("type") == "text").strip()


def responder(
    *,
    workspace,
    pergunta: str,
    historico: list[dict] | None = None,
    modelo: str | None = None,
) -> dict:
    """
    Responde uma pergunta sobre os dados financeiros do workspace.

    Devolve a resposta em texto, quais ferramentas foram usadas (para a
    interface mostrar a procedência do número) e o histórico atualizado.
    """
    modelo = modelo or getattr(settings, "ANTHROPIC_MODEL", MODELO_PADRAO)
    mensagens = list(historico or []) + [{"role": "user", "content": pergunta}]
    usadas: list[dict] = []

    with requests.Session() as sessao:
        for rodada in range(MAX_RODADAS):
            corpo = _chamar_modelo(mensagens, modelo=modelo, sessao=sessao)
            conteudo = corpo.get("content", [])
            mensagens.append({"role": "assistant", "content": conteudo})

            pedidos = [b for b in conteudo if b.get("type") == "tool_use"]
            if not pedidos:
                return {
                    "resposta": _texto(conteudo)
                    or "Não consegui formular uma resposta para isso.",
                    "ferramentas_usadas": usadas,
                    "historico": mensagens,
                    "rodadas": rodada + 1,
                }

            resultados = []
            for pedido in pedidos:
                nome, argumentos = pedido.get("name"), pedido.get("input", {})
                try:
                    dados = ferramentas.executar(nome, workspace, argumentos)
                    erro = False
                except ErroFerramenta as exc:
                    # Erro esperado volta como texto para o modelo se corrigir
                    # sozinho — geralmente ele reformula e acerta na rodada
                    # seguinte.
                    dados, erro = {"erro": str(exc)}, True
                except Exception:  # noqa: BLE001
                    logger.exception("Falha na ferramenta %s", nome)
                    dados, erro = {"erro": "Falha ao consultar os dados."}, True

                usadas.append({"nome": nome, "argumentos": argumentos, "erro": erro})
                resultados.append({
                    "type": "tool_result",
                    "tool_use_id": pedido.get("id"),
                    "content": json.dumps(dados, ensure_ascii=False, default=str),
                    "is_error": erro,
                })

            mensagens.append({"role": "user", "content": resultados})

    raise ErroAssistente(
        "A consulta ficou complexa demais e foi interrompida. "
        "Tente dividir a pergunta em partes."
    )
