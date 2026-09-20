from rest_framework import serializers

from apps.turnaround.models import ClassificacaoContrato, PlanoTurnaround, StatusPlano


class PlanoTurnaroundSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlanoTurnaround
        fields = [
            "id",
            "nome",
            "status",
            "data_inicio",
            "meta_saldo",
            "meta_comprometimento_pct",
            "observacao",
            "criado_em",
            "atualizado_em",
        ]
        read_only_fields = ["id", "criado_em", "atualizado_em"]

    def validate(self, data):
        # Só um plano pode estar ATIVO por workspace.
        workspace = self.context["request"].user.workspaces.first()
        status = data.get("status", getattr(self.instance, "status", None))
        if status == StatusPlano.ATIVO:
            qs = PlanoTurnaround.objects.filter(workspace=workspace, status=StatusPlano.ATIVO)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    {"status": "Já existe um plano ATIVO. Pause ou conclua-o antes de ativar outro."}
                )
        return data


class ClassificacaoContratoSerializer(serializers.ModelSerializer):
    contrato_descricao = serializers.CharField(
        source="contrato.descricao", read_only=True
    )
    contrato_valor = serializers.DecimalField(
        source="contrato.valor_unitario",
        max_digits=14,
        decimal_places=2,
        read_only=True,
    )
    contrato_tipo = serializers.CharField(source="contrato.tipo", read_only=True)

    class Meta:
        model = ClassificacaoContrato
        fields = [
            "id",
            "plano",
            "contrato",
            "contrato_descricao",
            "contrato_valor",
            "contrato_tipo",
            "tipo",
            "justificativa",
            "criado_em",
        ]
        read_only_fields = ["id", "criado_em"]
