from rest_framework.routers import DefaultRouter

from apps.contratos import views

router = DefaultRouter()
router.register("contratos", views.ContratoViewSet, basename="contrato")
router.register("parcelas", views.ParcelaViewSet, basename="parcela")

urlpatterns = router.urls
