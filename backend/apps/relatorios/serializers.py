from rest_framework import serializers


class FluxoMensalSerializer(serializers.Serializer):
    competencia = serializers.DateField()
    receita_prevista = serializers.DecimalField(max_digits=14, decimal_places=2)
    despesa_prevista = serializers.DecimalField(max_digits=14, decimal_places=2)
    resultado_previsto = serializers.DecimalField(max_digits=14, decimal_places=2)
    receita_realizada = serializers.DecimalField(max_digits=14, decimal_places=2)
    despesa_realizada = serializers.DecimalField(max_digits=14, decimal_places=2)
    resultado_realizado = serializers.DecimalField(max_digits=14, decimal_places=2)
    desvio_receita = serializers.DecimalField(max_digits=14, decimal_places=2)
    desvio_despesa = serializers.DecimalField(max_digits=14, decimal_places=2)
    saldo_acumulado = serializers.DecimalField(max_digits=14, decimal_places=2)
    projetado = serializers.BooleanField()
