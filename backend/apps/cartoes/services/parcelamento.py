"""Materialização das parcelas de uma compra."""

from apps.cartoes.services.ciclo import projetar_parcelas


def gerar_parcelas(compra) -> int:
    """
    Regera ParcelaCompra. Idempotente: apaga e recria.

    Parcela já conciliada com a fatura é preservada — apagá-la desfaria um
    trabalho de revisão que a pessoa já fez.
    """
    from apps.cartoes.models import ParcelaCompra

    conciliadas = {
        p.numero: p
        for p in compra.parcelas.filter(conciliada_em__isnull=False)
    }
    compra.parcelas.filter(conciliada_em__isnull=True).delete()

    projecao = projetar_parcelas(
        data_compra=compra.data_compra,
        valor_total=compra.valor_total,
        quantidade=compra.parcelas_total,
        dia_fechamento=compra.cartao.dia_fechamento,
    )

    novas = [
        ParcelaCompra(compra=compra, numero=numero, competencia=competencia, valor=valor)
        for numero, competencia, valor in projecao
        if numero not in conciliadas
    ]
    ParcelaCompra.objects.bulk_create(novas, batch_size=500)
    return len(novas)
