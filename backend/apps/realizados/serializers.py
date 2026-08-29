from rest_framework import serializers

from apps.realizados.models import Realizado


class RealizadoSerializer(serializers.ModelSerializer):
    categoria_nome = serializers.CharField(source="categoria.nome", read_only=True)
    contrato_descricao = serializers.CharField(
        source="contrato.descricao", read_only=True, default=None
    )

    class Meta:
        model = Realizado
        fields = [
            "id", "contrato", "contrato_descricao", "parcela", "categoria",
            "categoria_nome", "descricao", "tipo", "competencia",
            "data_pagamento", "valor", "forma_pagamento", "origem",
            "competencia_mercado", "observacao",
        ]
        read_only_fields = ["origem", "competencia_mercado"]

    def validate(self, attrs):
        contrato = attrs.get("contrato") or getattr(self.instance, "contrato", None)
        tipo = attrs.get("tipo") or getattr(self.instance, "tipo", None)
        if contrato and tipo and contrato.tipo != tipo:
            raise serializers.ValidationError(
                {"tipo": "O tipo precisa ser o mesmo do contrato vinculado."}
            )
        if not attrs.get("competencia") and attrs.get("data_pagamento"):
            attrs["competencia"] = attrs["data_pagamento"].replace(day=1)
        return attrs
