"""
Configuração do Django.

Roda em dois modos, controlados por variáveis de ambiente:

  DEV   — SQLite + autenticação de desenvolvimento. Nenhuma credencial
          externa necessária. É o modo em que `python manage.py runserver`
          sobe sem você configurar nada.
  PROD  — Postgres (Supabase) + Redis + Firebase.

O modo é decidido pela presença de DB_HOST. Isso evita o clássico "funciona na
minha máquina depois de 40 minutos de setup".
"""

import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-inseguro-troque-em-producao")
DEBUG = os.environ.get("DEBUG", "1") == "1"
ALLOWED_HOSTS = os.environ.get("ALLOWED_HOSTS", "*").split(",")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "django_filters",
    "corsheaders",
    "core",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ---------------------------------------------------------------------------
# Banco
# ---------------------------------------------------------------------------

if os.environ.get("DB_HOST"):
    # Supabase: use o pooler (porta 6543). O Django abre uma conexão por worker
    # do Gunicorn e o limite de conexões diretas do Supabase é baixo.
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ.get("DB_NAME", "postgres"),
            "USER": os.environ["DB_USER"],
            "PASSWORD": os.environ["DB_PASSWORD"],
            "HOST": os.environ["DB_HOST"],
            "PORT": os.environ.get("DB_PORT", "6543"),
            "CONN_MAX_AGE": 0,  # 0 com pooler em modo transaction
            "OPTIONS": {"sslmode": "require"},
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

USANDO_POSTGRES = DATABASES["default"]["ENGINE"].endswith("postgresql")

# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

if os.environ.get("REDIS_URL"):
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": os.environ["REDIS_URL"],
            "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
        }
    }
else:
    CACHES = {
        "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}
    }

# ---------------------------------------------------------------------------
# DRF
# ---------------------------------------------------------------------------

FIREBASE_CREDENTIALS = os.environ.get("FIREBASE_CREDENTIALS_PATH", "")

AUTENTICADORES = [
    "rest_framework_simplejwt.authentication.JWTAuthentication",
]
if FIREBASE_CREDENTIALS:
    # Firebase primeiro: se o token não for dele, cai no SimpleJWT.
    AUTENTICADORES.insert(0, "core.authentication.FirebaseAuthentication")
if DEBUG and not FIREBASE_CREDENTIALS:
    # Só existe em desenvolvimento e só quando o Firebase não está configurado.
    AUTENTICADORES.append("core.authentication.AutenticacaoDesenvolvimento")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": AUTENTICADORES,
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    # A consulta na SEFAZ é a operação cara e a que pode bloquear nosso IP.
    "DEFAULT_THROTTLE_RATES": {"scan": "60/hour", "user": "1000/hour"},
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
}

CORS_ALLOWED_ORIGINS = os.environ.get(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
CORS_ALLOW_HEADERS = [
    "accept", "authorization", "content-type", "origin", "x-workspace",
    "x-csrftoken", "x-requested-with",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Bahia"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "core.services.sefaz_ba": {"level": "DEBUG" if DEBUG else "INFO"},
    },
}
