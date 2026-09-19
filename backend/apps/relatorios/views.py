from datetime import date, timedelta
from decimal import Decimal

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.api import workspace_do_request
from apps.relatorios.serializers import FluxoMensalSerializer
from apps.relatorios.services import fluxo_caixa

from apps.common.datas import hoje_local



class FluxoCaixaView(APIView):
    """
    Série mensal previsto x realizado, com saldo acumulado.
    O período pode ir para o futuro — é aí que a projeção aparece.

    GET /api/fluxo-caixa/?inicio=2026-01-01&fim=2027-12-01
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        workspace = workspace_do_request(request)
        hoje = hoje_local()
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
                "competencia", hoje_local().replace(day=1).isoformat()
            )
        )
        return Response({
            "competencia": competencia,
            "linhas": fluxo_caixa.aderencia_por_contrato(
                workspace, competencia=competencia
            ),
        })


class MatrizContratosView(APIView):
    """
    Entradas e saídas previstas, uma linha por estabelecimento e uma coluna
    por mês — a visão de tabela dinâmica.

    GET /api/matriz-contratos/?inicio=2026-01-01&fim=2026-12-01&agrupar_por=estabelecimento
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.relatorios.services.matriz import matriz_contratos

        workspace = workspace_do_request(request)
        hoje = hoje_local()
        inicio = date.fromisoformat(
            request.query_params.get("inicio", hoje.replace(day=1).isoformat())
        )
        fim = date.fromisoformat(
            request.query_params.get(
                "fim", (hoje.replace(day=1) + timedelta(days=365)).isoformat()
            )
        )
        try:
            return Response(
                matriz_contratos(
                    workspace,
                    inicio=inicio,
                    fim=fim,
                    agrupar_por=request.query_params.get("agrupar_por", "estabelecimento"),
                )
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)


class ConfrontoView(APIView):
    """
    Previsto, realizado e efetivo por competência.

    `efetivo` é o campo para somar o período: em mês fechado ele é o
    realizado; em mês aberto, o maior entre previsto e realizado, porque o
    resto ainda pode chegar.

    GET /api/confronto/?inicio=2026-01-01&fim=2026-12-01
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.relatorios.services.confronto import confronto_mensal

        hoje = hoje_local()
        inicio = date.fromisoformat(
            request.query_params.get("inicio", hoje.replace(day=1).isoformat())
        )
        fim = date.fromisoformat(
            request.query_params.get(
                "fim", (hoje.replace(day=1) + timedelta(days=365)).isoformat()
            )
        )
        return Response(
            confronto_mensal(workspace_do_request(request), inicio=inicio, fim=fim)
        )


class SaldoARealizarView(APIView):
    """Quanto do previsto ainda não virou realizado, contrato a contrato."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.relatorios.services.confronto import saldo_a_realizar

        return Response(saldo_a_realizar(workspace_do_request(request)))


class VincularRealizadosView(APIView):
    """
    Casa lançamentos órfãos com o contrato de mesma descrição.

    GET simula e mostra o que casaria; POST aplica.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.relatorios.services.confronto import vincular_realizados_por_descricao

        return Response(vincular_realizados_por_descricao(workspace_do_request(request)))

    def post(self, request):
        from apps.relatorios.services.confronto import vincular_realizados_por_descricao

        return Response(
            vincular_realizados_por_descricao(
                workspace_do_request(request), aplicar=True
            )
        )
