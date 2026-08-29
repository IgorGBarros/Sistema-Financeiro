"""
Histórico de conversas com o assistente.

Guardar serve a três propósitos concretos: continuar a conversa entre
requisições, auditar de onde saiu cada número que o assistente afirmou, e
medir quais perguntas as pessoas realmente fazem (o que orienta quais
ferramentas construir em seguida).
"""

from django.conf import settings
from django.db import models

from apps.common.models import Base, EscopoWorkspace


class Conversa(EscopoWorkspace):
    titulo = models.CharField(max_length=160, blank=True)
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        ordering = ["-atualizado_em"]
        indexes = [models.Index(fields=["workspace", "-atualizado_em"])]

    def __str__(self):
        return self.titulo or f"Conversa {self.id}"


class Mensagem(Base):
    PAPEL = [("user", "Pessoa"), ("assistant", "Assistente")]

    conversa = models.ForeignKey(Conversa, on_delete=models.CASCADE, related_name="mensagens")
    papel = models.CharField(max_length=10, choices=PAPEL)
    texto = models.TextField()
    # Quais ferramentas produziram este texto — é a procedência do número.
    ferramentas_usadas = models.JSONField(default=list, blank=True)
    # Blocos crus da API, para retomar a conversa com o contexto completo.
    blocos = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["criado_em"]

    def __str__(self):
        return f"{self.papel}: {self.texto[:60]}"
