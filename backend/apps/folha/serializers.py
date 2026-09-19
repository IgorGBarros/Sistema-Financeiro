from rest_framework import serializers

from apps.folha.models import Holerite, Verba


class VerbaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Verba
        fields = ["id", "codigo", "descricao", "referencia", "valor", "natureza"]
        read_only_fields = fields


class HoleriteSerializer(serializers.ModelSerializer):
    verbas = VerbaSerializer(many=True, read_only=True)
    empregador_nome = serializers.CharField(source="empregador.razao_social", read_only=True)
    integrado = serializers.BooleanField(read_only=True)

    class Meta:
        model = Holerite
        fields = [
            "id", "empregador", "empregador_nome", "funcionario", "competencia",
            "tipo_folha", "total_vencimentos", "total_descontos", "valor_liquido",
            "salario_base", "base_inss", "base_fgts", "fgts_mes",
            "conferencia_ok", "integrado", "verbas",
        ]
        read_only_fields = fields
