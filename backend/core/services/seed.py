"""
Plano de contas inicial.

As quatro classificações pedidas na regra de negócio, mais "Receitas" (uma
receita também precisa de classificação, e forçá-la a ser "Contrato Essencial"
distorceria os relatórios de despesa).

O `peso` alimenta o score de saúde financeira:
  +2 receita, 0 essencial, -1 bom, -3 ruim, -2 operacional.
Quanto mais despesa concentrada em peso negativo alto, pior a qualidade do
gasto — independente do valor total.
"""

from core.models import Categoria, Classificacao, TipoLancamento, Workspace

CLASSIFICACOES = [
    ("Receitas", 2, "#16a34a", "Tudo que entra.", 0),
    ("Contratos Essenciais", 0, "#0ea5e9",
     "Sem isso a casa para: moradia, energia, água, educação básica.", 1),
    ("Contratos Bons", -1, "#8b5cf6",
     "Gasto que gera retorno ou qualidade de vida e cabe no orçamento.", 2),
    ("Contratos Ruins", -3, "#ef4444",
     "Juros, multas, assinatura esquecida, compra por impulso. Primeiro alvo de corte.", 3),
    ("Custos Operacionais", -2, "#f59e0b",
     "Custo de manter a operação rodando: trade, taxas, manutenção.", 4),
]

# (nome, tipo, classificação, consolida_mercado)
CATEGORIAS = [
    ("Salário", TipoLancamento.RECEITA, "Receitas", False),
    ("13º Salário", TipoLancamento.RECEITA, "Receitas", False),
    ("Férias", TipoLancamento.RECEITA, "Receitas", False),
    ("Restituição Imposto de Renda", TipoLancamento.RECEITA, "Receitas", False),
    ("Auxílio", TipoLancamento.RECEITA, "Receitas", False),

    ("Moradia", TipoLancamento.DESPESA, "Contratos Essenciais", False),
    ("Condomínio", TipoLancamento.DESPESA, "Contratos Essenciais", False),
    ("Luz", TipoLancamento.DESPESA, "Contratos Essenciais", False),
    ("Água", TipoLancamento.DESPESA, "Contratos Essenciais", False),
    ("Gás", TipoLancamento.DESPESA, "Contratos Essenciais", False),
    ("Educação", TipoLancamento.DESPESA, "Contratos Essenciais", False),
    ("Financiamento", TipoLancamento.DESPESA, "Contratos Essenciais", False),
    ("IPTU", TipoLancamento.DESPESA, "Contratos Essenciais", False),
    ("Alimentação", TipoLancamento.DESPESA, "Contratos Essenciais", True),

    ("Internet", TipoLancamento.DESPESA, "Contratos Bons", False),
    ("Saúde", TipoLancamento.DESPESA, "Contratos Bons", False),
    ("Lazer", TipoLancamento.DESPESA, "Contratos Bons", False),

    ("Juros", TipoLancamento.DESPESA, "Contratos Ruins", False),
    ("Multas", TipoLancamento.DESPESA, "Contratos Ruins", False),
    ("Assinaturas", TipoLancamento.DESPESA, "Contratos Ruins", False),

    ("Custo Operacional", TipoLancamento.DESPESA, "Custos Operacionais", False),
    ("Tarifas Bancárias", TipoLancamento.DESPESA, "Custos Operacionais", False),
]


def criar_workspace_padrao(usuario, nome: str = "Minhas finanças") -> Workspace:
    workspace = Workspace.objects.create(nome=nome)
    workspace.membros.add(usuario)
    popular_plano_de_contas(workspace)
    return workspace


def popular_plano_de_contas(workspace: Workspace) -> None:
    mapa = {}
    for nome, peso, cor, descricao, ordem in CLASSIFICACOES:
        mapa[nome], _ = Classificacao.objects.get_or_create(
            workspace=workspace,
            nome=nome,
            defaults={"peso": peso, "cor": cor, "descricao": descricao, "ordem": ordem},
        )

    for nome, tipo, classificacao, consolida in CATEGORIAS:
        Categoria.objects.get_or_create(
            workspace=workspace,
            nome=nome,
            tipo=tipo,
            defaults={
                "classificacao": mapa[classificacao],
                "consolida_mercado": consolida,
            },
        )
