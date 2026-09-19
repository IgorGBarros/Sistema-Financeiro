from rest_framework.routers import DefaultRouter

from apps.folha import views

router = DefaultRouter()
router.register("holerites", views.HoleriteViewSet, basename="holerite")

urlpatterns = router.urls
