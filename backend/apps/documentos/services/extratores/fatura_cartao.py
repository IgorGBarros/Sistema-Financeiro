"""
Fatura de cartão de crédito.

ATENÇÃO — NÃO TESTADO CONTRA PDF REAL
--------------------------------------
Este extrator foi escrito a partir da lógica do seu `processar_faturas.py`,
sem acesso a uma fatura de verdade. O formato de linha e os marcadores de
seção quase certamente precisam de ajuste no primeiro uso real.

Rode `python manage.py importar_documento fatura.pdf --senha 03221 --simular`
para ver o que sai antes de gravar qualquer coisa.

O que foi preservado do seu script
----------------------------------
- linha de lançamento: `DD/MM  DESCRIÇÃO  1.234,56`
- valor negativo quando a descrição menciona estorno
- separação entre a fatura corrente e as compras parceladas futuras

O que mudou, e por quê
----------------------
**A separação por "ANUIDADE seguida de ESTORNO" foi trocada.** No seu script,
o início das compras parceladas é detectado por essas duas linhas em sequência.
Isso funciona na fatura que você tem em mãos, mas quebra em qualquer mês sem
anuidade ou sem estorno — e quando quebra, todas as parcelas futuras entram na
fatura corrente e o mês fica com o dobro da despesa.

Aqui a detecção é por cabeçalho de seção (`PRÓXIMAS FATURAS`, `COMPRAS
PARCELADAS`, `LANÇAMENTOS FUTUROS`), com a regra da anuidade como reserva. Se
nenhuma das duas funcionar, o extrator avisa em vez de adivinhar.

**O parcelamento passa a ser lido.** Descrições como `NETSHOES 03/10` viram
`parcela_atual=3, parcela_total=10`. Seu `validar_fluxo_caixa.py` detectava
`\\d+/\\d+` para classificar, mas descartava os números — e são eles que
permitem casar a linha com a parcela prevista da compra.

**A classificação por palavra-chave saiu.** Ela vive agora no plano de contas:
o estabelecimento tem `categoria_padrao`, e os apelidos aprendem com o que
você corrige. Manter uma lista de palavras no extrator significaria duas
fontes de verdade sobre a mesma decisão.
"""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal

from apps.documentos.services.base import (
    Extracao,
    Extrator,
    LinhaExtraida,
    competencia_de,
    para_data,
    para_decimal,
    registrar,
)

# DD/MM  descrição  1.234,56   (com "-" opcional antes do valor)
LINHA_LANCAMENTO = re.compile(
    r"^(\d{2}/\d{2})\s+(.+?)\s+(-?\s*[\d.]{0,12}\d,\d{2})-?$"
)

# "03/10", "3/10", "PARC 03/10", "PARCELA 3 DE 10"
PARCELAMENTO = re.compile(
    r"(?:PARC(?:ELA)?\.?\s*)?(\d{1,2})\s*(?:/|\s+DE\s+)\s*(\d{1,2})\b",
    re.IGNORECASE,
)

CABECALHOS_FUTURO = (
    "PRÓXIMAS FATURAS", "PROXIMAS FATURAS", "COMPRAS PARCELADAS",
    "LANÇAMENTOS FUTUROS", "LANCAMENTOS FUTUROS", "PARCELAS A VENCER",
    "GASTOS PARCELADOS",
)

ESTORNO = ("ESTORNO", "CRÉDITO", "CREDITO", "DEVOLUÇÃO", "DEVOLUCAO", "PAGAMENTO EFETUADO")


def reconhece(texto: str) -> bool:
    alto = texto.upper()
    marcas = ("FATURA", "CARTÃO", "CARTAO", "LIMITE", "VENCIMENTO", "TOTAL DA FATURA")
    return sum(m in alto for m in marcas) >= 3


def _extrair_parcelamento(descricao: str) -> tuple[int | None, int | None, str]:
    """Devolve (parcela_atual, parcela_total, descrição sem o parcelamento)."""
    achado = PARCELAMENTO.search(descricao)
    if not achado:
        return None, None, descricao

    atual, total = int(achado.group(1)), int(achado.group(2))
    # "12/24" pode ser data, não parcela. Parcela total acima de 24 é rara e
    # atual nunca passa do total.
    if total > 36 or atual > total or total < 2:
        return None, None, descricao

    limpa = PARCELAMENTO.sub("", descricao).strip(" -")
    return atual, total, limpa or descricao


def _data_do_lancamento(dia_mes: str, vencimento: date | None) -> date | None:
    """
    A linha traz só DD/MM. O ano vem do vencimento da fatura.

    Cuidado com a virada: compra de 28/12 numa fatura que vence em 10/01 é do
    ano anterior. Sem esse ajuste, a compra iria para o futuro.
    """
    if vencimento is None:
        return None
    try:
        dia, mes = (int(p) for p in dia_mes.split("/"))
    except ValueError:
        return None

    ano = vencimento.year
    if mes > vencimento.month:
        ano -= 1
    try:
        return date(ano, mes, dia)
    except ValueError:
        return None


