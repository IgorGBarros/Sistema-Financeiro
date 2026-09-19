"""
Desenvolvimento: SQLite, sem serviço externo obrigatório.

A ideia é que `runserver` funcione no primeiro minuto, antes de qualquer
credencial de nuvem existir.
"""

from .base import *  # noqa: F403

DEBUG = True
ALLOWED_HOSTS = ["*"]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",  # noqa: F405
    }
}

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

AUTENTICADORES = ["rest_framework_simplejwt.authentication.JWTAuthentication"]
if FIREBASE_CREDENTIALS:  # noqa: F405
    AUTENTICADORES.insert(0, "apps.accounts.authentication.FirebaseAuthentication")
else:
    # Atalho que só existe aqui. prod.py nunca inclui esta classe.
    AUTENTICADORES.append("apps.accounts.authentication.AutenticacaoDesenvolvimento")

REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"] = AUTENTICADORES  # noqa: F405

CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
CORS_ALLOW_HEADERS = [
    "accept", "authorization", "content-type", "origin",
    "x-workspace", "x-csrftoken", "x-requested-with",
]

LOGGING["root"]["level"] = "DEBUG"  # noqa: F405
# Mesmo em DEBUG, o pdfminer continua silenciado — ver base.py.
