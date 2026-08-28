"""
Materialized views do consolidado de mercado.

Só roda no Postgres. Em SQLite (modo de desenvolvimento) a migration é um
no-op e o endpoint /notas/consolidado/ cai no agregado via ORM, que devolve o
mesmo resultado — mais lento, irrelevante no volume de desenvolvimento.
"""

from pathlib import Path

from django.db import migrations

SQL = (
    Path(__file__).resolve().parent.parent / "sql" / "0001_consolidado_mercado.sql"
).read_text(encoding="utf-8")

REVERSE = """
DROP MATERIALIZED VIEW IF EXISTS vw_mercado_produtos;
DROP MATERIALIZED VIEW IF EXISTS vw_mercado_consolidado;
"""


def criar_views(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute(SQL)


def remover_views(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute(REVERSE)


class Migration(migrations.Migration):
    dependencies = [("core", "0001_initial")]
    operations = [migrations.RunPython(criar_views, remover_views)]
