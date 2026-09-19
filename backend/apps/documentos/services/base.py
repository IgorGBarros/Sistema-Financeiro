"""
Base dos extratores de documento.

Todo extrator recebe bytes de um PDF e devolve um `Extracao`: cabeçalho com os
dados do documento e uma lista de linhas. O que fazer com isso é problema do
app de domínio — o extrator não conhece models e não toca no banco.

Essa separação é o que permite testar extração com o PDF real, sem banco, e
reprocessar um documento antigo quando o parser melhorar.

Registro e detecção
-------------------
Cada extrator declara um `reconhece(texto)`. A importação tenta os extratores
na ordem de especificidade, então o usuário não precisa dizer que tipo de
documento está enviando — o conteúdo diz.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Iterable

logger = logging.getLogger(__name__)

TipoDocumento = str  # "FATURA_CARTAO", "CONTA_CONSUMO", "FINANCIAMENTO", "HOLERITE"


class ErroExtracao(Exception):
    """Falha esperada: PDF ilegível, senha errada, layout não reconhecido."""


class SenhaNecessaria(ErroExtracao):
    """O PDF é protegido e a senha não foi informada ou está errada."""


@dataclass
class LinhaExtraida:
    """Uma linha do documento, já normalizada mas ainda sem interpretação."""

    descricao: str
    valor: Decimal
    data: date | None = None
    # Campos livres do extrator: consumo em kWh, número da parcela, saldo
    # devedor, código da verba. O app de domínio sabe o que fazer com cada um.
    extras: dict[str, Any] = field(default_factory=dict)


@dataclass
class Extracao:
    tipo: TipoDocumento
    # Identificador natural do documento, usado para evitar reimportação:
    # número do contrato + parcela, código do cliente + competência, etc.
    referencia: str
    competencia: date | None = None
    vencimento: date | None = None
    valor_total: Decimal | None = None
    emitente: str = ""
    documento_emitente: str = ""  # CNPJ, sem pontuação
    titular: str = ""
    linhas: list[LinhaExtraida] = field(default_factory=list)
    # Tudo que o extrator entendeu mas não cabe nos campos acima. Fica gravado
    # junto ao documento para não perder informação entre versões do parser.
    metadados: dict[str, Any] = field(default_factory=dict)
    avisos: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Conversores
# ---------------------------------------------------------------------------

def para_decimal(texto: str | None) -> Decimal:
    """
    Converte '1.234,56' e '0,324' para Decimal.

    O ponto é separador de milhar e a vírgula é decimal — é o formato de todo
    documento financeiro brasileiro. Usar float() direto aqui converteria
    '1.234,56' em erro, ou pior, em 1.234.
    """
    if texto is None:
        return Decimal("0")
    limpo = re.sub(r"[^\d,.\-]", "", str(texto)).strip()
    if not limpo or limpo in {"-", ".", ","}:
        return Decimal("0")
    if "," in limpo:
        limpo = limpo.replace(".", "").replace(",", ".")
    try:
        return Decimal(limpo)
    except InvalidOperation:
        return Decimal("0")


def para_data(texto: str | None, formatos: Iterable[str] = ("%d/%m/%Y", "%d/%m/%y")) -> date | None:
    if not texto:
        return None
    texto = texto.strip()
    for formato in formatos:
        try:
            return datetime.strptime(texto, formato).date()
        except ValueError:
            continue
    return None


def competencia_de(valor: date | None) -> date | None:
    """Primeiro dia do mês — a convenção de competência do sistema inteiro."""
    return valor.replace(day=1) if valor else None


MESES = {
    "janeiro": 1, "fevereiro": 2, "março": 3, "marco": 3, "abril": 4,
    "maio": 5, "junho": 6, "julho": 7, "agosto": 8, "setembro": 9,
    "outubro": 10, "novembro": 11, "dezembro": 12,
}


def mes_por_extenso(texto: str) -> date | None:
    """'Novembro de 2025' -> date(2025, 11, 1)"""
    achado = re.search(r"([A-Za-zçÇãÃéÉ]+)\s+de\s+(\d{4})", texto or "")
    if not achado:
        return None
    mes = MESES.get(achado.group(1).lower())
    return date(int(achado.group(2)), mes, 1) if mes else None


def somente_digitos(texto: str | None) -> str:
    return re.sub(r"\D", "", texto or "")


# ---------------------------------------------------------------------------
# Leitura do PDF
# ---------------------------------------------------------------------------

def ler_texto(conteudo: bytes, senha: str | None = None) -> str:
    """
    Texto de todas as páginas.

    A senha é parâmetro e **nunca é armazenada**. Houve um campo `senha_pdf`
    nos modelos de cartão e de unidade consumidora; foi removido. Guardar a
    senha em claro no banco não se justifica: ela costuma derivar do CPF ou da
    data de nascimento, e criptografá-la com uma chave que mora no mesmo
    servidor não protege de nada. A senha é digitada a cada importação.

    Usa pdfplumber, que preserva o espaçamento entre colunas melhor que o
    pypdf em tabelas — e todos estes documentos são tabelas.
    """
    import io

    import pdfplumber

    try:
        with pdfplumber.open(io.BytesIO(conteudo), password=senha or "") as pdf:
            return "\n".join(pagina.extract_text() or "" for pagina in pdf.pages)
    except Exception as exc:  # noqa: BLE001
        mensagem = str(exc).lower()
        if "password" in mensagem or "encrypt" in mensagem:
            raise SenhaNecessaria(
                "O PDF é protegido por senha. Informe a senha do documento."
            ) from exc
        raise ErroExtracao(f"Não consegui ler o PDF: {exc}") from exc


# ---------------------------------------------------------------------------
# Registro
# ---------------------------------------------------------------------------

@dataclass
class Extrator:
    tipo: TipoDocumento
    nome: str
    reconhece: Callable[[str], bool]
    extrair: Callable[[str], Extracao]
    # Mais específico é tentado primeiro. Um extrator genérico com prioridade
    # alta engoliria documentos que outro trataria melhor.
    prioridade: int = 50


_REGISTRO: list[Extrator] = []


def registrar(extrator: Extrator) -> Extrator:
    _REGISTRO.append(extrator)
    _REGISTRO.sort(key=lambda e: -e.prioridade)
    return extrator


def extratores() -> list[Extrator]:
    return list(_REGISTRO)


def detectar(texto: str) -> Extrator | None:
    for extrator in _REGISTRO:
        try:
            if extrator.reconhece(texto):
                return extrator
        except Exception:  # noqa: BLE001
            # Um extrator quebrado não pode impedir que os outros sejam
            # testados — mas precisa aparecer no log, senão fica quebrado
            # para sempre sem ninguém notar.
            logger.exception("Extrator %s falhou ao reconhecer o documento", extrator.nome)
            continue
    return None


def extrair(conteudo: bytes, senha: str | None = None, tipo: TipoDocumento | None = None) -> Extracao:
    """Ponto de entrada: lê o PDF, escolhe o extrator e devolve a extração."""
    from apps.documentos.services import extratores as _  # noqa: F401 registra

    texto = ler_texto(conteudo, senha)
    if not texto.strip():
        raise ErroExtracao(
            "O PDF não tem texto extraível. Pode ser um documento escaneado, "
            "que precisaria de OCR."
        )

    if tipo:
        escolhido = next((e for e in _REGISTRO if e.tipo == tipo), None)
        if escolhido is None:
            raise ErroExtracao(f"Não existe extrator para o tipo '{tipo}'.")
    else:
        escolhido = detectar(texto)
        if escolhido is None:
            raise ErroExtracao(
                "Não reconheci o tipo deste documento. Tipos suportados: "
                + ", ".join(e.nome for e in _REGISTRO)
            )

    return escolhido.extrair(texto)
