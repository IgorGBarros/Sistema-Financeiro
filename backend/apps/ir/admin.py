from django.contrib import admin

from .models import (
    DeclaracaoIR,
    Dependente,
    DespesaMedica,
    OutraDedução,
    RendimentoCapitalVariavel,
)


class DependenteInline(admin.TabularInline):
    model = Dependente
    extra = 0


class DespesaMedicaInline(admin.TabularInline):
    model = DespesaMedica
    extra = 0


class CapitalVariavelInline(admin.TabularInline):
    model = RendimentoCapitalVariavel
    extra = 0


class OutraDeducaoInline(admin.TabularInline):
    model = OutraDedução
    extra = 0


@admin.register(DeclaracaoIR)
class DeclaracaoIRAdmin(admin.ModelAdmin):
    list_display = ("ano", "modalidade", "status", "nome_titular", "workspace")
    list_filter = ("ano", "modalidade", "status")
    inlines = [DependenteInline, DespesaMedicaInline, CapitalVariavelInline, OutraDeducaoInline]
