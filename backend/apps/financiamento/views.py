from rest_framework.decorators import action
from rest_framework.response import Response

from apps.common.api import WorkspaceViewSet
from decimal import Decimal

from django.db.models import Count, DecimalField, Prefetch, Q, Sum, Value
from django.db.models.functions import Coalesce

from apps.financiamento.models import Financiamento, ParcelaFinanciamento
from apps.financiamento.serializers import FinanciamentoSerializer


class FinanciamentoViewSet(WorkspaceViewSet):
    queryset = Financiamento.objects.all()
    serializer_class = FinanciamentoSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        """
        Tudo que o serializer precisa vem em consultas agregadas.

        `prefetch_related("parcelas")` carregaria as 296 parcelas de cada
        financiamento na memória para somar em Python. Os dois Prefetch com
        slice trazem exatamente uma linha cada.
        """
        pagas = Q(parcelas__situacao="PAGA")
        abertas = ~Q(parcelas__situacao="PAGA")

        return (
            super()
            .get_queryset()
            .annotate(
                parcelas_pagas=Count("parcelas", filter=pagas, distinct=True),
                parcelas_restantes=Count("parcelas", filter=abertas, distinct=True),
                total_a_pagar=Coalesce(
                    Sum("parcelas__valor_total", filter=abertas),
                    Value(Decimal("0")),
                    output_field=DecimalField(max_digits=14, decimal_places=2),
                ),
                juros_a_pagar=Coalesce(
                    Sum("parcelas__juros", filter=abertas),
                    Value(Decimal("0")),
                    output_field=DecimalField(max_digits=14, decimal_places=2),
                ),
            )
            .prefetch_related(
                Prefetch(
                    "parcelas",
                    queryset=ParcelaFinanciamento.objects.filter(
                        situacao="PAGA"
                    ).order_by("-numero")[:1],
                    to_attr="_ultima_paga",
                ),
                Prefetch(
                    "parcelas",
                    queryset=ParcelaFinanciamento.objects.exclude(
                        situacao="PAGA"
                    ).order_by("numero")[:1],
                    to_attr="_proxima",
                ),
            )
            .order_by("numero_contrato")
        )

    @action(detail=True, methods=["get"])
    def parcelas(self, request, pk=None):
        from apps.financiamento.serializers import ParcelaFinanciamentoSerializer

        financiamento = self.get_object()
        consulta = financiamento.parcelas.all()
        if request.query_params.get("situacao"):
            consulta = consulta.filter(situacao=request.query_params["situacao"].upper())
        return Response(ParcelaFinanciamentoSerializer(consulta[:400], many=True).data)

    @action(detail=True, methods=["get"])
    def duplicidades(self, request, pk=None):
        """
        Contratos que projetam os mesmos meses que este financiamento.

        Quem cadastrava o financiamento como contrato de valor fixo passa a ter
        os dois somando no fluxo de caixa. Aqui a pessoa vê e decide — o
        sistema não apaga contrato sozinho porque ele pode ter realizados
        vinculados.
        """
        from apps.financiamento.services.importacao import detectar_duplicidade

        return Response({"duplicidades": detectar_duplicidade(self.get_object())})
