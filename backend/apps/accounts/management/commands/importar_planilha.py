"""
Importa a planilha "Entrada e Saída - Receita e Despesas.xlsx" para a Tabela
Entrada e Saída (contratos previstos).

    python manage.py importar_planilha --arquivo planilha.xlsx --workspace <uuid>

Duas normalizações acontecem aqui, e é importante saber delas:

1. SINAL. Na planilha, receita é número negativo (-5543 de salário) e despesa
   é positivo. No banco o valor é sempre positivo e o sinal vem do campo
   `tipo`. O sinal da planilha é usado só como conferência: se a coluna
   Categoria diz "Receita" e o valor é positivo, o comando avisa.

2. COLUNA "Tipo de Contrato" (M/A). Na prática ela é a FREQUÊNCIA, não o tipo.
   Vira `frequencia`. O que a planilha chama de "Categoria" (Receita/Despesa)
   vira `tipo`, e o que ela chama de "Classificação" vira `categoria`.
   A classificação de verdade (Essencial/Bom/Ruim/Operacional) é inferida
   pelo mapa abaixo e pode ser corrigida na tela depois.
"""

from datetime import datetime
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import Workspace
from apps.catalogo.models import Categoria, Classificacao, Estabelecimento
from apps.common.models import OrigemLancamento, TipoLancamento
from apps.contratos.models import Contrato, Frequencia, StatusContrato, TipoConta, TipoRegistro

MAPA_CLASSIFICACAO = {
    "salário": "Receitas", "13º salário": "Receitas", "férias": "Receitas",
    "restituição imposto de renda": "Receitas", "ajuda de meu pai": "Receitas",
    "educação": "Contratos Essenciais", "luz": "Contratos Essenciais",
    "iptu": "Contratos Essenciais", "condominio": "Contratos Essenciais",
    "condomínio": "Contratos Essenciais", "gás": "Contratos Essenciais",
    "financiamento": "Contratos Essenciais", "alimentação": "Contratos Essenciais",
    "internet": "Contratos Bons",
    "juros": "Contratos Ruins",
    "custo operacional": "Custos Operacionais",
}

MAPA_FREQUENCIA = {"M": Frequencia.MENSAL, "A": Frequencia.ANUAL, "U": Frequencia.UNICA}


class Command(BaseCommand):
    help = "Importa a planilha de entrada e saída para os contratos previstos."

    def add_arguments(self, parser):
        parser.add_argument("--arquivo", required=True)
        parser.add_argument("--workspace", required=True)
        parser.add_argument("--aba", default="Contrato_Previsto")
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Mostra o que seria importado sem gravar.",
        )

    def handle(self, *args, **opcoes):
        try:
            import openpyxl
        except ImportError as exc:
            raise CommandError("Instale openpyxl: pip install openpyxl") from exc

        workspace = Workspace.objects.filter(id=opcoes["workspace"]).first()
        if workspace is None:
            raise CommandError("Workspace não encontrado.")

        planilha = openpyxl.load_workbook(opcoes["arquivo"], data_only=True)
        aba = planilha[opcoes["aba"]]
        linhas = list(aba.iter_rows(values_only=True))
        cabecalho = [str(c).strip() if c else "" for c in linhas[0]]
        indice = {nome: i for i, nome in enumerate(cabecalho)}

        def celula(linha, nome, padrao=None):
            for chave in indice:
                if chave.strip().lower() == nome.strip().lower():
                    valor = linha[indice[chave]]
                    return padrao if valor is None else valor
            return padrao

        criados = alertas = 0
        with transaction.atomic():
            for linha in linhas[1:]:
                if not any(linha):
                    continue

                tipo_planilha = str(celula(linha, "Categoria", "Despesa")).strip()
                tipo = (
                    TipoLancamento.RECEITA
                    if tipo_planilha.lower().startswith("receita")
                    else TipoLancamento.DESPESA
                )

                valor_bruto = Decimal(str(celula(linha, "Preço Unitáro", 0) or 0))
                if tipo == TipoLancamento.RECEITA and valor_bruto > 0:
                    alertas += 1
                    self.stdout.write(self.style.WARNING(
                        f"  Receita com valor positivo na planilha: "
                        f"{celula(linha, 'Descrição')} ({valor_bruto})"
                    ))
                valor = abs(valor_bruto)

                nome_categoria = str(
                    celula(linha, "Classificação") or celula(linha, "Descrição") or "Outros"
                ).strip()
                nome_classificacao = MAPA_CLASSIFICACAO.get(
                    nome_categoria.lower(),
                    "Receitas" if tipo == TipoLancamento.RECEITA else "Contratos Bons",
                )

                classificacao, _ = Classificacao.objects.get_or_create(
                    workspace=workspace, nome=nome_classificacao,
                    defaults={"cor": "#64748b"},
                )
                categoria, _ = Categoria.objects.get_or_create(
                    workspace=workspace, nome=nome_categoria, tipo=tipo,
                    defaults={"classificacao": classificacao},
                )
                estabelecimento, _ = Estabelecimento.objects.get_or_create(
                    workspace=workspace,
                    nome=str(celula(linha, "Nome do Estabelecimeno", "Sem nome")).strip(),
                    defaults={"codigo": celula(linha, "Cód. Estabelecimento")},
                )

                def data(nome):
                    valor = celula(linha, nome)
                    if isinstance(valor, datetime):
                        return valor.date()
                    return valor

                if opcoes["dry_run"]:
                    self.stdout.write(
                        f"  {tipo:8} {nome_categoria:28} R$ {valor:>10} "
                        f"{data('data de inicio')} → {data('data fim ')}"
                    )
                    criados += 1
                    continue

                Contrato.objects.update_or_create(
                    workspace=workspace,
                    numero=celula(linha, "Número do Contrato"),
                    defaults={
                        "estabelecimento": estabelecimento,
                        "descricao": str(celula(linha, "Descrição", nome_categoria)),
                        "tipo": tipo,
                        "categoria": categoria,
                        "classificacao": classificacao,
                        "valor_unitario": valor,
                        "frequencia": MAPA_FREQUENCIA.get(
                            str(celula(linha, "Tipo de Contrato", "M")).strip().upper(),
                            Frequencia.MENSAL,
                        ),
                        "data_inicio": data("data de inicio"),
                        "data_fim": data("data fim "),
                        "data_rescisao": data("data de recisão"),
                        "status": (
                            StatusContrato.ATIVO
                            if str(celula(linha, "Status do Contrato", "Ativo")).lower() == "ativo"
                            else StatusContrato.SUSPENSO
                        ),
                        "tipo_registro": (
                            TipoRegistro.CONTRATO_FECHADO
                            if celula(linha, "tipo_registro") == "contrato_fechado"
                            else TipoRegistro.PREVISAO
                        ),
                        "tipo_conta": (
                            TipoConta.FIXO
                            if str(celula(linha, "Tipo da Conta", "Fixo")).lower() == "fixo"
                            else TipoConta.VARIAVEL
                        ),
                        "origem": OrigemLancamento.IMPORTACAO,
                    },
                )
                criados += 1

            if opcoes["dry_run"]:
                transaction.set_rollback(True)

        self.stdout.write(self.style.SUCCESS(
            f"{criados} contrato(s) processado(s). {alertas} alerta(s) de sinal."
        ))
        if not opcoes["dry_run"]:
            self.stdout.write(
                "As parcelas previstas foram geradas pelo signal post_save."
            )
