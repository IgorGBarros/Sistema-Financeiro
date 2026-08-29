from datetime import date, timedelta
from decimal import Decimal

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.api import workspace_do_request
from apps.relatorios.serializers import FluxoMensalSerializer
from apps.relatorios.services import fluxo_caixa


class FluxoCaixaView(APIView):
    """
    Série mensal previsto x realizado, com saldo acumulado.
    O período pode ir para o futuro — é aí que a projeção aparece.

    GET /api/fluxo-caixa/?inicio=2026-01-01&fim=2027-12-01
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        workspace = workspace_do_request(request)
        hoje = date.today()
        inicio = date.fromisoformat(
            request.query_params.get("inicio", hoje.replace(day=1).isoformat())
        )
        fim = date.fromisoformat(
            request.query_params.get("fim", (hoje + timedelta(days=365)).isoformat())
        )
        saldo_inicial = Decimal(request.query_params.get("saldo_inicial", "0"))

        linhas = fluxo_caixa.fluxo_mensal(
            workspace, inicio=inicio, fim=fim, saldo_inicial=saldo_inicial
        )
        return Response({
            "inicio": inicio,
            "fim": fim,
            "linhas": FluxoMensalSerializer(linhas, many=True).data,
            "totais": {
                "receita_prevista": sum(l["receita_prevista"] for l in linhas),
                "despesa_prevista": sum(l["despesa_prevista"] for l in linhas),
                "saldo_final": linhas[-1]["saldo_acumulado"] if linhas else Decimal("0"),
            },
        })


class AderenciaView(APIView):
    """Previsto x realizado contrato a contrato num mês."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        workspace = workspace_do_request(request)
        competencia = date.fromisoformat(
            request.query_params.get(
                "competencia", date.today().replace(day=1).isoformat()
            )
        )
        return Response({
            "competencia": competencia,
            "linhas": fluxo_caixa.aderencia_por_contrato(
                workspace, competencia=competencia
            ),
        })


class ResumoClassificacaoView(APIView):
    """Peso de cada classificação nas despesas do período."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        workspace = workspace_do_request(request)
        hoje = date.today()
        inicio = date.fromisoformat(
            request.query_params.get("inicio", hoje.replace(month=1, day=1).isoformat())
        )
        fim = date.fromisoformat(
            request.query_params.get("fim", hoje.replace(month=12, day=1).isoformat())
        )
        return Response(
            fluxo_caixa.resumo_por_classificacao(workspace, inicio=inicio, fim=fim)
        )
