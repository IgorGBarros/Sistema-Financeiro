from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Count, Sum
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import (
    Categoria, Classificacao, ConsolidadoMercado, Contrato, Estabelecimento,
    NotaFiscal, ParcelaPrevista, Realizado, StatusNota,
)
from core.serializers import (
    CategoriaSerializer, ClassificacaoSerializer, ConsolidadoMercadoSerializer,
    ContratoSerializer, EstabelecimentoSerializer, FluxoMensalSerializer,
    NotaFiscalResumoSerializer, NotaFiscalSerializer, ParcelaPrevistaSerializer,
    RealizadoSerializer, ScanNotaSerializer, SimulacaoSerializer,
)
from core.services import fluxo_caixa
from core.services.consolidacao import consolidado_via_orm, resumo_mercado_do_mes
from core.services.sefaz_ba import importar_nota


def workspace_do_request(request):
    """
    Resolve o workspace ativo. O middleware de autenticação (Firebase ou JWT)
    coloca o usuário em request.user; o workspace vem do header ou do primeiro
    vínculo do usuário.
    """
    workspace_id = request.headers.get("X-Workspace")
    qs = request.user.workspaces.all()
    if workspace_id:
        return qs.filter(id=workspace_id).first()
    return qs.first()


class WorkspaceViewSet(viewsets.ModelViewSet):
    """Base que filtra tudo pelo workspace do usuário. Nunca confie no
    payload para definir o workspace — ele vem sempre do request."""
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        workspace = workspace_do_request(self.request)
        if workspace is None:
            return self.queryset.none()
        return self.queryset.filter(workspace=workspace)

    def perform_create(self, serializer):
        serializer.save(workspace=workspace_do_request(self.request))


class ClassificacaoViewSet(WorkspaceViewSet):
    queryset = Classificacao.objects.all()
    serializer_class = ClassificacaoSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["ativo"]
    search_fields = ["nome"]

    def get_queryset(self):
        return super().get_queryset().annotate(total_contratos=Count("contratos"))


class CategoriaViewSet(WorkspaceViewSet):
    queryset = Categoria.objects.select_related("classificacao")
    serializer_class = CategoriaSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["tipo", "classificacao", "ativo", "consolida_mercado"]
    search_fields = ["nome"]


class EstabelecimentoViewSet(WorkspaceViewSet):
    queryset = Estabelecimento.objects.all()
    serializer_class = EstabelecimentoSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    search_fields = ["nome", "cnpj"]


