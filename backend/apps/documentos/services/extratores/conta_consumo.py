"""
Conta de consumo — energia elétrica (Coelba/Neoenergia).

ATENÇÃO — NÃO TESTADO CONTRA PDF REAL
--------------------------------------
Escrito a partir das expressões do seu `extrair_boletos.py`, sem uma fatura em
mãos. Rode com `--simular` na primeira vez.

Por que a conta de luz não é só uma despesa
-------------------------------------------
O valor pago já viria do extrato ou do boleto. O que só esta conta entrega é o
**consumo em kWh** e a **leitura do medidor**.

Isso muda o tipo de pergunta que o sistema consegue responder. Sem o consumo,
"a luz subiu" é uma frase sobre o valor. Com ele, dá para separar as duas
causas possíveis — gastei mais energia, ou a tarifa aumentou — que pedem
reações opostas. Uma se resolve mudando hábito; a outra, não tem o que fazer.

Por isso `consumo_kwh` e `tarifa_media` são campos de primeira classe, e não
metadado solto.
"""

from __future__ import annotations

import re

from apps.documentos.services.base import (
    Extracao,
    Extrator,
    LinhaExtraida,
    competencia_de,
    para_data,
    para_decimal,
    registrar,
)


def reconhece(texto: str) -> bool:
    alto = texto.upper()
    if "COELBA" in alto or "NEOENERGIA" in alto:
        return True
    # Genérico: qualquer conta de energia tem estes três juntos.
    return all(
        marca in alto
        for marca in ("KWH", "TOTAL A PAGAR", "VENCIMENTO")
    ) and ("LEITURA" in alto or "CONSUMO" in alto)


def _buscar(texto: str, *padroes: str) -> str | None:
    for padrao in padroes:
        achado = re.search(padrao, texto, re.IGNORECASE)
        if achado:
            return achado.group(1)
    return None


def extrair(texto: str) -> Extracao:
    codigo_cliente = _buscar(
        texto,
        r"C[ÓO]DIGO DO CLIENTE\s*[:\s]*(\d+)",
        r"UNIDADE CONSUMIDORA\s*[:\s]*(\d+)",
        r"INSTALA[ÇC][ÃA]O\s*[:\s]*(\d+)",
    )

    referencia_texto = _buscar(
        texto,
        r"REF[:\s]*M[ÊE]S/ANO\s*[:\s]*(\d{2}/\d{4})",
        r"REFER[ÊE]NCIA\s*[:\s]*(\d{2}/\d{4})",
        r"\b(\d{2}/\d{4})\b",
    )
    competencia = None
    if referencia_texto:
        mes, ano = referencia_texto.split("/")
        from datetime import date

        competencia = date(int(ano), int(mes), 1)

    vencimento = para_data(
        _buscar(texto, r"VENCIMENTO\s*[:\s]*(\d{2}/\d{2}/\d{4})")
    )
    total = para_decimal(
        _buscar(
            texto,
            r"TOTAL A PAGAR\s*R?\$?\s*([\d.]+,\d{2})",
            r"VALOR A PAGAR\s*R?\$?\s*([\d.]+,\d{2})",
        )
    )

    consumo = para_decimal(
        _buscar(
            texto,
            r"CONSUMO\s*K?W?H?\s*[:\s]*([\d.]+,?\d*)\s*kWh",
            r"CONSUMO-?TUSD\s+([\d.,]+)\s*kWh",
            r"CONSUMO\s+KWH\s*[:\s]*([\d.,]+)",
        )
    )
    leitura_anterior = para_decimal(
        _buscar(texto, r"LEITURA ANTERIOR\s+[\d/]*\s*([\d.,]+)")
    )
    leitura_atual = para_decimal(
        _buscar(texto, r"LEITURA ATUAL\s+[\d/]*\s*([\d.,]+)")
    )

    # Itens da fatura: descrição seguida de vários números.
    linhas: list[LinhaExtraida] = []
    secao = re.search(
        r"ITENS DA FATURA(.*?)(?=C[ÓO]DIGO DO CLIENTE|RESERVADO AO FISCO|\Z)",
        texto,
        re.DOTALL | re.IGNORECASE,
    )
    if secao:
        for bruta in secao.group(1).split("\n"):
            bruta = bruta.strip()
            descricao = re.match(r"^([A-Za-zÀ-ú\-\s./]{4,}?)\s+[\d.,]", bruta)
            numeros = re.findall(r"[\d.]+,\d{2}", bruta)
            if not descricao or not numeros:
                continue
            # O valor do item é o último número monetário da linha.
            linhas.append(
                LinhaExtraida(
                    descricao=descricao.group(1).strip(),
                    valor=para_decimal(numeros[-1]),
                    extras={"numeros": numeros},
                )
            )

    avisos: list[str] = []
    if not total:
        avisos.append("Não achei o total a pagar — a conta não pode virar despesa assim.")
    if not consumo:
        avisos.append(
            "Não achei o consumo em kWh. A despesa ainda funciona, mas a "
            "análise de tarifa versus consumo fica indisponível."
        )
    if leitura_atual and leitura_anterior and leitura_atual < leitura_anterior:
        avisos.append(
            "A leitura atual é menor que a anterior. Pode ser troca de medidor "
            "ou erro de leitura — confira."
        )

    tarifa_media = (total / consumo) if (total and consumo) else None

    return Extracao(
        tipo="CONTA_CONSUMO",
        referencia=f"{codigo_cliente or 'luz'}-{referencia_texto or ''}",
        competencia=competencia or competencia_de(vencimento),
        vencimento=vencimento,
        valor_total=total,
        emitente="COELBA" if "COELBA" in texto.upper() else "",
        linhas=linhas,
        metadados={
            "servico": "ENERGIA",
            "codigo_cliente": codigo_cliente,
            "consumo_kwh": str(consumo) if consumo else None,
            "leitura_anterior": str(leitura_anterior) if leitura_anterior else None,
            "leitura_atual": str(leitura_atual) if leitura_atual else None,
            "tarifa_media": str(round(tarifa_media, 6)) if tarifa_media else None,
            "dias_faturados": _buscar(texto, r"(\d{1,3})\s*DIAS"),
        },
        avisos=avisos,
    )


registrar(
    Extrator(
        tipo="CONTA_CONSUMO",
        nome="Conta de consumo (energia)",
        reconhece=reconhece,
        extrair=extrair,
        prioridade=70,
    )
)
