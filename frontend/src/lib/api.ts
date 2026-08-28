import { obterToken } from "./firebase";

const BASE_URL = import.meta.env.VITE_API_URL ?? "/api";

export type TipoLancamento = "RECEITA" | "DESPESA";
export type Frequencia = "M" | "B" | "T" | "S" | "A" | "U";

export interface Classificacao {
  id: string;
  nome: string;
  descricao: string;
  peso: number;
  cor: string;
  ordem: number;
  ativo: boolean;
  total_contratos?: number;
}

export interface Categoria {
  id: string;
  nome: string;
  tipo: TipoLancamento;
  classificacao: string;
  classificacao_nome: string;
  consolida_mercado: boolean;
  ativo: boolean;
}

export interface Estabelecimento {
  id: string;
  codigo: number | null;
  nome: string;
  cnpj: string;
}

export interface Contrato {
  id: string;
  numero: number | null;
  estabelecimento: string;
  estabelecimento_nome: string;
  descricao: string;
  tipo: TipoLancamento;
  categoria: string;
  categoria_nome: string;
  classificacao: string;
  classificacao_nome: string;
  valor_unitario: string;
  frequencia: Frequencia;
  reajuste_anual_pct: string;
  data_inicio: string;
  data_fim: string;
  data_rescisao: string | null;
  status: "ATIVO" | "SUSPENSO" | "RESCINDIDO" | "ENCERRADO";
  tipo_conta: "FIXO" | "VARIAVEL";
  quantidade_parcelas: number;
  valor_total_contrato: string;
}

export interface ItemNota {
  id: string;
  numero_item: number;
  codigo: string;
  descricao: string;
  quantidade: string;
  unidade: string;
  valor_unitario: string;
  valor_total: string;
}

export interface NotaFiscal {
  id: string;
  chave_acesso: string;
  nome_emitente: string;
  cnpj_emitente: string;
  municipio: string;
  data_emissao: string | null;
  competencia: string | null;
  valor_total: string;
  quantidade_itens: number;
  forma_pagamento: string;
  status: "PENDENTE" | "IMPORTADA" | "ERRO" | "MANUAL";
  erro_consulta: string;
  itens?: ItemNota[];
  detail?: string;
}

export interface LinhaFluxo {
  competencia: string;
  receita_prevista: string;
  despesa_prevista: string;
  resultado_previsto: string;
  receita_realizada: string;
  despesa_realizada: string;
  resultado_realizado: string;
  desvio_receita: string;
  desvio_despesa: string;
  saldo_acumulado: string;
  projetado: boolean;
}

/** Envelope de paginação do DRF. */
export interface Paginado<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly campos: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Mensagem legível a partir do corpo de erro do DRF. */
function extrairMensagem(status: number, corpo: unknown): string {
  if (typeof corpo === "string") return corpo;
  if (corpo && typeof corpo === "object") {
    const obj = corpo as Record<string, unknown>;
    if (typeof obj.detail === "string") return obj.detail;
    const primeiro = Object.values(obj)[0];
    if (Array.isArray(primeiro) && typeof primeiro[0] === "string") return primeiro[0];
  }
  if (status === 401) return "Sua sessão expirou. Entre novamente.";
  if (status >= 500) return "O servidor não respondeu. Tente em instantes.";
  return "Não foi possível concluir a operação.";
}

async function request<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  // Sem Firebase configurado, obterToken() devolve null e o backend usa a
  // autenticação de desenvolvimento.
  const token = await obterToken();
  const workspace = localStorage.getItem("workspace_id");

  const resposta = await fetch(`${BASE_URL}${caminho}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspace ? { "X-Workspace": workspace } : {}),
      ...init.headers,
    },
  });

  if (resposta.status === 204) return undefined as T;

  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new ApiError(
      extrairMensagem(resposta.status, corpo),
      resposta.status,
      (corpo as Record<string, string[]>) ?? {},
    );
  }
  return corpo as T;
}

/**
 * O DRF pagina toda lista, devolvendo {count, results}. Desembrulhar aqui
 * evita que cada tela precise saber disso — e evita o bug silencioso de
 * `.map()` num objeto que não é array.
 */
async function lista<T>(caminho: string): Promise<T[]> {
  const corpo = await request<Paginado<T> | T[]>(caminho);
  return Array.isArray(corpo) ? corpo : corpo.results;
}

const qs = (params: Record<string, string | undefined>) =>
  new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null) as [string, string][],
  ).toString();

export const api = {
  classificacoes: () => lista<Classificacao>("/classificacoes/"),
  categorias: (tipo?: TipoLancamento) =>
    lista<Categoria>(`/categorias/?${qs({ tipo })}`),

  estabelecimentos: () => lista<Estabelecimento>("/estabelecimentos/"),

  contratos: (filtros: Record<string, string | undefined> = {}) =>
    lista<Contrato>(`/contratos/?${qs(filtros)}`),
  salvarContrato: (dados: Partial<Contrato>, id?: string) =>
    request<Contrato>(id ? `/contratos/${id}/` : "/contratos/", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(dados),
    }),
  /** Projeta as parcelas sem gravar — alimenta o preview do formulário. */
  simularContrato: (dados: {
    data_inicio: string;
    data_fim: string;
    valor_unitario: string;
    frequencia: Frequencia;
    reajuste_anual_pct?: string;
  }) =>
    request<{
      quantidade_parcelas: number;
      valor_total: string;
      parcelas: { indice: number; competencia: string; data_planejada: string; valor_previsto: string }[];
    }>("/contratos/simular/", { method: "POST", body: JSON.stringify(dados) }),
  rescindirContrato: (id: string, data_rescisao: string) =>
    request<Contrato>(`/contratos/${id}/rescindir/`, {
      method: "POST",
      body: JSON.stringify({ data_rescisao }),
    }),

  /** Envia o conteúdo do QR Code lido pela câmera. */
  scanNota: (conteudo: string, categoria?: string) =>
    request<NotaFiscal>("/notas/scan/", {
      method: "POST",
      body: JSON.stringify({ conteudo, categoria }),
    }),
  notas: (filtros: Record<string, string | undefined> = {}) =>
    lista<NotaFiscal>(`/notas/?${qs(filtros)}`),
  nota: (id: string) => request<NotaFiscal>(`/notas/${id}/`),
  reconsultarNota: (id: string) =>
    request<NotaFiscal>(`/notas/${id}/reconsultar/`, { method: "POST" }),
  consolidadoMercado: (inicio?: string, fim?: string) =>
    request<
      { competencia: string; quantidade_notas: number; valor_total: string; ticket_medio: string }[]
    >(`/notas/consolidado/?${qs({ inicio, fim })}`),
  mercadoMesCorrente: () =>
    request<{ valor_total: string; quantidade_notas: number; ticket_medio: string }>(
      "/notas/mes-corrente/",
    ),

  fluxoCaixa: (inicio: string, fim: string, saldoInicial = "0") =>
    request<{ linhas: LinhaFluxo[]; totais: Record<string, string> }>(
      `/fluxo-caixa/?${qs({ inicio, fim, saldo_inicial: saldoInicial })}`,
    ),
  aderencia: (competencia: string) =>
    request<{ competencia: string; linhas: Record<string, unknown>[] }>(
      `/aderencia/?${qs({ competencia })}`,
    ),
  baixarParcela: (parcela: string, valor: string, data_pagamento: string) =>
    request(`/realizados/baixar-parcela/`, {
      method: "POST",
      body: JSON.stringify({ parcela, valor, data_pagamento }),
    }),
};
