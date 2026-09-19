"""
Datas do sistema.

Por que não usar `date.today()`
-------------------------------
`date.today()` devolve a data do relógio do servidor. Em produção o servidor
roda em UTC, e Salvador está três horas atrás — então das 21h à meia-noite,
horário local, o servidor já está no dia seguinte.

O efeito num sistema financeiro é concreto: um cupom escaneado às 22h do dia
31 de março entraria na competência de **abril**. A fatura do cartão iria para
o mês errado, e a conciliação nunca casaria.

`timezone.localdate()` converte para o TIME_ZONE do projeto (America/Bahia)
antes de extrair a data. É o único jeito correto de perguntar "que dia é hoje"
com USE_TZ ligado.
"""

from datetime import date

from django.utils import timezone


def hoje_local() -> date:
    """Data de hoje no fuso do projeto, não no do servidor."""
    return timezone.localdate()


def competencia_atual() -> date:
    """Primeiro dia do mês corrente, no fuso do projeto."""
    return timezone.localdate().replace(day=1)
