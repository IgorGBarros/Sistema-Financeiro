from rest_framework import serializers

from apps.documentos.models import Documento, LinhaDocumento


class LinhaDocumentoSerializer(serializers.ModelSerializer):
    class Meta:
        model = LinhaDocumento
        fields = ["id", "ordem", "descricao", "valor", "data", "extras"]
        read_only_fields = fields


class DocumentoSerializer(serializers.ModelSerializer):
    linhas = LinhaDocumentoSerializer(many=True, read_only=True)
    tem_avisos = serializers.BooleanField(read_only=True)

    class Meta:
        model = Documento
        fields = [
            "id", "nome_arquivo", "tipo", "status", "referencia", "competencia",
            "vencimento", "valor_total", "emitente", "titular", "avisos",
            "tem_avisos", "erro", "linhas", "criado_em", "processado_em",
        ]
        read_only_fields = fields


class DocumentoResumoSerializer(DocumentoSerializer):
    class Meta(DocumentoSerializer.Meta):
        fields = [f for f in DocumentoSerializer.Meta.fields if f != "linhas"]
        read_only_fields = fields


class ImportarDocumentoSerializer(serializers.Serializer):
    arquivo = serializers.FileField()
    senha = serializers.CharField(required=False, allow_blank=True)
    tipo = serializers.CharField(required=False, allow_blank=True)
    # Extrai e devolve o que entendeu, sem gravar no domínio. Serve para a
    # interface mostrar uma prévia antes de confirmar.
    simular = serializers.BooleanField(default=False)

    def validate_arquivo(self, arquivo):
        if arquivo.size > 20 * 1024 * 1024:
            raise serializers.ValidationError("O PDF passa de 20 MB.")
        if not arquivo.name.lower().endswith(".pdf"):
            raise serializers.ValidationError("Só aceito PDF por enquanto.")
        return arquivo
