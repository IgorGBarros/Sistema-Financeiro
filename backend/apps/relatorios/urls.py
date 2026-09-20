from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.relatorios import views

router = DefaultRouter()
router.register("metas-orcamentarias", views.MetaOrcamentariaViewSet, basename="meta-orcamentaria")

urlpatterns = [
    path("", include(router.urls)),
    path("fluxo-caixa/", views.FluxoCaixaView.as_view(), name="fluxo-caixa"),
    path("aderencia/", views.AderenciaView.as_view(), name="aderencia"),
    path("confronto/", views.ConfrontoView.as_view(), name="confronto"),
    path("saldo-a-realizar/", views.SaldoARealizarView.as_view(), name="saldo-a-realizar"),
    path(
        "vincular-realizados/",
        views.VincularRealizadosView.as_view(),
        name="vincular-realizados",
    ),
    path("matriz-contratos/", views.MatrizContratosView.as_view(), name="matriz-contratos"),
]
