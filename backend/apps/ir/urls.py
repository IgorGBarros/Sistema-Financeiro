from rest_framework.routers import DefaultRouter

from .views import (
    DeclaracaoIRViewSet,
    DependenteViewSet,
    DespesaMedicaViewSet,
    OutraDeducaoViewSet,
    RendimentoCapitalVariavelViewSet,
)

router = DefaultRouter()
router.register("declaracoes-ir", DeclaracaoIRViewSet, basename="declaracoes-ir")
router.register("ir-dependentes", DependenteViewSet, basename="ir-dependentes")
router.register("ir-despesas-medicas", DespesaMedicaViewSet, basename="ir-despesas-medicas")
router.register("ir-capital-variavel", RendimentoCapitalVariavelViewSet, basename="ir-capital-variavel")
router.register("ir-outras-deducoes", OutraDeducaoViewSet, basename="ir-outras-deducoes")

urlpatterns = router.urls
