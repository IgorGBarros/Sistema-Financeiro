from decimal import Decimal

from rest_framework import serializers

from .models import (
    DeclaracaoIR,
    Dependente,
    DespesaMedica,
    OutraDedução,
    RendimentoCapitalVariavel,
)


class DependenteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Dependente
        fields = [
            "id", "declaracao", "nome", "cpf", "data_nascimento",
            "parentesco", "parentesco_display", "rendimento_proprio", "gera_deducao",
        ]
        read_only_fields = ["id"]

    parentesco_display = serializers.CharField(source="get_parentesco_display", read_only=True)


class DespesaMedicaSerializer(serializers.ModelSerializer):
    class Meta:
        model = DespesaMedica
        fields = [
            "id", "declaracao", "tipo", "tipo_display", "prestador",
            "cnpj_prestador", "beneficiario", "data", "valor", "nota_fiscal", "observacao",
        ]
        read_only_fields = ["id"]

    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)


class RendimentoCapitalVariavelSerializer(serializers.ModelSerializer):
    class Meta:
        model = RendimentoCapitalVariavel
        fields = [
            "id", "declaracao", "tipo", "tipo_display", "descricao",
            "cnpj_emissor", "valor_bruto", "imposto_retido", "isento", "data",
        ]
        read_only_fields = ["id"]

    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)


class OutraDeducaoSerializer(serializers.ModelSerializer):
    class Meta:
        model = OutraDedução
        fields = [
            "id", "declaracao", "tipo", "tipo_display",
            "beneficiario", "instituicao", "cnpj_instituicao", "valor", "observacao",
        ]
        read_only_fields = ["id"]

    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)


class DeclaracaoIRSerializer(serializers.ModelSerializer):
    dependentes = DependenteSerializer(many=True, read_only=True)
    despesas_medicas = DespesaMedicaSerializer(many=True, read_only=True)
    capital_variavel = RendimentoCapitalVariavelSerializer(many=True, read_only=True)
    outras_deducoes = OutraDeducaoSerializer(many=True, read_only=True)
    modalidade_display = serializers.CharField(source="get_modalidade_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = DeclaracaoIR
        fields = [
            "id", "ano", "modalidade", "modalidade_display", "status", "status_display",
            "nome_titular", "cpf_titular", "nome_conjuge", "cpf_conjuge", "observacao",
            "dependentes", "despesas_medicas", "capital_variavel", "outras_deducoes",
        ]
        read_only_fields = ["id"]


class ResultadoCalculoSerializer(serializers.Serializer):
    modalidade = serializers.CharField()
    renda_bruta_tributavel = serializers.DecimalField(max_digits=14, decimal_places=2)
    total_deducoes = serializers.DecimalField(max_digits=14, decimal_places=2)
    base_calculo = serializers.DecimalField(max_digits=14, decimal_places=2)
    imposto_bruto = serializers.DecimalField(max_digits=14, decimal_places=2)
    irrf_a_creditar = serializers.DecimalField(max_digits=14, decimal_places=2)
    imposto_a_pagar_ou_restituir = serializers.DecimalField(max_digits=14, decimal_places=2)
    aliquota_efetiva = serializers.DecimalField(max_digits=6, decimal_places=2)
    deducao_dependentes = serializers.DecimalField(max_digits=14, decimal_places=2)
    deducao_saude = serializers.DecimalField(max_digits=14, decimal_places=2)
    deducao_educacao = serializers.DecimalField(max_digits=14, decimal_places=2)
    deducao_pgbl = serializers.DecimalField(max_digits=14, decimal_places=2)
    deducao_pensao = serializers.DecimalField(max_digits=14, decimal_places=2)
    deducao_outras = serializers.DecimalField(max_digits=14, decimal_places=2)
    rendimentos_trabalho = serializers.DecimalField(max_digits=14, decimal_places=2)
    rendimentos_capital_tributavel = serializers.DecimalField(max_digits=14, decimal_places=2)
    rendimentos_isentos = serializers.DecimalField(max_digits=14, decimal_places=2)
    irrf_trabalho = serializers.DecimalField(max_digits=14, decimal_places=2)
    irrf_capital = serializers.DecimalField(max_digits=14, decimal_places=2)
    avisos = serializers.ListField(child=serializers.CharField())


class ComparacaoModalidadesSerializer(serializers.Serializer):
    individual_titular = ResultadoCalculoSerializer()
    individual_conjuge = ResultadoCalculoSerializer(allow_null=True)
    conjunta = ResultadoCalculoSerializer()
    recomendacao = serializers.CharField()
    diferenca = serializers.DecimalField(max_digits=14, decimal_places=2)
