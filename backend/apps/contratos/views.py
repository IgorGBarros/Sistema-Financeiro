from datetime import date

from django.db.models import Count, Sum
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, mixins, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.common.api import WorkspaceViewSet, workspace_do_request
from apps.contratos.models import Contrato
from apps.contratos.models import ParcelaPrevista
from apps.contratos.serializers import (
    ContratoSerializer, ParcelaComContratoSerializer, ParcelaPrevistaSerializer,
    SimulacaoSerializer,
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


class ParcelaViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """
    Parcelas previstas de todos os contratos, para a linha do tempo de projeção.

    Somente leitura: parcela nasce da projeção do contrato e nunca é editada à
    mão. Alterar uma parcela isolada faria a projeção discordar do contrato que
    a originou.

    GET /api/parcelas/?inicio=2026-01-01&fim=2026-06-01
    """

    serializer_class = ParcelaComContratoSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["contrato", "competencia"]
    ordering_fields = ["data_planejada", "valor_previsto"]
    ordering = ["data_planejada", "id"]

    def get_queryset(self):
        # ParcelaPrevista não tem workspace próprio: o isolamento vem pelo
        # contrato. Por isso o filtro não pode herdar de WorkspaceViewSet.
        workspace = workspace_do_request(self.request)
        if workspace is None:
            return ParcelaPrevista.objects.none()

        consulta = (
            ParcelaPrevista.objects.filter(contrato__workspace=workspace)
            .exclude(contrato__status="ENCERRADO")
            .select_related(
                "contrato",
                "contrato__estabelecimento",
                "contrato__categoria",
                "contrato__classificacao",
                "realizado",
            )
        )

        inicio = self.request.query_params.get("inicio")
        fim = self.request.query_params.get("fim")
        if inicio:
            consulta = consulta.filter(competencia__gte=inicio)
        if fim:
            consulta = consulta.filter(competencia__lte=fim)
        if self.request.query_params.get("tipo"):
            consulta = consulta.filter(
                contrato__tipo=self.request.query_params["tipo"].upper()
            )
        return consulta
