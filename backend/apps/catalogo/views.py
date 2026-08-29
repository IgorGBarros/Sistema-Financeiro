from django.db.models import Count
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters

from apps.catalogo.models import Categoria, Classificacao, Estabelecimento
from apps.catalogo.serializers import (
    CategoriaSerializer, ClassificacaoSerializer, EstabelecimentoSerializer,
)
from apps.common.api import WorkspaceViewSet


class ClassificacaoViewSet(WorkspaceViewSet):
    queryset = Classificacao.objects.all()
    serializer_class = ClassificacaoSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["ativo"]
    search_fields = ["nome"]

    def get_queryset(self):
        # order_by explícito: a anotação monta um GROUP BY sem ordem garantida,
        # e a paginação passa a devolver resultados inconsistentes entre páginas.
        return (
            super()
            .get_queryset()
            .annotate(total_contratos=Count("contratos"))
            .order_by("ordem", "nome", "id")
        )


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
