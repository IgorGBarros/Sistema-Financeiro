"""
Financiamento imobiliário — Demonstrativo Descritivo de Crédito (DDC).

Validado contra um DDC real do Itaú: 296 parcelas, sistema SAC, contrato de
2021 com última parcela em 2046.

Por que este documento vale tanto
---------------------------------
O DDC traz a tabela inteira, do começo ao fim, com a situação de cada parcela:

    Paga        já quitada          → realizado
    Aberta      vencendo agora      → previsto do mês corrente
    Projetada   ainda vai vencer    → previsão futura

Ou seja, um único PDF entrega previsto e realizado de vinte e cinco anos, com
o valor exato de cada parcela. Nenhuma projeção nossa chega perto disso.

E isso corrige um erro grande. No SAC a parcela **cai** ao longo do contrato,
porque a amortização é constante e os juros incidem sobre um saldo que
diminui. Cadastrar o financiamento como contrato de valor fixo — que é o que a
planilha original fazia — superestima o desembolso futuro em dezenas de
milhares de reais. O teste `test_financiamento.py` mede essa diferença no
contrato real.

Formato da linha de parcela (18 colunas, separadas por espaço):

    nº  vencimento  amortização  juros  índiceParcela  MIP  DFI  RES  TCA
        multa  mora  ajuste  FGTS  índiceSaldo  acordo  SITUAÇÃO
        valorTotal  saldoDevedor

O único campo não numérico é a situação, o que dá um jeito barato e robusto de
validar a linha sem depender de um regex gigante posicional.
"""

from __future__ import annotations

import re
from decimal import Decimal

from apps.documentos.services.base import (
    Extracao,
    Extrator,
    LinhaExtraida,
    para_data,
    para_decimal,
    registrar,
    somente_digitos,
)

SITUACOES = {"Paga", "Aberta", "Projetada", "Vencida", "Atraso"}
COLUNAS_ESPERADAS = 18

# Ordem das colunas depois de número e vencimento, até a situação.
CAMPOS_NUMERICOS = [
    "amortizacao", "juros", "indice_correcao_parcela", "seguro_mip",
    "seguro_dfi", "seguro_res", "tca", "multa", "mora", "ajuste_financeiro",
    "fgts_mensal", "indice_correcao_saldo", "acordo_parcelado",
]


def reconhece(texto: str) -> bool:
    return (
        "Demonstrativo Descritivo de Crédito" in texto
        or "DemonstrativoDescritivodeCrédito" in texto
        or ("Sistema de amortização" in texto and "Saldo Devedor" in texto)
        or ("Sistemadeamortização" in texto and "SaldoDevedor" in texto)
    )


def _campo(texto: str, rotulo: str, padrao: str = r"([\d.,]+)") -> str | None:
    """
    Busca um rótulo tolerando a ausência de espaços.

    O pdfplumber às vezes cola as palavras do cabeçalho ("Prazototaloperação"),
    então a busca precisa aceitar espaços opcionais entre cada caractere do
    rótulo.
    """
    flexivel = r"\s*".join(re.escape(c) for c in rotulo if not c.isspace())
    achado = re.search(flexivel + r"\s*" + padrao, texto, re.IGNORECASE)
    return achado.group(1) if achado else None


def _parse_linha_parcela(linha: str) -> LinhaExtraida | None:
    partes = linha.split()
    if len(partes) != COLUNAS_ESPERADAS:
        return None
    if not partes[0].isdigit():
        return None
    if partes[15] not in SITUACOES:
        return None

    vencimento = para_data(partes[1])
    if vencimento is None:
        return None

    extras = {"numero": int(partes[0]), "situacao": partes[15]}
    for indice, nome in enumerate(CAMPOS_NUMERICOS, start=2):
        extras[nome] = str(para_decimal(partes[indice]))
    extras["saldo_devedor"] = str(para_decimal(partes[17]))

    return LinhaExtraida(
        descricao=f"Parcela {partes[0]}",
        valor=para_decimal(partes[16]),
        data=vencimento,
        extras=extras,
    )


def extrair(texto: str) -> Extracao:
    linhas: list[LinhaExtraida] = []
    for bruta in texto.split("\n"):
        parcela = _parse_linha_parcela(bruta.strip())
        if parcela:
            linhas.append(parcela)

    contrato = _campo(texto, "Número do contrato", r"(\d+)") or ""
    prazo_total = _campo(texto, "Prazo total operação", r"(\d+)")
    prazo_restante = _campo(texto, "Prazo remanescente", r"(\d+)")
    sistema = _campo(texto, "Sistema de amortização", r"([A-Z]+)") or ""
    ultima = para_data(
        _campo(texto, "Data do vencimento da última parcela", r"(\d{2}/\d{2}/\d{4})")
    )

    avisos = []
    if prazo_total and len(linhas) != int(prazo_total):
        avisos.append(
            f"O documento declara {prazo_total} parcelas, mas consegui ler "
            f"{len(linhas)}. Confira antes de usar a projeção."
        )
    if not linhas:
        avisos.append("Nenhuma parcela reconhecida — o layout pode ter mudado.")

    abertas = [l for l in linhas if l.extras["situacao"] != "Paga"]
    total_restante = sum((l.valor for l in abertas), Decimal("0"))

    # Titular aparece na primeira linha, antes da agência.
    titular = ""
    primeira = texto.split("\n")[0] if texto else ""
    if primeira and "agência" in primeira.lower():
        titular = re.split(r"\s*ag[êe]ncia", primeira, flags=re.IGNORECASE)[0].strip()

    return Extracao(
        tipo="FINANCIAMENTO",
        referencia=contrato or "financiamento",
        vencimento=ultima,
        valor_total=total_restante,
        emitente=_detectar_banco(texto),
        titular=titular,
        linhas=linhas,
        metadados={
            "numero_contrato": contrato,
            "sistema_amortizacao": sistema,
            "prazo_total": int(prazo_total) if prazo_total else None,
            "prazo_remanescente": int(prazo_restante) if prazo_restante else None,
            "taxa_juros_anual": _campo(texto, "Taxa de Juros (anual)"),
            "taxa_efetiva_anual": _campo(texto, "Taxa efetiva (anual)"),
            "parcelas_pagas": len(linhas) - len(abertas),
            "parcelas_abertas": len(abertas),
            "saldo_devedor_atual": (
                str(linhas[len(linhas) - len(abertas) - 1].extras["saldo_devedor"])
                if abertas and len(linhas) > len(abertas)
                else None
            ),
            "cpf_titular": somente_digitos(
                (re.search(r"(\d{3}\.\d{3}\.\d{3}-\d{2})", texto) or [""])[0]
                if re.search(r"(\d{3}\.\d{3}\.\d{3}-\d{2})", texto)
                else ""
            ),
        },
        avisos=avisos,
    )


def _detectar_banco(texto: str) -> str:
    for banco in ("Itaú", "Itau", "Bradesco", "Santander", "Caixa", "Banco do Brasil"):
        if banco.lower() in texto.lower():
            return banco
    return ""


registrar(
    Extrator(
        tipo="FINANCIAMENTO",
        nome="Financiamento imobiliário (DDC)",
        reconhece=reconhece,
        extrair=extrair,
        prioridade=80,
    )
)
