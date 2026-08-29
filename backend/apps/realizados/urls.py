from rest_framework.routers import DefaultRouter

from apps.realizados import views

router = DefaultRouter()
router.register("realizados", views.RealizadoViewSet, basename="realizado")

urlpatterns = router.urls
