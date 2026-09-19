from decimal import Decimal

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.api import workspace_do_request


class PrevisaoView(APIView):
    """
    Projeção dos próximos meses, com faixa e risco de saldo negativo.

    GET /api/previsao/?horizonte=12&saldo_inicial=0
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.previsao.services.previsao import prever

        try:
            horizonte = min(36, max(1, int(request.query_params.get("horizonte", 12))))
        except ValueError:
            return Response({"detail": "Horizonte inválido."}, status=400)

        try:
            saldo = Decimal(request.query_params.get("saldo_inicial", "0"))
        except Exception:  # noqa: BLE001
            return Response({"detail": "Saldo inicial inválido."}, status=400)

        return Response(
            prever(
                workspace_do_request(request),
                horizonte=horizonte,
                saldo_inicial=saldo,
            )
        )


class ModelosView(APIView):
    """Modelos disponíveis e o histórico mínimo de cada um."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.previsao.services import modelos
        from apps.previsao.services.previsao import serie_variavel

        historico = serie_variavel(workspace_do_request(request))
        return Response({
            "meses_de_historico": len(historico),
            "modelos": [
                {
                    "nome": m.nome,
                    "descricao": m.descricao,
                    "minimo_observacoes": m.minimo_observacoes,
                    "disponivel": len(historico) >= m.minimo_observacoes,
                }
                for m in modelos.REGISTRO
            ],
        })
