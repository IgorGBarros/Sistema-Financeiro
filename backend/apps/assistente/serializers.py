from rest_framework import serializers

from apps.assistente.models import Conversa, Mensagem


class MensagemSerializer(serializers.ModelSerializer):
    class Meta:
        model = Mensagem
        fields = ["id", "papel", "texto", "ferramentas_usadas", "criado_em"]
        read_only_fields = fields


class ConversaSerializer(serializers.ModelSerializer):
    mensagens = MensagemSerializer(many=True, read_only=True)

    class Meta:
        model = Conversa
        fields = ["id", "titulo", "mensagens", "criado_em", "atualizado_em"]
        read_only_fields = fields


class ConversaResumoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Conversa
        fields = ["id", "titulo", "atualizado_em"]
        read_only_fields = fields


class PerguntaSerializer(serializers.Serializer):
    pergunta = serializers.CharField(max_length=2000, trim_whitespace=True)
    conversa = serializers.UUIDField(required=False, allow_null=True)

    def validate_pergunta(self, valor):
        if not valor.strip():
            raise serializers.ValidationError("Escreva a pergunta.")
        return valor.strip()
