from rest_framework import serializers

from apps.contas.models import ContaConsumo, ItemContaConsumo, UnidadeConsumidora


class UnidadeConsumidoraSerializer(serializers.ModelSerializer):
    class Meta:
        model = UnidadeConsumidora
        fields = [
            "id", "servico", "codigo_cliente", "apelido", "concessionaria",
            "endereco", "contrato",
        ]


class ItemContaConsumoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItemContaConsumo
        fields = ["id", "descricao", "valor"]
        read_only_fields = fields


class ContaConsumoSerializer(serializers.ModelSerializer):
    itens = ItemContaConsumoSerializer(many=True, read_only=True)
    unidade_apelido = serializers.CharField(source="unidade.apelido", read_only=True)
    tarifa_media = serializers.SerializerMethodField()

    class Meta:
        model = ContaConsumo
        fields = [
            "id", "unidade", "unidade_apelido", "competencia", "vencimento",
            "valor_total", "consumo", "leitura_anterior", "leitura_atual",
            "dias_faturados", "tarifa_media", "itens", "realizado",
        ]
        read_only_fields = fields

    def get_tarifa_media(self, obj):
        """
        O número que separa "gastei mais" de "ficou mais caro".

        Sem ele, as duas causas de uma conta alta parecem a mesma coisa — e
        elas pedem reações opostas.
        """
        return str(obj.tarifa_media) if obj.tarifa_media else None
