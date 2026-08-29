from rest_framework import serializers

from apps.catalogo.models import Categoria, Classificacao, Estabelecimento


class ClassificacaoSerializer(serializers.ModelSerializer):
    total_contratos = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = Classificacao
        fields = [
            "id", "nome", "descricao", "peso", "cor", "ordem", "ativo",
            "total_contratos",
        ]


class CategoriaSerializer(serializers.ModelSerializer):
    classificacao_nome = serializers.CharField(
        source="classificacao.nome", read_only=True
    )

    class Meta:
        model = Categoria
        fields = [
            "id", "nome", "tipo", "classificacao", "classificacao_nome",
            "consolida_mercado", "ativo",
        ]


class EstabelecimentoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Estabelecimento
        fields = ["id", "codigo", "nome", "cnpj", "categoria_padrao"]
