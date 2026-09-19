
from django.db import DatabaseError
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.common.api import WorkspaceViewSet, workspace_do_request
from apps.fiscal.models import ConsolidadoMercado, NotaFiscal, StatusNota
from apps.fiscal.serializers import (
    ConsolidadoMercadoSerializer, NotaFiscalResumoSerializer,
    NotaFiscalSerializer, RegistrarPagamentoSerializer, ScanNotaSerializer,
)
from apps.fiscal.services.consolidacao import consolidado_via_orm, resumo_mercado_do_mes
from apps.fiscal.services.sefaz_ba import importar_nota

from apps.common.datas import hoje_local



class NotaFiscalViewSet(WorkspaceViewSet):
    """Tabela Mercado."""
    queryset = NotaFiscal.objects.prefetch_related("itens")
    serializer_class = NotaFiscalSerializer
    # POST precisa estar liberado por causa das actions /scan/ e /reconsultar/.
    # A criação direta continua bloqueada pelo create() abaixo: nota só nasce
    # de um cupom lido, nunca de um payload arbitrário.
    http_method_names = ["get", "post", "delete", "head", "options"]

    def create(self, request, *args, **kwargs):
        return Response(
            {"detail": "Notas são cadastradas pela leitura do cupom, em /notas/scan/."},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status", "categoria", "cnpj_emitente"]
    search_fields = ["nome_emitente", "chave_acesso"]
    ordering_fields = ["data_emissao", "valor_total"]

    def get_serializer_class(self):
        if self.action == "list":
            return NotaFiscalResumoSerializer
        return NotaFiscalSerializer

    @action(detail=False, methods=["post"])
    def scan(self, request):
        """
        Recebe o conteúdo do QR Code lido no celular, consulta a SEFAZ-BA e
        cadastra a nota com os itens.

        Idempotente: reenviar a mesma chave devolve 200 com a nota já existente.
        """
        serializer = ScanNotaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        workspace = workspace_do_request(request)
        if workspace is None:
            return Response(
                {"detail": "Usuário sem workspace ativo."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        nota, criada = importar_nota(
            workspace=workspace,
            conteudo_qr=serializer.validated_data["conteudo"],
            usuario=request.user,
            categoria=serializer.validated_data.get("categoria"),
        )

        codigo = status.HTTP_201_CREATED if criada else status.HTTP_200_OK
        corpo = NotaFiscalSerializer(nota).data
        if nota.status == StatusNota.ERRO:
            corpo["detail"] = (
                "A nota foi cadastrada pela chave, mas a SEFAZ não respondeu. "
                "Os itens podem ser buscados novamente em /reconsultar."
            )
        return Response(corpo, status=codigo)

    @action(detail=True, methods=["post"])
    def reconsultar(self, request, pk=None):
        """Tenta de novo uma nota que ficou com status ERRO."""
        nota = self.get_object()
        conteudo = nota.qr_url or nota.chave_acesso
        nota_atualizada, _ = importar_nota(
            workspace=nota.workspace, conteudo_qr=conteudo, usuario=request.user
        )
        return Response(NotaFiscalSerializer(nota_atualizada).data)

    @action(detail=False, methods=["get"])
    def consolidado(self, request):
        """
        Tabela Consolidado: somatório da Tabela Mercado por mês.

        Lê da materialized view quando ela existe (Postgres). Em SQLite, ou se
        a view ainda não foi criada, cai no agregado via ORM — mesmo resultado,
        só mais lento. Isso evita que o endpoint quebre em desenvolvimento.
        """

        workspace = workspace_do_request(request)
        inicio = request.query_params.get("inicio")
        fim = request.query_params.get("fim")

        try:
            registros = ConsolidadoMercado.objects.filter(workspace=workspace)
            if inicio:
                registros = registros.filter(competencia__gte=inicio)
            if fim:
                registros = registros.filter(competencia__lte=fim)
            return Response(ConsolidadoMercadoSerializer(registros, many=True).data)
        except DatabaseError:
            return Response(
                consolidado_via_orm(workspace, inicio=inicio, fim=fim)
            )

    @action(detail=False, methods=["get"], url_path="mes-corrente")
    def mes_corrente(self, request):
        """Total do mês atual em tempo real, sem depender do refresh da view."""
        workspace = workspace_do_request(request)
        return Response(resumo_mercado_do_mes(workspace, hoje_local().replace(day=1)))

    @action(detail=True, methods=["get", "post"])
    def pagamento(self, request, pk=None):
        """
        Como a nota foi paga.

        GET  devolve a sugestão: forma vinda da nota, cartão e parcelamento
             vindos do histórico do estabelecimento.
        POST registra e gera o lançamento — Realizado à vista, Compra com
             parcelas no crédito.
        """
        from apps.fiscal.services.pagamento import registrar_pagamento, sugerir_pagamento

        nota = self.get_object()

        if request.method == "GET":
            return Response(sugerir_pagamento(nota))

        serializer = RegistrarPagamentoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        dados = serializer.validated_data

        try:
            resultado = registrar_pagamento(
                nota=nota,
                forma=dados["forma"],
                valor=dados.get("valor"),
                cartao=dados.get("cartao"),
                parcelas=dados.get("parcelas", 1),
                categoria=dados.get("categoria"),
                autorizacao=dados.get("autorizacao", ""),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            "nota": str(nota.id),
            "forma": dados["forma"],
            "compra": str(resultado["compra"].id) if resultado["compra"] else None,
            "parcelas_geradas": (
                resultado["compra"].parcelas.count() if resultado["compra"] else 0
            ),
            "realizado": (
                str(resultado["realizado"].id) if resultado["realizado"] else None
            ),
        })

    @action(detail=False, methods=["get"], url_path="sem-pagamento")
    def sem_pagamento(self, request):
        """
        Notas lidas sem forma de pagamento informada.

        O scan é rápido de propósito — a pessoa está no caixa. Esta fila é a
        consequência, e precisa ser visível: sem isso as notas se acumulam
        fora do fluxo de caixa sem ninguém notar.
        """
        from apps.fiscal.services.pagamento import notas_sem_pagamento

        pendentes = notas_sem_pagamento(workspace_do_request(request))
        return Response({
            "total": pendentes.count(),
            "valor_total": str(
                sum((n.valor_total for n in pendentes), __import__("decimal").Decimal("0"))
            ),
            "notas": NotaFiscalResumoSerializer(pendentes[:100], many=True).data,
        })
