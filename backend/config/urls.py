from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path


def saude(_request):
    """Endpoint de saúde — usado pelo deploy e para checar se subiu."""
    return JsonResponse({"status": "ok", "servico": "financeiro-api"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("core.urls")),
    path("api/saude/", saude),
]
