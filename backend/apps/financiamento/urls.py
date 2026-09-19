from rest_framework.routers import DefaultRouter

from apps.financiamento import views

router = DefaultRouter()
router.register("financiamentos", views.FinanciamentoViewSet, basename="financiamento")

urlpatterns = router.urls
