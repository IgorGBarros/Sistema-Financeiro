from datetime import date
from decimal import Decimal

from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.common.api import WorkspaceViewSet, workspace_do_request
from apps.contratos.models import ParcelaPrevista
from apps.realizados.models import Realizado
from apps.realizados.serializers import RealizadoSerializer

from apps.common.datas import hoje_local



class RealizadoViewSet(WorkspaceViewSet):
    queryset = Realizado.objects.select_related("categoria", "contrato")
    serializer_class = RealizadoSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["tipo", "categoria", "contrato", "competencia", "origem"]
    search_fields = ["descricao"]
    ordering_fields = ["data_pagamento", "valor", "competencia"]

    @action(detail=False, methods=["post"], url_path="baixar-parcela")
    def baixar_parcela(self, request):
        """Marca uma parcela prevista como paga, criando o realizado."""
        parcela_id = request.data.get("parcela")
        parcela = ParcelaPrevista.objects.filter(
            id=parcela_id, contrato__workspace=workspace_do_request(request)
        ).select_related("contrato").first()
        if parcela is None:
            return Response(
                {"parcela": "Parcela não encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        contrato = parcela.contrato
        realizado = Realizado.objects.create(
            workspace=contrato.workspace,
            contrato=contrato,
            parcela=parcela,
            categoria=contrato.categoria,
            descricao=contrato.descricao,
            tipo=contrato.tipo,
            competencia=parcela.competencia,
            data_pagamento=date.fromisoformat(
                request.data.get("data_pagamento", hoje_local().isoformat())
            ),
            valor=Decimal(str(request.data.get("valor", parcela.valor_previsto))),
            forma_pagamento=request.data.get("forma_pagamento", ""),
        )
        return Response(
            RealizadoSerializer(realizado).data, status=status.HTTP_201_CREATED
        )
