from rest_framework.routers import DefaultRouter

from apps.documentos import views

router = DefaultRouter()
router.register("documentos", views.DocumentoViewSet, basename="documento")

urlpatterns = router.urls
