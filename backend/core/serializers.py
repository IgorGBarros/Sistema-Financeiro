from decimal import Decimal

from rest_framework import serializers

from core.models import (
    Categoria, Classificacao, ConsolidadoMercado, Contrato, Estabelecimento,
    ItemNotaFiscal, NotaFiscal, ParcelaPrevista, Realizado, TipoLancamento,
)
from core.services.nfce_qrcode import QRCodeInvalido, parse_qrcode
from core.services.projecao import projetar


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


class ConsolidadoMercadoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConsolidadoMercado
        fields = [
            "competencia", "quantidade_notas", "quantidade_itens",
            "valor_total", "ticket_medio",
        ]


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
