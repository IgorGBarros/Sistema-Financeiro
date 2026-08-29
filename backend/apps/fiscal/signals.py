"""Mantém o consolidado do mês em dia conforme cupons entram e saem."""

import logging

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.fiscal.models import NotaFiscal, StatusNota
from apps.fiscal.services.consolidacao import sincronizar_mercado_do_mes

logger = logging.getLogger(__name__)


def _resincronizar(instance: NotaFiscal):
    if not instance.competencia:
        return
    competencia, workspace = instance.competencia, instance.workspace
    transaction.on_commit(lambda: sincronizar_mercado_do_mes(workspace, competencia))


@receiver(post_save, sender=NotaFiscal)
def atualizar_consolidado(sender, instance: NotaFiscal, **kwargs):
    if instance.status != StatusNota.IMPORTADA:
        return
    _resincronizar(instance)


@receiver(post_delete, sender=NotaFiscal)
def recalcular_apos_exclusao(sender, instance: NotaFiscal, **kwargs):
    _resincronizar(instance)
