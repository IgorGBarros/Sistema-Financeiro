/**
 * Validação local da chave de acesso da NFC-e.
 *
 * Espelha core/services/nfce_qrcode.py de propósito: valida antes de gastar
 * uma ida ao servidor e uma consulta na SEFAZ. A validação do backend continua
 * sendo a que vale — esta aqui é só para dar resposta imediata a quem digita.
 */

const UFS: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP",
  "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB",
  "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES",
  "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS",
  "51": "MT", "52": "GO", "53": "DF",
};

export interface ChaveAcesso {
  chave: string;
  uf: string;
  ano: number;
  mes: number;
  cnpjEmitente: string;
  modelo: string;
  serie: string;
  numero: string;
  competencia: string; // YYYY-MM-01
}

export const somenteDigitos = (valor: string) => (valor ?? "").replace(/\D/g, "");

/** Dígito verificador da chave — módulo 11, pesos 2..9 da direita para a esquerda. */
export function calcularDigitoVerificador(base43: string): string | null {
  if (base43.length !== 43 || !/^\d+$/.test(base43)) return null;
  let peso = 2;
  let soma = 0;
  for (let i = base43.length - 1; i >= 0; i -= 1) {
    soma += Number(base43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv >= 10 ? "0" : String(dv);
}

export function validarChaveAcesso(chave: string): boolean {
  const limpa = somenteDigitos(chave);
  if (limpa.length !== 44) return false;
  return calcularDigitoVerificador(limpa.slice(0, 43)) === limpa[43];
}

export function decompor(chave: string): ChaveAcesso | null {
  const limpa = somenteDigitos(chave);
  if (!validarChaveAcesso(limpa)) return null;

  const ano = 2000 + Number(limpa.slice(2, 4));
  const mes = Number(limpa.slice(4, 6));
  return {
    chave: limpa,
    uf: UFS[limpa.slice(0, 2)] ?? "",
    ano,
    mes,
    cnpjEmitente: limpa.slice(6, 20),
    modelo: limpa.slice(20, 22),
    serie: limpa.slice(22, 25),
    numero: limpa.slice(25, 34),
    competencia: `${ano}-${String(mes).padStart(2, "0")}-01`,
  };
}

/** Extrai a chave de uma URL de QR Code, do parâmetro p, ou do texto puro. */
export function extrairChave(conteudo: string): string | null {
  if (!conteudo?.trim()) return null;
  let texto = conteudo.trim();

  if (/^https?:\/\//i.test(texto)) {
    try {
      const url = new URL(texto);
      texto =
        url.searchParams.get("p") ??
        url.searchParams.get("chNFe") ??
        url.searchParams.get("chave") ??
        "";
    } catch {
      return null;
    }
  }

  const candidata = somenteDigitos(texto.split("|")[0]);
  return validarChaveAcesso(candidata) ? candidata : null;
}

export const formatarCnpj = (cnpj: string) =>
  cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

export const formatarChave = (chave: string) =>
  (somenteDigitos(chave).match(/.{1,4}/g) ?? []).join(" ");

export const formatarMoeda = (valor: string | number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    typeof valor === "string" ? Number(valor) : valor,
  );

export const formatarCompetencia = (iso: string) => {
  const [ano, mes] = iso.split("-");
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" })
    .format(new Date(Number(ano), Number(mes) - 1, 1))
    .replace(".", "");
};
