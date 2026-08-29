"""
Settings divididos por ambiente.

    base.py  o que vale sempre
    dev.py   SQLite, DEBUG, autenticação de desenvolvimento
    prod.py  Postgres, Redis, Firebase, cabeçalhos de segurança

O módulo é escolhido por DJANGO_SETTINGS_MODULE; sem ele, cai em dev.
"""
