from rest_framework import serializers

from apps.cartoes.models import Cartao, Compra, Fatura, LancamentoFatura, ParcelaCompra


class CartaoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cartao
        fields = [
            "id", "apelido", "bandeira", "ultimos_digitos", "emissor", "limite",
            "dia_fechamento", "dia_vencimento", "cartao_titular", "ativo",
        ]


class ParcelaCompraSerializer(serializers.ModelSerializer):
    class Meta:
        model = ParcelaCompra
        fields = ["id", "numero", "competencia", "valor", "conciliada_em"]
        read_only_fields = fields


class CompraSerializer(serializers.ModelSerializer):
    parcelas = ParcelaCompraSerializer(many=True, read_only=True)
    estabelecimento_nome = serializers.CharField(source="estabelecimento.nome", read_only=True)
    categoria_nome = serializers.CharField(source="categoria.nome", read_only=True)
    cartao_apelido = serializers.CharField(source="cartao.apelido", read_only=True)

    class Meta:
        model = Compra
        fields = [
            "id", "nota", "cartao", "cartao_apelido", "estabelecimento",
            "estabelecimento_nome", "categoria", "categoria_nome", "descricao",
            "data_compra", "valor_total", "parcelas_total", "parcelas", "observacao",
        ]


class LancamentoFaturaSerializer(serializers.ModelSerializer):
    estabelecimento_nome = serializers.CharField(
        source="estabelecimento.nome", read_only=True, default=None
    )
    conciliado = serializers.SerializerMethodField()

    class Meta:
        model = LancamentoFatura
        fields = [
            "id", "descricao", "descricao_original", "data_compra", "valor",
            "parcela_atual", "parcela_total", "secao", "conciliado",
            "metodo_conciliacao", "estabelecimento", "estabelecimento_nome", "categoria",
        ]
        read_only_fields = fields

    def get_conciliado(self, obj) -> bool:
        return obj.parcela_compra_id is not None


class FaturaSerializer(serializers.ModelSerializer):
    lancamentos = LancamentoFaturaSerializer(many=True, read_only=True)
    cartao_apelido = serializers.CharField(source="cartao.apelido", read_only=True)

    class Meta:
        model = Fatura
        fields = [
            "id", "cartao", "cartao_apelido", "competencia", "data_vencimento",
            "valor_total_informado", "status", "lancamentos", "documento",
        ]
        read_only_fields = fields
