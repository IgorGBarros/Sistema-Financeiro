from datetime import date
from decimal import Decimal

from django.db.models import Sum
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.response import Response

from django.db import models
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

    @action(detail=False, methods=["get"], url_path="por-categoria")
    def por_categoria(self, request):
        """Totaliza realizados por categoria no mês — alimenta o gráfico de pizza."""
        workspace = workspace_do_request(request)
        competencia_str = request.query_params.get(
            "competencia", hoje_local().replace(day=1).isoformat()
        )
        linhas = (
            Realizado.objects.filter(workspace=workspace, competencia=competencia_str)
            .select_related("categoria", "categoria__classificacao")
            .values(
                categoria=models.F("categoria__nome"),
                classificacao=models.F("categoria__classificacao__nome"),
                tipo=models.F("categoria__tipo"),
            )
            .annotate(total=Sum("valor"))
            .order_by("-total")
        )
        return Response(list(linhas))

    @action(detail=False, methods=["get"], url_path="evolucao-categoria")
    def evolucao_categoria(self, request):
        """
        Série histórica de despesas por categoria nos últimos N meses.

        GET /realizados/evolucao-categoria/?meses=6
        """
        workspace = workspace_do_request(request)
        meses = max(1, min(24, int(request.query_params.get("meses", 6))))

        hoje = hoje_local()
        fim = date(hoje.year, hoje.month, 1)
        # retrocede (meses-1) meses para obter o início do intervalo
        m = fim.month - (meses - 1)
        y = fim.year
        while m <= 0:
            m += 12
            y -= 1
        inicio = date(y, m, 1)

        linhas = (
            Realizado.objects.filter(
                workspace=workspace,
                competencia__gte=inicio,
                competencia__lte=fim,
                tipo="DESPESA",
            )
            .select_related("categoria", "categoria__classificacao")
            .values(
                competencia=models.F("competencia"),
                categoria=models.F("categoria__nome"),
            )
            .annotate(total=Sum("valor"))
            .order_by("competencia", "-total")
        )
        return Response(list(linhas))

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
