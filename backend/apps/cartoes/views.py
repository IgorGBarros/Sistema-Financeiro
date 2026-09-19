from rest_framework.decorators import action
from rest_framework.response import Response

from apps.common.api import WorkspaceViewSet
from apps.cartoes.models import Cartao, Compra, Fatura
from apps.cartoes.serializers import (

    CartaoSerializer, CompraSerializer, FaturaSerializer, LancamentoFaturaSerializer,
)

from apps.common.datas import hoje_local


class CartaoViewSet(WorkspaceViewSet):
    queryset = Cartao.objects.all()
    serializer_class = CartaoSerializer
    filterset_fields = ["ativo", "bandeira"]

    @action(detail=False, methods=["get"])
    def painel(self, request):
        """
        Cartão × mês, com limite, comprometido e disponível.

        GET /api/cartoes/painel/?inicio=2026-01-01&fim=2026-06-01
        """
        from datetime import date, timedelta

        from apps.common.api import workspace_do_request
        from apps.relatorios.services.matriz import painel_cartoes

        hoje = hoje_local()
        inicio = date.fromisoformat(
            request.query_params.get("inicio", hoje.replace(day=1).isoformat())
        )
        fim = date.fromisoformat(
            request.query_params.get(
                "fim", (hoje.replace(day=1) + timedelta(days=180)).isoformat()
            )
        )
        return Response(
            painel_cartoes(workspace_do_request(request), inicio=inicio, fim=fim)
        )


class CompraViewSet(WorkspaceViewSet):
    queryset = Compra.objects.select_related(
        "cartao", "estabelecimento", "categoria"
    ).prefetch_related("parcelas")
    serializer_class = CompraSerializer
    filterset_fields = ["cartao", "categoria", "estabelecimento"]


class FaturaViewSet(WorkspaceViewSet):
    """
    Somente leitura: fatura nasce da importação do PDF, nunca digitada.
    """

    queryset = Fatura.objects.select_related("cartao").prefetch_related(
        "lancamentos__estabelecimento"
    )
    serializer_class = FaturaSerializer
    http_method_names = ["get", "head", "options"]
    filterset_fields = ["cartao", "competencia", "status"]

    @action(detail=True, methods=["get"], url_path="pendencias")
    def pendencias(self, request, pk=None):
        """
        Lançamentos que precisam de olho humano: sem parcela prevista
        correspondente, ou sem categoria.

        A conciliação automática nunca é silenciosa — o trabalho da pessoa é
        olhar estas linhas, não conferir as que já casaram.
        """
        fatura = self.get_object()
        pendentes = fatura.lancamentos.filter(
            secao="CORRENTE", parcela_compra__isnull=True
        )
        return Response({
            "fatura": str(fatura.id),
            "total": pendentes.count(),
            "sem_categoria": pendentes.filter(categoria__isnull=True).count(),
            "lancamentos": LancamentoFaturaSerializer(pendentes, many=True).data,
        })
