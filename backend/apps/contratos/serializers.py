from decimal import Decimal

from rest_framework import serializers

from apps.contratos.models import Contrato, ParcelaPrevista
from apps.contratos.services.projecao import projetar


class ParcelaPrevistaSerializer(serializers.ModelSerializer):
    class Meta:
        model = ParcelaPrevista
        fields = [
            "id", "indice", "competencia", "data_planejada", "valor_previsto",
            "quantidade_planejada", "espacamento_dias",
        ]


class ContratoSerializer(serializers.ModelSerializer):
    estabelecimento_nome = serializers.CharField(
        source="estabelecimento.nome", read_only=True
    )
    categoria_nome = serializers.CharField(source="categoria.nome", read_only=True)
    classificacao_nome = serializers.CharField(
        source="classificacao.nome", read_only=True
    )
    quantidade_parcelas = serializers.SerializerMethodField()
    valor_total_contrato = serializers.SerializerMethodField()

    class Meta:
        model = Contrato
        fields = [
            "id", "numero", "estabelecimento", "estabelecimento_nome",
            "descricao", "tipo", "categoria", "categoria_nome", "classificacao",
            "classificacao_nome", "valor_unitario", "frequencia",
            "reajuste_anual_pct", "data_inicio", "data_fim", "data_rescisao",
            "status", "tipo_registro", "tipo_conta", "forma_pagamento",
            "origem", "observacao", "quantidade_parcelas",
            "valor_total_contrato", "criado_em",
        ]
        read_only_fields = ["origem", "criado_em"]

    def get_quantidade_parcelas(self, obj) -> int:
        return getattr(obj, "parcelas_count", None) or obj.parcelas.count()

    def get_valor_total_contrato(self, obj) -> Decimal:
        agregado = getattr(obj, "parcelas_total", None)
        if agregado is not None:
            return agregado
        return sum(
            (p.valor_previsto for p in obj.parcelas.all()), Decimal("0")
        )

    def validate(self, attrs):
        inicio = attrs.get("data_inicio") or getattr(self.instance, "data_inicio", None)
        fim = attrs.get("data_fim") or getattr(self.instance, "data_fim", None)
        rescisao = attrs.get("data_rescisao")
        categoria = attrs.get("categoria") or getattr(self.instance, "categoria", None)
        tipo = attrs.get("tipo") or getattr(self.instance, "tipo", None)

        if inicio and fim and inicio > fim:
            raise serializers.ValidationError(
                {"data_fim": "A data fim não pode ser anterior à data de início."}
            )
        if rescisao and inicio and rescisao < inicio:
            raise serializers.ValidationError(
                {"data_rescisao": "A rescisão não pode ser anterior ao início."}
            )
        if categoria and tipo and categoria.tipo != tipo:
            raise serializers.ValidationError(
                {"categoria": f"Esta categoria é de {categoria.get_tipo_display()}."}
            )
        return attrs


class SimulacaoSerializer(serializers.Serializer):
    """Projeta sem salvar — para o usuário ver as parcelas antes de confirmar."""
    data_inicio = serializers.DateField()
    data_fim = serializers.DateField()
    valor_unitario = serializers.DecimalField(max_digits=14, decimal_places=2)
    frequencia = serializers.CharField(default="M")
    data_rescisao = serializers.DateField(required=False, allow_null=True)
    reajuste_anual_pct = serializers.DecimalField(
        max_digits=6, decimal_places=3, default=Decimal("0")
    )

    def projetar(self):
        parcelas = projetar(**self.validated_data)
        return {
            "quantidade_parcelas": len(parcelas),
            "valor_total": sum((p.valor_previsto for p in parcelas), Decimal("0")),
            "parcelas": [
                {
                    "indice": p.indice,
                    "competencia": p.competencia,
                    "data_planejada": p.data_planejada,
                    "valor_previsto": p.valor_previsto,
                }
                for p in parcelas
            ],
        }
