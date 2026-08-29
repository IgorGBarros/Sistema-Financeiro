"""
Paginação padrão.

Mora em módulo próprio de propósito. O DRF resolve DEFAULT_PAGINATION_CLASS no
momento em que `rest_framework.viewsets` é importado; se a classe estivesse em
apps/common/api.py — que importa viewsets — teríamos import circular e um erro
enganoso ("módulo não define PaginacaoPadrao", quando na verdade define).
Manter aqui garante que este módulo só dependa de rest_framework.pagination.
"""

from rest_framework.pagination import PageNumberPagination


class PaginacaoPadrao(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200
