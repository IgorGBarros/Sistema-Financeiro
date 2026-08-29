"""Produção: Postgres (Supabase), Redis, Firebase e cabeçalhos de segurança."""

import os

from .base import *  # noqa: F403

DEBUG = False
ALLOWED_HOSTS = [h for h in os.environ.get("ALLOWED_HOSTS", "").split(",") if h]

if not ALLOWED_HOSTS:
    raise RuntimeError("Defina ALLOWED_HOSTS em produção.")
if SECRET_KEY.startswith("dev-"):  # noqa: F405
    raise RuntimeError("Defina uma SECRET_KEY real em produção.")

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "postgres"),
        "USER": os.environ["DB_USER"],
        "PASSWORD": os.environ["DB_PASSWORD"],
        "HOST": os.environ["DB_HOST"],
        # Supabase: pooler na 6543. Conexão direta esgota o limite rápido.
        "PORT": os.environ.get("DB_PORT", "6543"),
        "CONN_MAX_AGE": 0,  # obrigatoriamente 0 com pooler em modo transaction
        "OPTIONS": {"sslmode": "require"},
    }
}

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": os.environ["REDIS_URL"],
        "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
    }
}

REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"] = [  # noqa: F405
    "apps.accounts.authentication.FirebaseAuthentication",
    "rest_framework_simplejwt.authentication.JWTAuthentication",
]

CORS_ALLOWED_ORIGINS = [o for o in os.environ.get("CORS_ORIGINS", "").split(",") if o]
CORS_ALLOW_HEADERS = [
    "accept", "authorization", "content-type", "origin",
    "x-workspace", "x-csrftoken", "x-requested-with",
]

SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
