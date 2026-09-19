"""
Holerite (recibo de pagamento).

Validado contra recibos reais da folha mensal, do 13º adiantado e do 13º
integral.

O problema das duas colunas
---------------------------
No PDF, Vencimentos e Descontos são colunas separadas. Na extração de texto
elas colapsam numa só, e a linha vira:

    998 I.N.S.S.        11,26   951,62
    8781 DIAS NORMAIS   30,00 6.500,00

Nos dois casos o último número é o valor e o penúltimo é a referência (dias,
percentual). Nada na linha diz se o valor soma ou subtrai.

A saída é classificar pela verba e **conferir com os totais do documento**:
se a soma dos vencimentos menos a dos descontos não bater com o valor líquido
impresso, a extração se declara suspeita em vez de devolver número errado
com cara de certo. Um holerite mal lido vira receita errada no fluxo de caixa,
e isso é pior que uma importação que falha.
"""

from __future__ import annotations

import re
from decimal import Decimal

from apps.documentos.services.base import (
    Extracao,
    Extrator,
    LinhaExtraida,
    mes_por_extenso,
    para_data,
    para_decimal,
    registrar,
    somente_digitos,
)

# Verbas que subtraem. Comparação por substring, sem acento e em caixa alta.
DESCONTOS = (
    "I.N.S.S", "INSS", "IMPOSTO DE RENDA", "IRRF", "DESC.", "DESCONTO",
    "VALE TRANSPORTE", "SEGURO DE VIDA", "ADIANTAMENTO", "FALTAS",
    "CONTRIB", "PENSAO", "EMPRESTIMO", "COPARTICIPACAO", "PLANO DE SAUDE",
    "ODONTO", "FARMACIA", "SINDICAL",
)

# O valor precisa ter centavos. Sem essa exigência, a linha de cabeçalho
# "999 IGOR GUIMARÃES BARROS 391125 2 1" (código, nome, CBO, departamento,
# filial) é lida como uma verba de R$ 1,00 — bug real, pego pela conferência
# com o valor líquido do próprio recibo.
LINHA_VERBA = re.compile(
    r"^(\d{1,5})\s+"           # código da verba
    r"(.+?)\s+"                # descrição
    r"([\d.]+,\d{2})\s+"       # referência (dias, %, quantidade)
    r"([\d.]+,\d{2})$"         # valor, sempre com centavos
)


def reconhece(texto: str) -> bool:
    marcas = ("Recibo", "Vencimentos", "Descontos", "Valor Líquido")
    return sum(m.lower() in texto.lower() for m in marcas) >= 3 and (
        "Folha Mensal" in texto or "13o." in texto or "Nome do Funcionário" in texto
    )


def _normalizar(texto: str) -> str:
    import unicodedata

    sem_acento = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in sem_acento if not unicodedata.combining(c)).upper()


def _eh_desconto(descricao: str) -> bool:
    normal = _normalizar(descricao)
    return any(marca in normal for marca in DESCONTOS)


def _valor_rotulado(texto: str, rotulo: str) -> Decimal | None:
    achado = re.search(
        re.escape(rotulo) + r"[^\d\-]{0,40}?([\d.]+,\d{2})", texto, re.IGNORECASE
    )
    return para_decimal(achado.group(1)) if achado else None


