from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.turnaround import views

router = DefaultRouter()
router.register("turnaround/planos", views.PlanoTurnaroundViewSet, basename="turnaround-plano")
router.register(
    "turnaround/classificacoes",
    views.ClassificacaoContratoViewSet,
    basename="turnaround-classificacao",
)

urlpatterns = [
    path("", include(router.urls)),
    path("turnaround/diagnostico/", views.DiagnosticoView.as_view(), name="turnaround-diagnostico"),
]
