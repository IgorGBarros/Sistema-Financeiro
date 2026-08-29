"""
Leitura do QR Code da NFC-e e decomposição da chave de acesso.

O QR Code do cupom da Bahia (validado com o cupom da Redemix, 28/08/2026) tem
esta forma:

    http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p=<chave>|<versao>|<tpAmb>|<cIdToken>|<hash>

Ex.: p=29260806337087001579650110002303451225761309|2|1|1|E7977D66...E4

Layout do parâmetro `p` (QR Code versão 2.0, NT 2020.001):

  emissão normal      chNFe | nVersao | tpAmb | cIdToken | cHashQRCode
  contingência offline chNFe | nVersao | tpAmb | dhEmi | vNF | vICMS | digVal
                             | cIdToken | cHashQRCode

Layout da chave de acesso (44 dígitos):

  posição  tam  campo
  0        2    cUF          29 = Bahia
  2        4    AAMM         2608 = agosto/2026
  6        14   CNPJ         06337087001579
  20       2    modelo       65 = NFC-e (55 = NF-e)
  22       3    série        011
  25       9    número       000230345
  34       1    tpEmis       1 = normal
  35       8    código       22576130
  43       1    DV           9  (módulo 11)

Ler a chave dá emitente, data e número sem nenhuma chamada de rede — o que
permite cadastrar a nota offline e completar os itens depois.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from datetime import date
from urllib.parse import urlparse, parse_qs, unquote

CODIGOS_UF = {
    "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP",
    "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB",
    "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES",
    "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS",
    "51": "MT", "52": "GO", "53": "DF",
}

TIPOS_EMISSAO = {
    "1": "Normal", "2": "Contingência FS-IA", "3": "Contingência SCAN",
    "4": "Contingência EPEC", "5": "Contingência FS-DA", "6": "Contingência SVC-AN",
    "7": "Contingência SVC-RS", "9": "Contingência offline NFC-e",
}


class QRCodeInvalido(ValueError):
    """QR lido não é de uma NFC-e válida."""


@dataclass(frozen=True)
class ChaveAcesso:
    chave: str
    uf: str
    codigo_uf: str
    ano: int
    mes: int
    cnpj_emitente: str
    modelo: str
    serie: str
    numero: str
    tipo_emissao: str
    codigo_numerico: str
    digito_verificador: str

    @property
    def competencia(self) -> date:
        return date(self.ano, self.mes, 1)

    @property
    def cnpj_formatado(self) -> str:
        c = self.cnpj_emitente
        return f"{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}"

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class QRCodeNFCe:
    url: str
    parametro: str
    chave: ChaveAcesso
    versao_qrcode: str
    ambiente: str            # "producao" | "homologacao"
    id_token: str
    hash_qrcode: str
    contingencia: bool
    data_emissao: str | None = None
    valor_total: str | None = None
    valor_icms: str | None = None
    digest_value: str | None = None


def somente_digitos(valor: str) -> str:
    return re.sub(r"\D", "", valor or "")


def calcular_dv(chave43: str) -> str:
    """Dígito verificador da chave de acesso — módulo 11, pesos 2..9 da direita."""
    if len(chave43) != 43 or not chave43.isdigit():
        raise QRCodeInvalido("Base da chave deve ter 43 dígitos numéricos.")
    peso, soma = 2, 0
    for digito in reversed(chave43):
        soma += int(digito) * peso
        peso = 2 if peso == 9 else peso + 1
    resto = soma % 11
    dv = 11 - resto
    return "0" if dv in (10, 11) else str(dv)


def validar_chave(chave: str) -> bool:
    chave = somente_digitos(chave)
    return len(chave) == 44 and calcular_dv(chave[:43]) == chave[43]


def parse_chave(chave: str, *, validar_dv: bool = True) -> ChaveAcesso:
    chave = somente_digitos(chave)
    if len(chave) != 44:
        raise QRCodeInvalido(
            f"Chave de acesso deve ter 44 dígitos, recebi {len(chave)}."
        )
    if validar_dv and calcular_dv(chave[:43]) != chave[43]:
        raise QRCodeInvalido("Dígito verificador da chave não confere.")

    codigo_uf = chave[0:2]
    aamm = chave[2:6]
    ano = 2000 + int(aamm[:2])
    mes = int(aamm[2:])
    if not 1 <= mes <= 12:
        raise QRCodeInvalido(f"Mês inválido na chave: {aamm}.")

    return ChaveAcesso(
        chave=chave,
        uf=CODIGOS_UF.get(codigo_uf, ""),
        codigo_uf=codigo_uf,
        ano=ano,
        mes=mes,
        cnpj_emitente=chave[6:20],
        modelo=chave[20:22],
        serie=chave[22:25],
        numero=chave[25:34],
        tipo_emissao=TIPOS_EMISSAO.get(chave[34], chave[34]),
        codigo_numerico=chave[35:43],
        digito_verificador=chave[43],
    )


def parse_qrcode(conteudo: str, *, validar_dv: bool = True) -> QRCodeNFCe:
    """
    Aceita três formatos, porque na prática o leitor devolve qualquer um deles:
      1. URL completa da SEFAZ com ?p=...
      2. só o parâmetro p (chave|versao|amb|token|hash)
      3. só a chave de 44 dígitos (útil para digitação manual)
    """
    if not conteudo or not conteudo.strip():
        raise QRCodeInvalido("Conteúdo do QR Code vazio.")

    bruto = conteudo.strip()
    url = ""
    parametro = bruto

    if bruto.lower().startswith(("http://", "https://")):
        url = bruto
        query = parse_qs(urlparse(bruto).query)
        chaves_p = [v for k, v in query.items() if k.lower() == "p"]
        if not chaves_p:
            # Alguns estados usam ?chNFe=... na URL de consulta
            ch = [v for k, v in query.items() if k.lower() in ("chnfe", "chave")]
            if not ch:
                raise QRCodeInvalido("URL não contém o parâmetro 'p' da NFC-e.")
            parametro = unquote(ch[0][0])
        else:
            parametro = unquote(chaves_p[0][0])

    partes = [p.strip() for p in parametro.split("|")]

    if len(partes) == 1:
        chave = parse_chave(partes[0], validar_dv=validar_dv)
        return QRCodeNFCe(
            url=url, parametro=parametro, chave=chave, versao_qrcode="",
            ambiente="", id_token="", hash_qrcode="", contingencia=False,
        )

    chave = parse_chave(partes[0], validar_dv=validar_dv)
    versao = partes[1] if len(partes) > 1 else ""
    ambiente_cod = partes[2] if len(partes) > 2 else ""
    ambiente = {"1": "producao", "2": "homologacao"}.get(ambiente_cod, ambiente_cod)

    if len(partes) >= 9:                      # contingência offline
        return QRCodeNFCe(
            url=url, parametro=parametro, chave=chave, versao_qrcode=versao,
            ambiente=ambiente, contingencia=True,
            data_emissao=partes[3], valor_total=partes[4], valor_icms=partes[5],
            digest_value=partes[6], id_token=partes[7], hash_qrcode=partes[8],
        )

    if len(partes) >= 5:                      # emissão normal (online)
        return QRCodeNFCe(
            url=url, parametro=parametro, chave=chave, versao_qrcode=versao,
            ambiente=ambiente, contingencia=False,
            id_token=partes[3], hash_qrcode=partes[4],
        )

    raise QRCodeInvalido(
        f"Formato do parâmetro não reconhecido ({len(partes)} campos)."
    )