def extrair(texto: str) -> Extracao:
    linhas: list[LinhaExtraida] = []
    vistos: set[tuple[str, str]] = set()

    for bruta in texto.split("\n"):
        achado = LINHA_VERBA.match(bruta.strip())
        if not achado:
            continue

        codigo, descricao, referencia, valor = achado.groups()
        descricao = descricao.strip(" .")
        chave = (codigo, valor)
        # O recibo vem em duas vias no mesmo PDF (empresa e funcionário).
        # Sem deduplicar, todo valor dobraria.
        if chave in vistos:
            continue
        vistos.add(chave)

        desconto = _eh_desconto(descricao)
        linhas.append(
            LinhaExtraida(
                descricao=descricao,
                valor=para_decimal(valor),
                extras={
                    "codigo": codigo,
                    "referencia": str(para_decimal(referencia)),
                    "natureza": "DESCONTO" if desconto else "VENCIMENTO",
                },
            )
        )

    vencimentos = sum(
        (l.valor for l in linhas if l.extras["natureza"] == "VENCIMENTO"), Decimal("0")
    )
    descontos = sum(
        (l.valor for l in linhas if l.extras["natureza"] == "DESCONTO"), Decimal("0")
    )

    liquido_impresso = _valor_rotulado(texto, "Valor Líquido")
    liquido_calculado = vencimentos - descontos

    avisos: list[str] = []
    if liquido_impresso is None:
        avisos.append(
            "Não achei o valor líquido no documento, então não consegui "
            "conferir a classificação das verbas."
        )
    elif abs(liquido_impresso - liquido_calculado) > Decimal("0.02"):
        avisos.append(
            f"A soma das verbas dá R$ {liquido_calculado}, mas o recibo diz "
            f"R$ {liquido_impresso}. Alguma verba foi classificada como "
            f"vencimento em vez de desconto (ou o contrário) — confira antes "
            f"de usar."
        )

    competencia = mes_por_extenso(texto)
    tipo_folha = "MENSAL"
    if "13o. Adiantamento" in texto or "13 SALARIO ADIANTADO" in texto:
        tipo_folha = "DECIMO_TERCEIRO_ADIANTAMENTO"
    elif "13o. Integral" in texto or "13 SALARIO INTEGRAL" in texto:
        tipo_folha = "DECIMO_TERCEIRO_INTEGRAL"
    elif "FERIAS" in _normalizar(texto):
        tipo_folha = "FERIAS"

    cnpj = re.search(r"CNPJ:\s*([\d./-]+)", texto)
    empregador = ""
    for bruta in texto.split("\n"):
        if "LTDA" in bruta or "S/A" in bruta or "S.A" in bruta:
            empregador = bruta.strip()
            break

    funcionario = ""
    achado_func = re.search(r"^\d+\s+([A-ZÀ-Ú][A-ZÀ-Ú\s]{5,})\s+\d{6}", texto, re.M)
    if achado_func:
        funcionario = achado_func.group(1).strip()

    referencia = (
        f"{cnpj.group(1) if cnpj else 'holerite'}-"
        f"{competencia:%Y-%m}-{tipo_folha}" if competencia else "holerite"
    )

    return Extracao(
        tipo="HOLERITE",
        referencia=referencia,
        competencia=competencia,
        valor_total=liquido_impresso if liquido_impresso is not None else liquido_calculado,
        emitente=empregador,
        documento_emitente=somente_digitos(cnpj.group(1)) if cnpj else "",
        titular=funcionario,
        linhas=linhas,
        metadados={
            "tipo_folha": tipo_folha,
            "total_vencimentos": str(vencimentos),
            "total_descontos": str(descontos),
            "valor_liquido": str(liquido_impresso or liquido_calculado),
            "salario_base": str(_valor_rotulado(texto, "Salário Base") or ""),
            "base_inss": str(_valor_rotulado(texto, "Sal. Contr. INSS") or ""),
            "base_fgts": str(_valor_rotulado(texto, "Base Cálc. FGTS") or ""),
            "fgts_mes": str(_valor_rotulado(texto, "F.G.T.S do Mês") or ""),
            "admissao": str(
                para_data(
                    (re.search(r"Admissão:\s*(\d{2}/\d{2}/\d{4})", texto) or [None, ""])[1]
                    if re.search(r"Admissão:\s*(\d{2}/\d{2}/\d{4})", texto)
                    else ""
                )
                or ""
            ),
            "conferencia_ok": not avisos,
        },
        avisos=avisos,
    )


registrar(
    Extrator(
        tipo="HOLERITE",
        nome="Holerite (recibo de pagamento)",
        reconhece=reconhece,
        extrair=extrair,
        prioridade=75,
    )
)
