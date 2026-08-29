from rest_framework.routers import DefaultRouter

from apps.assistente import views

router = DefaultRouter()
router.register("assistente", views.AssistenteViewSet, basename="assistente")

urlpatterns = router.urls