def extrair(texto: str) -> Extracao:
    linhas_texto = texto.split("\n")

    achado_venc = re.search(
        r"Vencimento[:\s]*(\d{2}/\d{2}/\d{4})", texto, re.IGNORECASE
    )
    vencimento = para_data(achado_venc.group(1)) if achado_venc else None

    achado_total = re.search(
        r"(?:Total da fatura|Valor total|Total a pagar)[^\d]{0,30}([\d.]+,\d{2})",
        texto,
        re.IGNORECASE,
    )
    total_informado = para_decimal(achado_total.group(1)) if achado_total else None

    # Onde começam as parcelas de faturas futuras.
    indice_futuro = None
    for indice, bruta in enumerate(linhas_texto):
        if any(c in bruta.upper() for c in CABECALHOS_FUTURO):
            indice_futuro = indice
            break

    if indice_futuro is None:
        # Reserva: a regra do seu script original.
        for indice in range(len(linhas_texto) - 1):
            if (
                "ANUIDADE" in linhas_texto[indice].upper()
                and "ESTORNO" in linhas_texto[indice + 1].upper()
            ):
                indice_futuro = indice + 2
                break

    linhas: list[LinhaExtraida] = []
    for indice, bruta in enumerate(linhas_texto):
        achado = LINHA_LANCAMENTO.match(bruta.strip())
        if not achado:
            continue

        dia_mes, descricao, valor_texto = achado.groups()
        descricao = descricao.strip()
        valor = para_decimal(valor_texto)

        # Estorno é entrada, não saída: o valor precisa ser negativo para a
        # soma da fatura fechar.
        if any(marca in descricao.upper() for marca in ESTORNO) and valor > 0:
            valor = -valor

        atual, total_parcelas, descricao_limpa = _extrair_parcelamento(descricao)
        futura = indice_futuro is not None and indice >= indice_futuro

        linhas.append(
            LinhaExtraida(
                descricao=descricao_limpa,
                valor=valor,
                data=_data_do_lancamento(dia_mes, vencimento),
                extras={
                    "descricao_original": descricao,
                    "parcela_atual": atual,
                    "parcela_total": total_parcelas,
                    # CORRENTE entra na despesa deste mês.
                    # FUTURA é informativa: já está prevista pela compra.
                    "secao": "FUTURA" if futura else "CORRENTE",
                },
            )
        )

    correntes = [l for l in linhas if l.extras["secao"] == "CORRENTE"]
    soma_corrente = sum((l.valor for l in correntes), Decimal("0"))

    avisos: list[str] = []
    if vencimento is None:
        avisos.append("Não achei a data de vencimento — a competência ficou indefinida.")
    if not linhas:
        avisos.append(
            "Nenhum lançamento reconhecido. O formato de linha esperado é "
            "'DD/MM DESCRIÇÃO 1.234,56'."
        )
    if indice_futuro is None and linhas:
        avisos.append(
            "Não identifiquei onde começam as compras parceladas de faturas "
            "futuras; tratei tudo como fatura corrente. Se o PDF tiver essa "
            "seção, o total do mês está inflado."
        )
    if total_informado is not None and abs(total_informado - soma_corrente) > Decimal("0.02"):
        avisos.append(
            f"A soma dos lançamentos dá R$ {soma_corrente}, mas a fatura diz "
            f"R$ {total_informado}. Algum lançamento não foi lido, ou a "
            f"separação entre fatura corrente e parcelas futuras errou."
        )

    return Extracao(
        tipo="FATURA_CARTAO",
        referencia=f"fatura-{vencimento:%Y-%m-%d}" if vencimento else "fatura",
        competencia=competencia_de(vencimento),
        vencimento=vencimento,
        valor_total=total_informado if total_informado is not None else soma_corrente,
        emitente=_detectar_emissor(texto),
        linhas=linhas,
        metadados={
            "total_informado": str(total_informado) if total_informado else None,
            "soma_corrente": str(soma_corrente),
            "quantidade_corrente": len(correntes),
            "quantidade_futura": len(linhas) - len(correntes),
            "ultimos_digitos": _ultimos_digitos(texto),
        },
        avisos=avisos,
    )


def _detectar_emissor(texto: str) -> str:
    for banco in (
        "Nubank", "Itaú", "Itau", "Bradesco", "Santander", "Caixa",
        "Banco do Brasil", "Inter", "C6", "Original", "BTG",
    ):
        if banco.lower() in texto.lower():
            return banco
    return ""


def _ultimos_digitos(texto: str) -> str:
    achado = re.search(r"(?:final|nº|no\.?)\s*[:\s]*(\d{4})\b", texto, re.IGNORECASE)
    if achado:
        return achado.group(1)
    mascarado = re.search(r"\*{4,}\s*(\d{4})", texto)
    return mascarado.group(1) if mascarado else ""


registrar(
    Extrator(
        tipo="FATURA_CARTAO",
        nome="Fatura de cartão de crédito",
        reconhece=reconhece,
        extrair=extrair,
        prioridade=60,
    )
)
