from datetime import date

from django.db.models import Count, Sum
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.common.api import WorkspaceViewSet
from apps.contratos.models import Contrato
from apps.contratos.serializers import (
    ContratoSerializer, ParcelaPrevistaSerializer, SimulacaoSerializer,
)


class ContratoViewSet(WorkspaceViewSet):
    """Tabela Entrada e Saída — os contratos previstos."""
    queryset = Contrato.objects.select_related(
        "estabelecimento", "categoria", "classificacao"
    )
    serializer_class = ContratoSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = [
        "tipo", "categoria", "classificacao", "status", "tipo_conta",
        "tipo_registro", "frequencia",
    ]
    search_fields = ["descricao", "estabelecimento__nome"]
    ordering_fields = ["data_inicio", "valor_unitario", "descricao"]

    def get_queryset(self):
        # O order_by explícito é necessário: a anotação com Count/Sum monta um
        # GROUP BY que o Django não garante ordenado, e a paginação do DRF
        # passa a devolver resultados inconsistentes entre páginas.
        return (
            super()
            .get_queryset()
            .annotate(
                parcelas_count=Count("parcelas", distinct=True),
                parcelas_total=Sum("parcelas__valor_previsto"),
            )
            .order_by("tipo", "descricao", "id")
        )

    @action(detail=True, methods=["get"])
    def parcelas(self, request, pk=None):
        """Projeção materializada do contrato."""
        contrato = self.get_object()
        parcelas = contrato.parcelas.all()
        return Response(ParcelaPrevistaSerializer(parcelas, many=True).data)

    @action(detail=True, methods=["post"])
    def rescindir(self, request, pk=None):
        """Rescinde o contrato numa data e recorta a projeção."""
        contrato = self.get_object()
        data_str = request.data.get("data_rescisao")
        if not data_str:
            return Response(
                {"data_rescisao": "Informe a data de rescisão."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        contrato.data_rescisao = date.fromisoformat(data_str)
        contrato.status = "RESCINDIDO"
        contrato.save()  # o signal regenera as parcelas
        return Response(self.get_serializer(contrato).data)

    @action(detail=False, methods=["post"])
    def simular(self, request):
        """Projeta sem gravar. Usado no formulário, antes de salvar."""
        serializer = SimulacaoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.projetar())
