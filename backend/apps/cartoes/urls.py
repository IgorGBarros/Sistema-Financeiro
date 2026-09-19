from rest_framework.routers import DefaultRouter

from apps.cartoes import views

router = DefaultRouter()
router.register("cartoes", views.CartaoViewSet, basename="cartao")
router.register("compras", views.CompraViewSet, basename="compra")
router.register("faturas", views.FaturaViewSet, basename="fatura")

urlpatterns = router.urls
