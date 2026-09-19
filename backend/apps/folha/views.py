
from apps.common.api import WorkspaceViewSet
from apps.folha.models import Holerite
from apps.folha.serializers import HoleriteSerializer


class HoleriteViewSet(WorkspaceViewSet):
    """
    Somente leitura, e **isolado do fluxo de caixa** por ora.

    O campo `integrado` diz se aquele holerite já virou receita realizada.
    Enquanto for falso, o fluxo usa o contrato de salário previsto. Ver a
    explicação em apps/folha/models.py.
    """

    queryset = Holerite.objects.select_related("empregador").prefetch_related("verbas")
    serializer_class = HoleriteSerializer
    http_method_names = ["get", "head", "options"]
    filterset_fields = ["competencia", "tipo_folha", "conferencia_ok"]
