"""
Regra de ouro: a projeção nunca é editada à mão.

Ela é sempre um derivado do contrato. Mudou vigência, valor ou frequência, as
parcelas são recriadas. Isso elimina a classe de bug em que o contrato diz uma
coisa e a projeção diz outra.
"""

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.contratos.models import Contrato
from apps.contratos.services.projecao import gerar_parcelas


@receiver(post_save, sender=Contrato)
def regerar_projecao(sender, instance: Contrato, **kwargs):
    # on_commit: se a transação falhar, não regeramos projeção de um contrato
    # que nunca chegou a existir.
    transaction.on_commit(lambda: gerar_parcelas(instance))
