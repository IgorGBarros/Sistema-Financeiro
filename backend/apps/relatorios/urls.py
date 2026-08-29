from django.urls import path

from apps.relatorios import views

urlpatterns = [
    path("fluxo-caixa/", views.FluxoCaixaView.as_view(), name="fluxo-caixa"),
    path("aderencia/", views.AderenciaView.as_view(), name="aderencia"),
    path(
        "resumo-classificacao/",
        views.ResumoClassificacaoView.as_view(),
        name="resumo-classificacao",
    ),
]
