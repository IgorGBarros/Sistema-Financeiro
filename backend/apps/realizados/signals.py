"""
Amarra o realizado à parcela prevista da mesma competência.

Sem isso, o comparativo previsto x realizado só funcionaria para quem baixou a
parcela pela tela, e lançamentos criados por importação ficariam órfãos.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.realizados.models import Realizado


@receiver(post_save, sender=Realizado)
def vincular_parcela(sender, instance: Realizado, created, **kwargs):
    if instance.parcela_id or not instance.contrato_id:
        return

    from apps.contratos.models import ParcelaPrevista

    parcela = ParcelaPrevista.objects.filter(
        contrato_id=instance.contrato_id, competencia=instance.competencia
    ).first()
    if parcela and not hasattr(parcela, "realizado"):
        # update() em vez de save(): evita recursão neste mesmo signal.
        Realizado.objects.filter(pk=instance.pk).update(parcela=parcela)
