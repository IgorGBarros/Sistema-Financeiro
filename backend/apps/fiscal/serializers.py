from rest_framework import serializers

from apps.catalogo.models import Categoria
from apps.cartoes.models import Cartao
from apps.fiscal.models import (
    ConsolidadoMercado, FormaPagamento, ItemNotaFiscal, NotaFiscal, PagamentoNota,
)
from apps.fiscal.services.nfce_qrcode import QRCodeInvalido, parse_qrcode


class ItemNotaFiscalSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItemNotaFiscal
        fields = [
            "id", "numero_item", "codigo", "descricao", "quantidade", "unidade",
            "valor_unitario", "valor_total", "categoria",
        ]


class PagamentoNotaSerializer(serializers.ModelSerializer):
    cartao_apelido = serializers.CharField(
        source="cartao.apelido", read_only=True, default=None
    )

    class Meta:
        model = PagamentoNota
        fields = [
            "id", "forma", "valor", "cartao", "cartao_apelido", "parcelas",
            "bandeira", "autorizacao", "confirmado",
        ]
        read_only_fields = fields


class RegistrarPagamentoSerializer(serializers.Serializer):
    """
    Entrada da tela de confirmação do scan.

    `forma` vem sugerida pela nota; `cartao` e `parcelas` o usuário informa —
    a NFC-e não traz parcelamento.
    """

    forma = serializers.ChoiceField(choices=FormaPagamento.choices)
    valor = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )
    cartao = serializers.PrimaryKeyRelatedField(
        queryset=Cartao.objects.all(), required=False, allow_null=True
    )
    parcelas = serializers.IntegerField(min_value=1, max_value=36, default=1)
    categoria = serializers.PrimaryKeyRelatedField(
        queryset=Categoria.objects.all(), required=False, allow_null=True
    )
    autorizacao = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs["forma"] == FormaPagamento.CREDITO and not attrs.get("cartao"):
            raise serializers.ValidationError(
                {"cartao": "Pagamento no crédito precisa de um cartão."}
            )
        if attrs["forma"] != FormaPagamento.CREDITO and attrs.get("parcelas", 1) > 1:
            raise serializers.ValidationError(
                {"parcelas": "Só pagamento no crédito pode ser parcelado."}
            )
        return attrs


class NotaFiscalSerializer(serializers.ModelSerializer):
    itens = ItemNotaFiscalSerializer(many=True, read_only=True)
    pagamentos = PagamentoNotaSerializer(many=True, read_only=True)
    competencia = serializers.DateField(read_only=True)

    class Meta:
        model = NotaFiscal
        fields = [
            "id", "chave_acesso", "uf", "modelo", "serie", "numero",
            "cnpj_emitente", "nome_emitente", "municipio", "data_emissao",
            "competencia", "valor_total", "valor_desconto", "valor_tributos",
            "quantidade_itens", "forma_pagamento", "protocolo", "categoria",
            "status", "erro_consulta", "qr_url", "itens", "pagamentos",
            "criado_em",
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
