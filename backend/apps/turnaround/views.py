from decimal import Decimal, InvalidOperation

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.api import WorkspaceViewSet, workspace_do_request
from apps.turnaround.models import ClassificacaoContrato, PlanoTurnaround
from apps.turnaround.serializers import (
    ClassificacaoContratoSerializer,
    PlanoTurnaroundSerializer,
)
from apps.turnaround.services.diagnostico import diagnosticar


class PlanoTurnaroundViewSet(WorkspaceViewSet):
    queryset = PlanoTurnaround.objects.all()
    serializer_class = PlanoTurnaroundSerializer


class ClassificacaoContratoViewSet(WorkspaceViewSet):
    serializer_class = ClassificacaoContratoSerializer

    def get_queryset(self):
        qs = ClassificacaoContrato.objects.select_related(
            "contrato", "plano"
        ).filter(workspace=workspace_do_request(self.request))
        plano_id = self.request.query_params.get("plano")
        if plano_id:
            qs = qs.filter(plano_id=plano_id)
        return qs


class DiagnosticoView(APIView):
    """
    GET /api/turnaround/diagnostico/?saldo_atual=0

    Diagnóstico instantâneo da saúde financeira. Não persiste nada —
    é sempre calculado a partir dos contratos e realizados existentes.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        workspace = workspace_do_request(request)
        try:
            saldo_atual = Decimal(request.query_params.get("saldo_atual", "0"))
        except InvalidOperation:
            saldo_atual = Decimal("0")
        resultado = diagnosticar(workspace, saldo_atual)
        return Response(resultado)
