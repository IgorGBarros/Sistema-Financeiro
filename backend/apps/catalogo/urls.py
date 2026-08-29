from rest_framework.routers import DefaultRouter

from apps.catalogo import views

router = DefaultRouter()
router.register("classificacoes", views.ClassificacaoViewSet, basename="classificacao")
router.register("categorias", views.CategoriaViewSet, basename="categoria")
router.register("estabelecimentos", views.EstabelecimentoViewSet, basename="estabelecimento")

urlpatterns = router.urls
