from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from core import views

router = DefaultRouter()
router.register("classificacoes", views.ClassificacaoViewSet, basename="classificacao")
router.register("categorias", views.CategoriaViewSet, basename="categoria")
router.register("estabelecimentos", views.EstabelecimentoViewSet, basename="estabelecimento")
router.register("contratos", views.ContratoViewSet, basename="contrato")
router.register("realizados", views.RealizadoViewSet, basename="realizado")
router.register("notas", views.NotaFiscalViewSet, basename="nota")

urlpatterns = [
    path("", include(router.urls)),
    path("fluxo-caixa/", views.FluxoCaixaView.as_view(), name="fluxo-caixa"),
    path("aderencia/", views.AderenciaView.as_view(), name="aderencia"),
    path("resumo-classificacao/", views.ResumoClassificacaoView.as_view(), name="resumo-classificacao"),
    path("auth/token/", TokenObtainPairView.as_view(), name="token-obtain"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
]
