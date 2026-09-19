"""A projeção de parcelas é sempre derivada da compra, nunca editada à mão."""

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.cartoes.models import Compra
from apps.cartoes.services.parcelamento import gerar_parcelas


@receiver(post_save, sender=Compra)
def regerar_parcelas(sender, instance: Compra, **kwargs):
    transaction.on_commit(lambda: gerar_parcelas(instance))
