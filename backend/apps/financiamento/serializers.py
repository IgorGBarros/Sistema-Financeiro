from rest_framework import serializers

from apps.financiamento.models import Financiamento, ParcelaFinanciamento


class ParcelaFinanciamentoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ParcelaFinanciamento
        fields = [
            "id", "numero", "competencia", "vencimento", "valor_total",
            "situacao", "amortizacao", "juros", "seguro_mip", "seguro_dfi",
            "taxa_administracao", "encargos", "saldo_devedor",
        ]
        read_only_fields = fields


class FinanciamentoSerializer(serializers.ModelSerializer):
    """
    Os campos calculados vêm de anotações do queryset, não de consultas por
    linha.

    A versão anterior fazia seis consultas por financiamento e carregava as
    296 parcelas na memória só para somá-las. Com 246 parcelas em aberto e
    poucos contratos ainda dava para viver com isso, mas o custo cresce com o
    número de financiamentos e o trabalho é todo desperdiçado: o banco soma
    melhor. Ver FinanciamentoViewSet.get_queryset.
    """

    parcelas_pagas = serializers.IntegerField(read_only=True)
    parcelas_restantes = serializers.IntegerField(read_only=True)
    total_a_pagar = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True
    )
    juros_a_pagar = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True
    )
    saldo_devedor_atual = serializers.SerializerMethodField()
    proxima_parcela = serializers.SerializerMethodField()

    class Meta:
        model = Financiamento
        fields = [
            "id", "numero_contrato", "instituicao", "titular",
            "paga_do_proprio_bolso", "categoria", "sistema_amortizacao",
            "prazo_total", "taxa_juros_anual", "data_ultima_parcela",
            "parcelas_pagas", "parcelas_restantes", "saldo_devedor_atual",
            "total_a_pagar", "juros_a_pagar", "proxima_parcela",
            "atualizado_pelo_documento_em",
        ]
        read_only_fields = ["atualizado_pelo_documento_em"]

    def get_saldo_devedor_atual(self, obj):
        """
        Saldo depois da última parcela paga.

        Vem de `_ultima_paga`, preenchido pelo Prefetch do viewset — sem ele
        seria mais uma consulta por linha.
        """
        pagas = getattr(obj, "_ultima_paga", None)
        return str(pagas[0].saldo_devedor) if pagas else None

    def get_proxima_parcela(self, obj):
        proximas = getattr(obj, "_proxima", None)
        return (
            ParcelaFinanciamentoSerializer(proximas[0]).data if proximas else None
        )
