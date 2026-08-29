# Endpoints

Todos exigem autenticação e são filtrados pelo workspace do usuário.
Base: `/api/`

## Plano de contas

| Método | Rota | Descrição |
|---|---|---|
| `GET/POST` | `classificacoes/` | Essenciais, Bons, Ruins, Operacionais — cadastráveis |
| `GET/POST` | `categorias/` | Filtros: `tipo`, `classificacao`, `consolida_mercado` |
| `GET/POST` | `estabelecimentos/` | Busca por `nome`, `cnpj` |

## Contratos (Tabela Entrada e Saída)

| Método | Rota | Descrição |
|---|---|---|
| `GET/POST` | `contratos/` | Filtros: `tipo`, `categoria`, `classificacao`, `status`, `frequencia` |
| `GET` | `contratos/{id}/parcelas/` | Projeção materializada |
| `POST` | `contratos/simular/` | Projeta **sem gravar** — alimenta o preview do formulário |
| `POST` | `contratos/{id}/rescindir/` | Rescinde e recorta a projeção |

## Realizados

| Método | Rota | Descrição |
|---|---|---|
| `GET/POST` | `realizados/` | Filtros: `tipo`, `categoria`, `contrato`, `competencia`, `origem` |
| `POST` | `realizados/baixar-parcela/` | Marca uma parcela prevista como paga |

## Cupons fiscais (Tabela Mercado)

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `notas/scan/` | Cadastra a nota pelo conteúdo do QR Code |
| `POST` | `notas/{id}/reconsultar/` | Retenta uma nota com status `ERRO` |
| `GET` | `notas/consolidado/` | Somatório por mês |
| `GET` | `notas/mes-corrente/` | Total do mês em tempo real |

`notas/scan/` é idempotente pela chave de acesso: reenviar o mesmo cupom
devolve 200 com a nota existente, não duplica despesa. Se a SEFAZ não
responder, a nota é salva assim mesmo com status `ERRO` e os dados extraídos
da chave (emitente, série, número, competência).

## Relatórios

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `fluxo-caixa/` | Série mensal previsto × realizado. Params: `inicio`, `fim`, `saldo_inicial` |
| `GET` | `aderencia/` | Previsto × realizado contrato a contrato. Param: `competencia` |
| `GET` | `resumo-classificacao/` | Peso de cada classificação nas despesas |

## Assistente

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `assistente/perguntar/` | `{pergunta, conversa?}` → resposta + ferramentas usadas |
| `GET` | `assistente/capacidades/` | O que ele sabe consultar, com exemplos |
| `GET` | `assistente/` | Conversas anteriores |
| `GET/DELETE` | `assistente/{id}/` | Conversa com mensagens |

Sem `ANTHROPIC_API_KEY` configurada: **503** com `codigo: "nao_configurado"`.
Limite: 40 perguntas por hora por usuário.

## Formato dos erros

Toda falha sai no mesmo envelope (`apps/common/exceptions.py`):

```json
{
  "detail": "A data de fim não pode ser anterior ao início.",
  "campos": {"data_fim": ["A data de fim não pode ser anterior ao início."]},
  "codigo": "validacao"
}
```

O frontend usa `campos` para marcar o input e `detail` para o aviso no topo.

## Paginação

Listas vêm paginadas: `{count, next, previous, results}`, 50 por página,
ajustável com `?page_size=` até 200. O cliente TypeScript desembrulha isso
automaticamente em `shared/lib/api.ts`.

## Autenticação

`Authorization: Bearer <token>` — ID token do Firebase ou JWT do SimpleJWT.

`X-Workspace: <uuid>` escolhe entre os workspaces do usuário. É opcional; sem
ele, usa o primeiro. **Não concede acesso**: o filtro parte sempre de
`request.user.workspaces`.

Em desenvolvimento, sem Firebase configurado, a autenticação é dispensada e a
API assume um usuário fixo. Isso só existe com `DEBUG=1`.
