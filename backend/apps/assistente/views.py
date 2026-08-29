from django.db import transaction
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.assistente.models import Conversa, Mensagem
from apps.assistente.serializers import (
    ConversaResumoSerializer, ConversaSerializer, PerguntaSerializer,
)
from apps.assistente.services import cliente, ferramentas
from apps.common.api import WorkspaceViewSet


class AssistenteViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """
    Conversas com o assistente financeiro.

    POST /api/assistente/perguntar/  faz a pergunta e devolve a resposta.
    """

    queryset = Conversa.objects.prefetch_related("mensagens")
    serializer_class = ConversaSerializer
    # Reaproveita o filtro de workspace sem herdar create/update, que aqui não
    # fazem sentido: conversa nasce de uma pergunta.
    permission_classes = WorkspaceViewSet.permission_classes
    get_queryset = WorkspaceViewSet.get_queryset
    get_workspace = WorkspaceViewSet.get_workspace

    def initial(self, request, *args, **kwargs):
        # O ScopedRateThrottle lê self.throttle_scope antes do handler rodar,
        # então o escopo é definido aqui e não no @action — passar
        # throttle_scope pelo decorator faz o router estourar TypeError.
        if self.action == "perguntar":
            self.throttle_scope = "assistente"
        super().initial(request, *args, **kwargs)

    def get_serializer_class(self):
        return ConversaResumoSerializer if self.action == "list" else ConversaSerializer

    @action(detail=False, methods=["get"])
    def capacidades(self, request):
        """
        O que o assistente sabe consultar. A interface usa isto para sugerir
        perguntas em vez de deixar a pessoa adivinhar.
        """
        return Response({
            "ferramentas": [
                {"nome": f.nome, "descricao": f.descricao}
                for f in ferramentas.REGISTRO.values()
            ],
            "exemplos": [
                "Em que mês meu saldo fica negativo?",
                "Quanto gastei de mercado nos últimos três meses?",
                "Quais são meus contratos ruins e quanto eles somam?",
                "O que eu ainda não paguei este mês?",
                "Quanto eu economizo se cancelar a escolinha de futebol?",
            ],
        })

    @action(detail=False, methods=["post"])
    def perguntar(self, request):
        serializer = PerguntaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        workspace = self.get_workspace()
        pergunta = serializer.validated_data["pergunta"]

        conversa = None
        if serializer.validated_data.get("conversa"):
            conversa = self.get_queryset().filter(
                id=serializer.validated_data["conversa"]
            ).first()
            if conversa is None:
                return Response(
                    {"detail": "Conversa não encontrada."},
                    status=status.HTTP_404_NOT_FOUND,
                )

        historico = self._reconstruir_historico(conversa) if conversa else []

        try:
            resultado = cliente.responder(
                workspace=workspace, pergunta=pergunta, historico=historico
            )
        except cliente.AssistenteIndisponivel as exc:
            return Response(
                {"detail": str(exc), "codigo": "nao_configurado"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except cliente.ErroAssistente as exc:
            return Response(
                {"detail": str(exc), "codigo": "falha_ia"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        with transaction.atomic():
            if conversa is None:
                conversa = Conversa.objects.create(
                    workspace=workspace,
                    usuario=request.user,
                    titulo=pergunta[:120],
                )
            Mensagem.objects.create(conversa=conversa, papel="user", texto=pergunta)
            mensagem = Mensagem.objects.create(
                conversa=conversa,
                papel="assistant",
                texto=resultado["resposta"],
                ferramentas_usadas=resultado["ferramentas_usadas"],
                blocos=resultado["historico"][-1]["content"],
            )
            conversa.save(update_fields=["atualizado_em"])

        return Response(
            {
                "conversa": str(conversa.id),
                "resposta": resultado["resposta"],
                "ferramentas_usadas": resultado["ferramentas_usadas"],
                "mensagem": str(mensagem.id),
            },
            status=status.HTTP_200_OK,
        )

    def _reconstruir_historico(self, conversa) -> list[dict]:
        """
        Remonta o histórico no formato da API.

        Só texto: os blocos de tool_use e tool_result da conversa anterior são
        descartados de propósito. Eles inflam o contexto rapidamente e o modelo
        chama a ferramenta de novo se precisar do dado atualizado — o que é o
        comportamento correto quando o banco pode ter mudado no meio tempo.
        """
        historico = []
        for msg in conversa.mensagens.all():
            if msg.texto:
                historico.append({"role": msg.papel, "content": msg.texto})
        return historico
