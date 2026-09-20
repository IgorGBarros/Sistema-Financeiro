from datetime import date

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.common.api import WorkspaceViewSet
from apps.common.datas import hoje_local
from apps.folha.models import Holerite
from apps.folha.serializers import HoleriteSerializer


class HoleriteViewSet(WorkspaceViewSet):
    """
    Somente leitura por padrão; o único endpoint de escrita é `integrar`.

    O campo `integrado` diz se aquele holerite já virou receita realizada.
    Enquanto for falso, o fluxo usa o contrato de salário previsto. Ver a
    explicação em apps/folha/models.py.
    """

    queryset = Holerite.objects.select_related("empregador").prefetch_related("verbas")
    serializer_class = HoleriteSerializer
    http_method_names = ["get", "head", "options", "post"]
    filterset_fields = ["competencia", "tipo_folha", "conferencia_ok"]

    @action(detail=True, methods=["post"], url_path="confirmar")
    def confirmar(self, request, pk=None):
        """
        Marca o holerite como conferido (conferencia_ok=True).

        A integração exige conferência prévia: este endpoint separa o ato de
        revisar do ato de lançar, permitindo que o mesmo recibo seja conferido
        num dispositivo e integrado noutro.
        """
        holerite = self.get_object()
        if holerite.conferencia_ok:
            return Response(
                {"detalhe": "Holerite já está marcado como conferido."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        holerite.conferencia_ok = True
        holerite.save(update_fields=["conferencia_ok"])
        return Response(HoleriteSerializer(holerite).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="integrar")
    def integrar(self, request, pk=None):
        """
        Transforma o holerite em receita realizada.

        Requer `categoria` (UUID) no corpo — quem paga o salário pode querer
        classificar em categorias diferentes.
        """
        holerite = self.get_object()
        if holerite.integrado:
            return Response(
                {"detalhe": "Este holerite já foi integrado ao fluxo de caixa."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not holerite.conferencia_ok:
            return Response(
                {"detalhe": "Confira o holerite antes de integrar (conferencia_ok=False)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        categoria_id = request.data.get("categoria")
        if not categoria_id:
            return Response(
                {"categoria": "Informe a categoria para o lançamento de receita."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from apps.catalogo.models import Categoria
        from apps.realizados.models import Realizado

        try:
            categoria = Categoria.objects.get(
                id=categoria_id, workspace=holerite.workspace
            )
        except Categoria.DoesNotExist:
            return Response(
                {"categoria": "Categoria não encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        data_pgto_str = request.data.get("data_pagamento", hoje_local().isoformat())
        realizado = Realizado.objects.create(
            workspace=holerite.workspace,
            categoria=categoria,
            descricao=f"Salário — {holerite.empregador.razao_social}",
            tipo="RECEITA",
            competencia=holerite.competencia,
            data_pagamento=date.fromisoformat(data_pgto_str),
            valor=holerite.valor_liquido,
            origem="MANUAL",
        )
        holerite.realizado = realizado
        holerite.save(update_fields=["realizado"])
        return Response(HoleriteSerializer(holerite).data, status=status.HTTP_200_OK)
