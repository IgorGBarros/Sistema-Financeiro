"""Usuários e workspaces — a fronteira de isolamento dos dados."""

from django.conf import settings
from django.db import models

from apps.common.models import Base


class Workspace(Base):
    """
    Isola os dados por pessoa ou família. Todo queryset da API filtra por aqui,
    e o workspace vem sempre do request autenticado — nunca do payload.
    """

    nome = models.CharField(max_length=120)
    membros = models.ManyToManyField(
        settings.AUTH_USER_MODEL, related_name="workspaces", blank=True
    )

    class Meta:
        ordering = ["nome"]

    def __str__(self):
        return self.nome