class ContratoViewSet(WorkspaceViewSet):
    """Tabela Entrada e Saída — os contratos previstos."""
    queryset = Contrato.objects.select_related(
        "estabelecimento", "categoria", "classificacao"
    )
    serializer_class = ContratoSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = [
        "tipo", "categoria", "classificacao", "status", "tipo_conta",
        "tipo_registro", "frequencia",
    ]
    search_fields = ["descricao", "estabelecimento__nome"]
    ordering_fields = ["data_inicio", "valor_unitario", "descricao"]

    def get_queryset(self):
        # O order_by explícito é necessário: a anotação com Count/Sum monta um
        # GROUP BY que o Django não garante ordenado, e a paginação do DRF
        # passa a devolver resultados inconsistentes entre páginas.
        return (
            super()
            .get_queryset()
            .annotate(
                parcelas_count=Count("parcelas", distinct=True),
                parcelas_total=Sum("parcelas__valor_previsto"),
            )
            .order_by("tipo", "descricao", "id")
        )

    @action(detail=True, methods=["get"])
    def parcelas(self, request, pk=None):
        """Projeção materializada do contrato."""
        contrato = self.get_object()
        parcelas = contrato.parcelas.all()
        return Response(ParcelaPrevistaSerializer(parcelas, many=True).data)

    @action(detail=True, methods=["post"])
    def rescindir(self, request, pk=None):
        """Rescinde o contrato numa data e recorta a projeção."""
        contrato = self.get_object()
        data_str = request.data.get("data_rescisao")
        if not data_str:
            return Response(
                {"data_rescisao": "Informe a data de rescisão."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        contrato.data_rescisao = date.fromisoformat(data_str)
        contrato.status = "RESCINDIDO"
        contrato.save()  # o signal regenera as parcelas
        return Response(self.get_serializer(contrato).data)

    @action(detail=False, methods=["post"])
    def simular(self, request):
        """Projeta sem gravar. Usado no formulário, antes de salvar."""
        serializer = SimulacaoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.projetar())


class RealizadoViewSet(WorkspaceViewSet):
    queryset = Realizado.objects.select_related("categoria", "contrato")
    serializer_class = RealizadoSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["tipo", "categoria", "contrato", "competencia", "origem"]
    search_fields = ["descricao"]
    ordering_fields = ["data_pagamento", "valor", "competencia"]

    @action(detail=False, methods=["post"], url_path="baixar-parcela")
    def baixar_parcela(self, request):
        """Marca uma parcela prevista como paga, criando o realizado."""
        parcela_id = request.data.get("parcela")
        parcela = ParcelaPrevista.objects.filter(
            id=parcela_id, contrato__workspace=workspace_do_request(request)
        ).select_related("contrato").first()
        if parcela is None:
            return Response(
                {"parcela": "Parcela não encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        contrato = parcela.contrato
        realizado = Realizado.objects.create(
            workspace=contrato.workspace,
            contrato=contrato,
            parcela=parcela,
            categoria=contrato.categoria,
            descricao=contrato.descricao,
            tipo=contrato.tipo,
            competencia=parcela.competencia,
            data_pagamento=date.fromisoformat(
                request.data.get("data_pagamento", date.today().isoformat())
            ),
            valor=Decimal(str(request.data.get("valor", parcela.valor_previsto))),
            forma_pagamento=request.data.get("forma_pagamento", ""),
        )
        return Response(
            RealizadoSerializer(realizado).data, status=status.HTTP_201_CREATED
        )


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
        from django.db import DatabaseError

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
        return Response(resumo_mercado_do_mes(workspace, date.today().replace(day=1)))


class FluxoCaixaView(APIView):
    """
    Série mensal previsto x realizado, com saldo acumulado.
    O período pode ir para o futuro — é aí que a projeção aparece.

    GET /api/fluxo-caixa/?inicio=2026-01-01&fim=2027-12-01
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        workspace = workspace_do_request(request)
        hoje = date.today()
        inicio = date.fromisoformat(
            request.query_params.get("inicio", hoje.replace(day=1).isoformat())
        )
        fim = date.fromisoformat(
            request.query_params.get("fim", (hoje + timedelta(days=365)).isoformat())
        )
        saldo_inicial = Decimal(request.query_params.get("saldo_inicial", "0"))

        linhas = fluxo_caixa.fluxo_mensal(
            workspace, inicio=inicio, fim=fim, saldo_inicial=saldo_inicial
        )
        return Response({
            "inicio": inicio,
            "fim": fim,
            "linhas": FluxoMensalSerializer(linhas, many=True).data,
            "totais": {
                "receita_prevista": sum(l["receita_prevista"] for l in linhas),
                "despesa_prevista": sum(l["despesa_prevista"] for l in linhas),
                "saldo_final": linhas[-1]["saldo_acumulado"] if linhas else Decimal("0"),
            },
        })


class AderenciaView(APIView):
    """Previsto x realizado contrato a contrato num mês."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        workspace = workspace_do_request(request)
        competencia = date.fromisoformat(
            request.query_params.get(
                "competencia", date.today().replace(day=1).isoformat()
            )
        )
        return Response({
            "competencia": competencia,
            "linhas": fluxo_caixa.aderencia_por_contrato(
                workspace, competencia=competencia
            ),
        })


class ResumoClassificacaoView(APIView):
    """Peso de cada classificação nas despesas do período."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        workspace = workspace_do_request(request)
        hoje = date.today()
        inicio = date.fromisoformat(
            request.query_params.get("inicio", hoje.replace(month=1, day=1).isoformat())
        )
        fim = date.fromisoformat(
            request.query_params.get("fim", hoje.replace(month=12, day=1).isoformat())
        )
        return Response(
            fluxo_caixa.resumo_por_classificacao(workspace, inicio=inicio, fim=fim)
        )
