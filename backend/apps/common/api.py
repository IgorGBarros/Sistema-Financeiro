"""
Peças de API reusadas por todos os viewsets.

O ponto central aqui é o WorkspaceViewSet: ele garante, num único lugar, que
nenhum endpoint devolve dado de outro workspace. Repetir esse filtro em cada
viewset seria repetir a chance de esquecê-lo.
"""

from rest_framework import viewsets
from rest_framework.exceptions import NotAuthenticated
from rest_framework.permissions import IsAuthenticated


def workspace_do_request(request):
    """
    Resolve o workspace ativo a partir do usuário autenticado.

    O header X-Workspace só consegue ESCOLHER entre os workspaces dos quais o
    usuário já é membro — ele nunca concede acesso. Por isso o filtro parte
    sempre de request.user.workspaces.
    """
    if not request.user or not request.user.is_authenticated:
        return None
    disponiveis = request.user.workspaces.all()
    escolhido = request.headers.get("X-Workspace")
    if escolhido:
        return disponiveis.filter(id=escolhido).first()
    return disponiveis.first()



class WorkspaceViewSet(viewsets.ModelViewSet):
    """Base de todo viewset de negócio. Filtra e atribui o workspace sozinho."""

    permission_classes = [IsAuthenticated]

    def get_workspace(self):
        workspace = workspace_do_request(self.request)
        if workspace is None:
            raise NotAuthenticated(
                "Usuário sem workspace ativo. Rode 'preparar_ambiente' ou "
                "confira o header X-Workspace."
            )
        return workspace

    def get_queryset(self):
        workspace = workspace_do_request(self.request)
        if workspace is None:
            return self.queryset.none()
        return self.queryset.filter(workspace=workspace)

    def perform_create(self, serializer):
        # O workspace vem do request, nunca do payload.
        serializer.save(workspace=self.get_workspace())
