from rest_framework.routers import DefaultRouter

from apps.contas import views

router = DefaultRouter()
router.register("unidades-consumidoras", views.UnidadeConsumidoraViewSet, basename="unidade-consumidora")
router.register("contas-consumo", views.ContaConsumoViewSet, basename="conta-consumo")

urlpatterns = router.urls
