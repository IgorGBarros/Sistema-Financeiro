"""
Efeitos automáticos.

Regra de ouro: a projeção nunca é editada à mão. Ela é sempre um derivado do
contrato. Mudou a vigência, o valor ou a frequência → as parcelas são
recriadas. Isso evita a classe de bug em que o contrato diz uma coisa e a
projeção diz outra.
"""

import logging

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from core.models import Contrato, NotaFiscal, Realizado, StatusNota
from core.services.consolidacao import sincronizar_mercado_do_mes
from core.services.projecao import gerar_parcelas

logger = logging.getLogger(__name__)

CAMPOS_QUE_AFETAM_PROJECAO = {
    "data_inicio", "data_fim", "data_rescisao", "valor_unitario",
    "frequencia", "reajuste_anual_pct", "status",
}


@receiver(post_save, sender=Contrato)
def regerar_projecao(sender, instance: Contrato, **kwargs):
    transaction.on_commit(lambda: gerar_parcelas(instance))


@receiver(post_save, sender=NotaFiscal)
def atualizar_consolidado(sender, instance: NotaFiscal, **kwargs):
    if instance.status != StatusNota.IMPORTADA or not instance.competencia:
        return
    competencia = instance.competencia
    workspace = instance.workspace
    transaction.on_commit(
        lambda: sincronizar_mercado_do_mes(workspace, competencia)
    )


@receiver(post_delete, sender=NotaFiscal)
def recalcular_apos_exclusao(sender, instance: NotaFiscal, **kwargs):
    if not instance.competencia:
        return
    competencia = instance.competencia
    workspace = instance.workspace
    transaction.on_commit(
        lambda: sincronizar_mercado_do_mes(workspace, competencia)
    )


@receiver(post_save, sender=Realizado)
def vincular_parcela(sender, instance: Realizado, created, **kwargs):
    """
    Amarra o realizado à parcela prevista da mesma competência quando o
    lançamento veio sem vínculo. Sem isso, o comparativo por contrato só
    funciona para quem baixou a parcela manualmente.
    """
    if instance.parcela_id or not instance.contrato_id:
        return
    from core.models import ParcelaPrevista

    parcela = ParcelaPrevista.objects.filter(
        contrato_id=instance.contrato_id, competencia=instance.competencia
    ).first()
    if parcela and not hasattr(parcela, "realizado"):
        Realizado.objects.filter(pk=instance.pk).update(parcela=parcela)
