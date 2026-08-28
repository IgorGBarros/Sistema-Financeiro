"""Atualiza as materialized views. Rodar num cron a cada 15 min ou após carga."""
from django.core.management.base import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = "Refresh das views de consolidado do mercado."

    def handle(self, *args, **opcoes):
        with connection.cursor() as cursor:
            for view in ("vw_mercado_consolidado", "vw_mercado_produtos"):
                cursor.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {view};")
                self.stdout.write(self.style.SUCCESS(f"{view} atualizada."))
