"""
Consulta da NFC-e no portal da SEFAZ-BA e extração dos itens do cupom.

Duas rotas possíveis, nesta ordem de preferência:

1. URL do próprio QR Code (`qrcode.aspx?p=...`). O parâmetro carrega o hash
   assinado, então o portal devolve o DANFE direto, sem captcha. É a rota que
   este cliente usa.

2. Página de consulta por chave digitada
   (NFCEC_consulta_danfe.aspx). Exige captcha e ViewState do ASP.NET — só
   serve como fallback manual, com o usuário abrindo o link no navegador.

Aviso honesto sobre fragilidade
-------------------------------
Isto é raspagem de HTML de portal estadual. O layout muda sem aviso e o portal
aplica rate limit por IP. Por isso:

  * o HTML bruto fica salvo em NotaFiscal.payload — se o parser quebrar, dá
    para reprocessar o histórico sem reconsultar a SEFAZ;
  * falha de parsing nunca perde a nota: ela é gravada com status ERRO e os
    dados que já vieram da chave (emitente, data, número);
  * os seletores estão isolados em SELETORES, no topo, para ajuste rápido.

A rota definitiva para quem tem CNPJ e certificado A1 é baixar o XML pelo
webservice NFeDistribuicaoDFe. Para pessoa física, raspagem é o caminho viável.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation

import requests
from bs4 import BeautifulSoup

from apps.fiscal.services.nfce_qrcode import QRCodeNFCe, parse_qrcode

logger = logging.getLogger(__name__)

URL_QRCODE_BA = "http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx"
URL_CONSULTA_MANUAL_BA = (
    "http://nfe.sefaz.ba.gov.br/servicos/nfce/Modulos/Geral/"
    "NFCEC_consulta_danfe.aspx"
)

TIMEOUT = 20
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# Layout padrão do portal "Consulta NFC-e" (compartilhado por vários estados).
SELETORES = {
    "emitente": "#u20, .txtTopo",
    "itens": "#tabResult tr",
    "descricao_item": ".txtTit, .txtTit2",
    "codigo_item": ".RCod",
    "quantidade_item": ".Rqtd",
    "unidade_item": ".RUN",
    "valor_unitario_item": ".RvlUnit",
    "valor_total_item": ".valor",
    "totais": "#totalNota",
    "infos": "#infos",
}


class ConsultaSefazError(RuntimeError):
    pass


@dataclass
class ItemLido:
    numero_item: int
    codigo: str
    descricao: str
    quantidade: Decimal
    unidade: str
    valor_unitario: Decimal
    valor_total: Decimal


@dataclass
class NotaLida:
    chave_acesso: str
    nome_emitente: str = ""
    cnpj_emitente: str = ""
    municipio: str = ""
    data_emissao: datetime | None = None
    valor_total: Decimal = Decimal("0")
    valor_desconto: Decimal = Decimal("0")
    valor_tributos: Decimal = Decimal("0")
    forma_pagamento: str = ""
    protocolo: str = ""
    itens: list[ItemLido] = field(default_factory=list)
    html: str = ""

    @property
    def quantidade_itens(self) -> int:
        return len(self.itens)


# ---------------------------------------------------------------------------
# Helpers de parsing
# ---------------------------------------------------------------------------

def _decimal(texto: str | None) -> Decimal:
    """Converte '1.234,56' e '0,324' para Decimal. Devolve 0 se não der."""
    if not texto:
        return Decimal("0")
    limpo = re.sub(r"[^\d,.\-]", "", texto).strip()
    if not limpo:
        return Decimal("0")
    if "," in limpo:
        limpo = limpo.replace(".", "").replace(",", ".")
    try:
        return Decimal(limpo)
    except InvalidOperation:
        return Decimal("0")


def _texto(no) -> str:
    return re.sub(r"\s+", " ", no.get_text(strip=True)) if no else ""


def _primeiro_numero(texto: str, padrao: str) -> str:
    m = re.search(padrao, texto or "", re.IGNORECASE)
    return m.group(1) if m else ""


# ---------------------------------------------------------------------------
# Cliente
# ---------------------------------------------------------------------------

class ClienteSefazBA:
    def __init__(self, session: requests.Session | None = None, timeout: int = TIMEOUT):
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})
        self.timeout = timeout

    def montar_url(self, qr: QRCodeNFCe) -> str:
        if qr.url:
            return qr.url
        return f"{URL_QRCODE_BA}?p={qr.parametro}"

    def baixar_html(self, url: str) -> str:
        try:
            resp = self.session.get(url, timeout=self.timeout)
        except requests.RequestException as exc:
            raise ConsultaSefazError(f"Falha de rede ao consultar a SEFAZ: {exc}") from exc
        if resp.status_code != 200:
            raise ConsultaSefazError(
                f"SEFAZ respondeu HTTP {resp.status_code} para a consulta."
            )
        resp.encoding = resp.apparent_encoding or "utf-8"
        return resp.text

    def consultar(self, conteudo_qr: str) -> NotaLida:
        qr = parse_qrcode(conteudo_qr)
        html = self.baixar_html(self.montar_url(qr))
        nota = self.parse_danfe(html, chave=qr.chave.chave)
        if not nota.cnpj_emitente:
            nota.cnpj_emitente = qr.chave.cnpj_emitente
        return nota

    # -- parsing -----------------------------------------------------------

    def parse_danfe(self, html: str, *, chave: str) -> NotaLida:
        soup = BeautifulSoup(html, "html.parser")
        texto_pagina = soup.get_text(" ", strip=True)

        if "não foi encontrada" in texto_pagina.lower() or "inexistente" in texto_pagina.lower():
            raise ConsultaSefazError("A SEFAZ não encontrou esta chave de acesso.")

        nota = NotaLida(chave_acesso=chave, html=html)

        # Emitente: primeiro bloco em destaque do DANFE.
        emitente = soup.select_one("#u20") or soup.select_one(".txtTopo")
        nota.nome_emitente = _texto(emitente)[:200]

        cnpj = _primeiro_numero(texto_pagina, r"CNPJ[:\s]*([\d./-]{14,18})")
        nota.cnpj_emitente = re.sub(r"\D", "", cnpj)

        # Município costuma vir na linha de endereço do emitente.
        endereco = soup.select_one("#u18") or soup.select_one(".text")
        nota.municipio = _texto(endereco)[:120]

        # Data de emissão: "Emissão: 28/08/2026 07:50:26"
        m = re.search(r"(\d{2}/\d{2}/\d{4})[\sà-]*(\d{2}:\d{2}:\d{2})?", texto_pagina)
        if m:
            try:
                data_str = m.group(1) + (f" {m.group(2)}" if m.group(2) else " 00:00:00")
                nota.data_emissao = datetime.strptime(data_str, "%d/%m/%Y %H:%M:%S")
            except ValueError:
                logger.warning("Data de emissão não reconhecida na chave %s", chave)

        nota.protocolo = _primeiro_numero(texto_pagina, r"Protocolo[^\d]*(\d{10,20})")

        # Totais
        for rotulo, campo in (
            (r"Valor a pagar R\$[:\s]*([\d.,]+)", "valor_total"),
            (r"Valor total R\$[:\s]*([\d.,]+)", "valor_total"),
            (r"Descontos R\$[:\s]*([\d.,]+)", "valor_desconto"),
            (r"Tributos Totais Incidentes[^\d]*([\d.,]+)", "valor_tributos"),
        ):
            valor = _decimal(_primeiro_numero(texto_pagina, rotulo))
            if valor and not getattr(nota, campo):
                setattr(nota, campo, valor)

        forma = re.search(
            r"(Dinheiro|Cartão de Crédito|Cartão de Débito|PIX|Vale Alimentação|"
            r"Vale Refeição|Crédito Loja|Sem pagamento)", texto_pagina, re.IGNORECASE
        )
        if forma:
            nota.forma_pagamento = forma.group(1)

        nota.itens = self._parse_itens(soup)

        # Se o portal não trouxe o total, soma os itens.
        if not nota.valor_total and nota.itens:
            nota.valor_total = sum((i.valor_total for i in nota.itens), Decimal("0"))

        return nota

    def _parse_itens(self, soup: BeautifulSoup) -> list[ItemLido]:
        itens: list[ItemLido] = []
        linhas = soup.select("#tabResult tr")
        for numero, linha in enumerate(linhas, start=1):
            descricao = _texto(linha.select_one(".txtTit, .txtTit2"))
            if not descricao:
                continue
            codigo = _primeiro_numero(_texto(linha.select_one(".RCod")), r"(\d+)")
            quantidade = _decimal(_texto(linha.select_one(".Rqtd")))
            unidade = _texto(linha.select_one(".RUN")).replace("UN:", "").strip()
            valor_unitario = _decimal(_texto(linha.select_one(".RvlUnit")))
            valor_total = _decimal(_texto(linha.select_one(".valor")))

            if not valor_total and quantidade and valor_unitario:
                valor_total = (quantidade * valor_unitario).quantize(Decimal("0.01"))

            itens.append(
                ItemLido(
                    numero_item=numero,
                    codigo=codigo,
                    descricao=descricao[:200],
                    quantidade=quantidade or Decimal("1"),
                    unidade=unidade[:10],
                    valor_unitario=valor_unitario,
                    valor_total=valor_total,
                )
            )
        return itens


# ---------------------------------------------------------------------------
# Persistência
# ---------------------------------------------------------------------------

def importar_nota(*, workspace, conteudo_qr: str, usuario=None, categoria=None):
    """
    Fluxo completo do scan: parse do QR → consulta SEFAZ → grava nota + itens.

    Idempotente pela chave de acesso: reescanear o mesmo cupom devolve a nota
    existente em vez de duplicar. Se a nota estava com status ERRO, tenta de novo.
    """
    from django.db import transaction
    from apps.fiscal.models import ItemNotaFiscal, NotaFiscal, StatusNota
    from apps.fiscal.services.consolidacao import sincronizar_mercado_do_mes

    qr = parse_qrcode(conteudo_qr)
    chave = qr.chave.chave

    existente = NotaFiscal.objects.filter(
        workspace=workspace, chave_acesso=chave
    ).first()
    if existente and existente.status == StatusNota.IMPORTADA:
        return existente, False

    cliente = ClienteSefazBA()
    erro = ""
    lida: NotaLida | None = None
    try:
        lida = cliente.consultar(conteudo_qr)
    except (ConsultaSefazError, Exception) as exc:  # noqa: BLE001 — nunca perder a nota
        erro = str(exc)
        logger.exception("Falha ao consultar NFC-e %s", chave)

    with transaction.atomic():
        nota = existente or NotaFiscal(workspace=workspace, chave_acesso=chave)
        nota.uf = qr.chave.uf
        nota.modelo = qr.chave.modelo
        nota.serie = qr.chave.serie
        nota.numero = qr.chave.numero
        nota.cnpj_emitente = qr.chave.cnpj_emitente
        nota.qr_url = cliente.montar_url(qr)
        nota.importado_por = usuario
        if categoria:
            nota.categoria = categoria

        if lida:
            nota.nome_emitente = lida.nome_emitente
            nota.municipio = lida.municipio
            nota.data_emissao = lida.data_emissao
            nota.valor_total = lida.valor_total
            nota.valor_desconto = lida.valor_desconto
            nota.valor_tributos = lida.valor_tributos
            nota.forma_pagamento = lida.forma_pagamento
            nota.protocolo = lida.protocolo
            nota.quantidade_itens = lida.quantidade_itens
            nota.status = StatusNota.IMPORTADA
            nota.erro_consulta = ""
            nota.payload = {"html": lida.html[:500_000]}
        else:
            nota.status = StatusNota.ERRO
            nota.erro_consulta = erro

        nota.save()

        if lida and lida.itens:
            nota.itens.all().delete()
            ItemNotaFiscal.objects.bulk_create(
                [
                    ItemNotaFiscal(
                        nota=nota,
                        numero_item=i.numero_item,
                        codigo=i.codigo,
                        descricao=i.descricao,
                        quantidade=i.quantidade,
                        unidade=i.unidade,
                        valor_unitario=i.valor_unitario,
                        valor_total=i.valor_total,
                    )
                    for i in lida.itens
                ]
            )

    if nota.status == StatusNota.IMPORTADA and nota.competencia:
        sincronizar_mercado_do_mes(workspace, nota.competencia)

    return nota, True
