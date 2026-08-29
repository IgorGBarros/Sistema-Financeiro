"""
Roteamento central.

Cada app publica suas próprias rotas em `<app>/urls.py`. Adicionar uma feature
nova é criar o app e incluir uma linha aqui.
"""

from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView


def saude(_request):
    """Usado pelo deploy e para conferir rapidamente se a API subiu."""
    return JsonResponse({"status": "ok", "servico": "financeiro-api"})


api = [
    path("", include("apps.catalogo.urls")),
    path("", include("apps.contratos.urls")),
    path("", include("apps.realizados.urls")),
    path("", include("apps.fiscal.urls")),
    path("", include("apps.relatorios.urls")),
    path("", include("apps.assistente.urls")),
    path("saude/", saude, name="saude"),
    path("auth/token/", TokenObtainPairView.as_view(), name="token-obtain"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include(api)),
]
