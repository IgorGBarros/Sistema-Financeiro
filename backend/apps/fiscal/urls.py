from rest_framework.routers import DefaultRouter

from apps.fiscal import views

router = DefaultRouter()
router.register("notas", views.NotaFiscalViewSet, basename="nota")

urlpatterns = router.urls
