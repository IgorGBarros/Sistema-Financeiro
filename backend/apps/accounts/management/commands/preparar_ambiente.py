"""
Prepara o ambiente do zero em um comando.

    python manage.py preparar_ambiente
    python manage.py preparar_ambiente --planilha "Entrada e Saida.xlsx"

Cria o usuário de desenvolvimento, o workspace, o plano de contas e — se você
passar a planilha — importa os contratos. Idempotente: rodar de novo não
duplica nada.
"""

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand

from apps.accounts.authentication import USUARIO_DEV
from apps.accounts.services.seed import criar_workspace_padrao

User = get_user_model()


class Command(BaseCommand):
    help = "Cria usuário, workspace e plano de contas iniciais."

    def add_arguments(self, parser):
        parser.add_argument(
            "--planilha", help="Caminho do .xlsx de entrada e saída para importar."
        )
        parser.add_argument(
            "--email", default=USUARIO_DEV, help="Usuário dono do workspace."
        )

    def handle(self, *args, **opcoes):
        usuario, criado = User.objects.get_or_create(
            username=opcoes["email"],
            defaults={"email": opcoes["email"], "is_staff": True},
        )
        if criado:
            usuario.set_unusable_password()
            usuario.save(update_fields=["password"])
            self.stdout.write(f"Usuário criado: {usuario.username}")

        workspace = usuario.workspaces.first()
        if workspace is None:
            workspace = criar_workspace_padrao(usuario, nome="Minhas finanças")
            self.stdout.write(f"Workspace criado: {workspace.nome}")
        else:
            from apps.accounts.services.seed import popular_plano_de_contas

            popular_plano_de_contas(workspace)
            self.stdout.write(f"Workspace existente: {workspace.nome}")

        from apps.catalogo.models import Categoria, Classificacao

        self.stdout.write(
            f"  {Classificacao.objects.filter(workspace=workspace).count()} classificações, "
            f"{Categoria.objects.filter(workspace=workspace).count()} categorias."
        )

        if opcoes["planilha"]:
            call_command(
                "importar_planilha",
                arquivo=opcoes["planilha"],
                workspace=str(workspace.id),
            )

        self.stdout.write(self.style.SUCCESS("\nAmbiente pronto."))
        self.stdout.write(f"WORKSPACE_ID = {workspace.id}")
        self.stdout.write("Suba a API com: python manage.py runserver")
