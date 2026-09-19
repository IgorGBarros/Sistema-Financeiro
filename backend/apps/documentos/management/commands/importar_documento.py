"""
Importa um PDF pela linha de comando.

    python manage.py importar_documento fatura.pdf --senha 03221 --simular
    python manage.py importar_documento ddc.pdf
    python manage.py importar_documento faturas/*.pdf --senha 03221

O `--simular` extrai e mostra o resultado sem gravar nada. Use sempre na
primeira vez com um layout novo: é mais barato conferir na tela que desfazer
lançamento errado no fluxo de caixa.
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import Workspace
from apps.documentos.services.base import ErroExtracao, extrair as extrair_pdf


class Command(BaseCommand):
    help = "Importa fatura de cartão, conta de consumo, DDC de financiamento ou holerite."

    def add_arguments(self, parser):
        parser.add_argument("arquivos", nargs="+", help="Um ou mais PDFs.")
        parser.add_argument("--senha", default=None, help="Senha do PDF, se houver.")
        parser.add_argument("--workspace", default=None, help="UUID do workspace.")
        parser.add_argument(
            "--tipo", default=None,
            help="Força o extrator: FATURA_CARTAO, CONTA_CONSUMO, FINANCIAMENTO, HOLERITE.",
        )
        parser.add_argument(
            "--simular", action="store_true",
            help="Extrai e mostra o resultado sem gravar nada.",
        )

    def handle(self, *args, **opcoes):
        from apps.documentos.services.importacao import importar

        if opcoes["workspace"]:
            workspace = Workspace.objects.filter(id=opcoes["workspace"]).first()
        else:
            workspace = Workspace.objects.first()
        if workspace is None and not opcoes["simular"]:
            raise CommandError("Nenhum workspace. Rode 'preparar_ambiente' antes.")

        for caminho_texto in opcoes["arquivos"]:
            caminho = Path(caminho_texto)
            if not caminho.exists():
                self.stderr.write(self.style.ERROR(f"Não encontrei {caminho}"))
                continue

            self.stdout.write(f"\n{'='*70}\n{caminho.name}")
            conteudo = caminho.read_bytes()

            if opcoes["simular"]:
                self._simular(conteudo, opcoes)
                continue

            documento, resultado = importar(
                workspace=workspace,
                conteudo=conteudo,
                nome_arquivo=caminho.name,
                senha=opcoes["senha"],
                tipo=opcoes["tipo"],
            )
            if documento.erro:
                self.stderr.write(self.style.ERROR(f"  {documento.erro}"))
                continue

            self.stdout.write(
                f"  tipo={documento.tipo}  competência={documento.competencia}  "
                f"total={documento.valor_total}  linhas={documento.linhas.count()}"
            )
            for aviso in documento.avisos:
                self.stdout.write(self.style.WARNING(f"  aviso: {aviso}"))
            if resultado:
                for chave, valor in resultado.items():
                    self.stdout.write(f"    {chave}: {valor}")

    def _simular(self, conteudo, opcoes):
        try:
            extracao = extrair_pdf(conteudo, senha=opcoes["senha"], tipo=opcoes["tipo"])
        except ErroExtracao as exc:
            self.stderr.write(self.style.ERROR(f"  {exc}"))
            return

        self.stdout.write(
            f"  tipo={extracao.tipo}  referência={extracao.referencia}\n"
            f"  competência={extracao.competencia}  vencimento={extracao.vencimento}\n"
            f"  total={extracao.valor_total}  emitente={extracao.emitente!r}"
        )
        for aviso in extracao.avisos:
            self.stdout.write(self.style.WARNING(f"  aviso: {aviso}"))

        self.stdout.write(f"\n  {len(extracao.linhas)} linha(s):")
        for linha in extracao.linhas[:15]:
            self.stdout.write(
                f"    {str(linha.data or ''):<12} {linha.descricao[:44]:<46} "
                f"{linha.valor:>12}"
            )
        if len(extracao.linhas) > 15:
            self.stdout.write(f"    ... e mais {len(extracao.linhas)-15}")
        self.stdout.write(self.style.WARNING("\n  SIMULAÇÃO — nada foi gravado."))
