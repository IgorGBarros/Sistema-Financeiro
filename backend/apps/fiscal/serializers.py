from rest_framework import serializers

from apps.catalogo.models import Categoria
from apps.fiscal.models import ConsolidadoMercado, ItemNotaFiscal, NotaFiscal
from apps.fiscal.services.nfce_qrcode import QRCodeInvalido, parse_qrcode


class ItemNotaFiscalSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItemNotaFiscal
        fields = [
            "id", "numero_item", "codigo", "descricao", "quantidade", "unidade",
            "valor_unitario", "valor_total", "categoria",
        ]


class NotaFiscalSerializer(serializers.ModelSerializer):
    itens = ItemNotaFiscalSerializer(many=True, read_only=True)
    competencia = serializers.DateField(read_only=True)

    class Meta:
        model = NotaFiscal
        fields = [
            "id", "chave_acesso", "uf", "modelo", "serie", "numero",
            "cnpj_emitente", "nome_emitente", "municipio", "data_emissao",
            "competencia", "valor_total", "valor_desconto", "valor_tributos",
            "quantidade_itens", "forma_pagamento", "protocolo", "categoria",
            "status", "erro_consulta", "qr_url", "itens", "criado_em",
        ]
        read_only_fields = fields


class NotaFiscalResumoSerializer(NotaFiscalSerializer):
    """Versão sem itens, para listagem."""
    class Meta(NotaFiscalSerializer.Meta):
        fields = [f for f in NotaFiscalSerializer.Meta.fields if f != "itens"]
        read_only_fields = fields


class ScanNotaSerializer(serializers.Serializer):
    """Entrada do scanner. Aceita a URL do QR, o parâmetro p ou a chave."""
    conteudo = serializers.CharField(
        help_text="Conteúdo lido do QR Code ou chave de acesso de 44 dígitos."
    )
    categoria = serializers.PrimaryKeyRelatedField(
        queryset=Categoria.objects.all(), required=False, allow_null=True
    )

    def validate_conteudo(self, valor):
        try:
            qr = parse_qrcode(valor)
        except QRCodeInvalido as exc:
            raise serializers.ValidationError(str(exc)) from exc
        if qr.chave.modelo not in ("55", "65"):
            raise serializers.ValidationError(
                f"Modelo {qr.chave.modelo} não é NF-e nem NFC-e."
            )
        self.context["qr"] = qr
        return valor


class ConsolidadoMercadoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConsolidadoMercado
        fields = [
            "competencia", "quantidade_notas", "quantidade_itens",
            "valor_total", "ticket_medio",
        ]
