from rest_framework.decorators import action
from rest_framework.response import Response

from apps.common.api import WorkspaceViewSet
from apps.contas.models import ContaConsumo, UnidadeConsumidora
from apps.contas.serializers import ContaConsumoSerializer, UnidadeConsumidoraSerializer


class UnidadeConsumidoraViewSet(WorkspaceViewSet):
    queryset = UnidadeConsumidora.objects.all()
    serializer_class = UnidadeConsumidoraSerializer
    filterset_fields = ["servico"]


class ContaConsumoViewSet(WorkspaceViewSet):
    queryset = ContaConsumo.objects.select_related("unidade").prefetch_related("itens")
    serializer_class = ContaConsumoSerializer
    http_method_names = ["get", "head", "options"]
    filterset_fields = ["unidade", "competencia"]

    @action(detail=False, methods=["get"])
    def historico(self, request):
        """
        Série de valor, consumo e tarifa por mês.

        Serve para responder por que a conta subiu: mais consumo, ou tarifa
        mais cara.
        """
        consultas = self.get_queryset().order_by("competencia")
        return Response([
            {
                "competencia": c.competencia.isoformat(),
                "valor": str(c.valor_total),
                "consumo": str(c.consumo) if c.consumo else None,
                "tarifa_media": str(c.tarifa_media) if c.tarifa_media else None,
            }
            for c in consultas
        ])
