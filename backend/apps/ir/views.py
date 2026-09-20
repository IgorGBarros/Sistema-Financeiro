from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.common.api import WorkspaceViewSet

from .models import (
    DeclaracaoIR,
    Dependente,
    DespesaMedica,
    ModalidadeDeclaracao,
    OutraDedução,
    RendimentoCapitalVariavel,
)
from .serializers import (
    ComparacaoModalidadesSerializer,
    DeclaracaoIRSerializer,
    DependenteSerializer,
    DespesaMedicaSerializer,
    OutraDeducaoSerializer,
    RendimentoCapitalVariavelSerializer,
    ResultadoCalculoSerializer,
)
from .services.calculo import (
    calcular_imposto_estimado,
    comparar_modalidades,
)


class DeclaracaoIRViewSet(WorkspaceViewSet):
    serializer_class = DeclaracaoIRSerializer
    filterset_fields = ["ano", "modalidade", "status"]

    def get_queryset(self):
        return (
            DeclaracaoIR.objects.filter(workspace=self.workspace)
            .prefetch_related(
                "dependentes", "despesas_medicas",
                "capital_variavel", "outras_deducoes",
            )
            .order_by("-ano", "modalidade")
        )

    @action(detail=True, methods=["get"], url_path="calcular")
    def calcular(self, request, pk=None):
        """Calcula o imposto estimado para esta declaração."""
        declaracao = self.get_object()
        resultado = calcular_imposto_estimado(declaracao)
        return Response(ResultadoCalculoSerializer(resultado).data)

    @action(detail=False, methods=["get"], url_path="comparar")
    def comparar(self, request):
        """
        Compara declaração individual e conjunta para o mesmo ano.

        Query params: ano (obrigatório).
        Retorna erro se qualquer uma das declarações não existir.
        """
        ano = request.query_params.get("ano")
        if not ano:
            return Response(
                {"detail": "Informe o parâmetro 'ano'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        individual = get_object_or_404(
            DeclaracaoIR,
            workspace=self.workspace,
            ano=ano,
            modalidade=ModalidadeDeclaracao.INDIVIDUAL,
        )
        conjunta = get_object_or_404(
            DeclaracaoIR,
            workspace=self.workspace,
            ano=ano,
            modalidade=ModalidadeDeclaracao.CONJUNTA,
        )

        resultado = comparar_modalidades(individual, conjunta)
        return Response(ComparacaoModalidadesSerializer(resultado).data)


class DependenteViewSet(WorkspaceViewSet):
    serializer_class = DependenteSerializer
    filterset_fields = ["declaracao", "gera_deducao"]

    def get_queryset(self):
        return Dependente.objects.filter(
            workspace=self.workspace,
        ).order_by("nome")


class DespesaMedicaViewSet(WorkspaceViewSet):
    serializer_class = DespesaMedicaSerializer
    filterset_fields = ["declaracao", "tipo"]

    def get_queryset(self):
        return DespesaMedica.objects.filter(
            workspace=self.workspace,
        ).order_by("-data")


class RendimentoCapitalVariavelViewSet(WorkspaceViewSet):
    serializer_class = RendimentoCapitalVariavelSerializer
    filterset_fields = ["declaracao", "tipo", "isento"]

    def get_queryset(self):
        return RendimentoCapitalVariavel.objects.filter(
            workspace=self.workspace,
        ).order_by("-data")


class OutraDeducaoViewSet(WorkspaceViewSet):
    serializer_class = OutraDeducaoSerializer
    filterset_fields = ["declaracao", "tipo"]

    def get_queryset(self):
        return OutraDedução.objects.filter(
            workspace=self.workspace,
        ).order_by("tipo", "beneficiario")
