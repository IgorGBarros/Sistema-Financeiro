from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.common.api import WorkspaceViewSet
from apps.documentos.models import Documento
from apps.documentos.serializers import (
    DocumentoResumoSerializer, DocumentoSerializer, ImportarDocumentoSerializer,
)
from apps.documentos.services.base import ErroExtracao, extratores
from apps.documentos.services.importacao import importar, processar_documento


class DocumentoViewSet(WorkspaceViewSet):
    """Importação e histórico dos PDFs processados."""

    queryset = Documento.objects.prefetch_related("linhas")
    serializer_class = DocumentoSerializer
    parser_classes = [MultiPartParser, FormParser]
    http_method_names = ["get", "post", "delete", "head", "options"]
    filterset_fields = ["tipo", "status", "competencia"]

    def get_serializer_class(self):
        return DocumentoResumoSerializer if self.action == "list" else DocumentoSerializer

    def create(self, request, *args, **kwargs):
        return Response(
            {"detail": "Use /documentos/importar/ para enviar um PDF."},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    @action(detail=False, methods=["get"])
    def tipos(self, request):
        """O que o sistema sabe ler. A interface usa para orientar o upload."""
        return Response([
            {"tipo": e.tipo, "nome": e.nome} for e in extratores()
        ])

    @action(detail=False, methods=["post"], url_path="importar")
    def importar_arquivo(self, request):
        serializer = ImportarDocumentoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        arquivo = serializer.validated_data["arquivo"]

        try:
            documento, resultado = importar(
                workspace=self.get_workspace(),
                conteudo=arquivo.read(),
                nome_arquivo=arquivo.name,
                senha=serializer.validated_data.get("senha") or None,
                tipo=serializer.validated_data.get("tipo") or None,
                usuario=request.user,
                processar=not serializer.validated_data["simular"],
            )
        except ErroExtracao as exc:
            return Response(
                {"detail": str(exc), "codigo": "extracao"},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        corpo = DocumentoSerializer(documento).data
        corpo["resultado"] = resultado
        return Response(corpo, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def reprocessar(self, request, pk=None):
        """
        Reinterpreta um documento já extraído.

        Usado quando um extrator melhora: os documentos antigos são
        reprocessados a partir do que já está gravado, sem pedir os PDFs.
        """
        documento = self.get_object()
        try:
            resultado = processar_documento(documento)
        except (ErroExtracao, ValueError) as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )
        corpo = DocumentoSerializer(documento).data
        corpo["resultado"] = resultado
        return Response(corpo)
