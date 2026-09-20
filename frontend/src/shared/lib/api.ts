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

export interface Realizado {
  id: string;
  contrato: string | null;
  contrato_descricao: string | null;
  parcela: string | null;
  categoria: string;
  categoria_nome: string;
  descricao: string;
  tipo: TipoLancamento;
  competencia: string;
  data_pagamento: string;
  valor: string;
  forma_pagamento: string;
  origem: "MANUAL" | "BAIXA" | "MERCADO";
  competencia_mercado: string | null;
  observacao: string;
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
  valor_desconto: string;
  valor_tributos: string;
  quantidade_itens: number;
  forma_pagamento: string;
  protocolo: string;
  qr_url: string;
  serie: string;
  numero: string;
  uf: string;
  status: "PENDENTE" | "IMPORTADA" | "ERRO" | "MANUAL";
  erro_consulta: string;
  itens?: ItemNota[];
  pagamentos?: PagamentoNota[];
  detail?: string;
}

export interface FerramentaUsada {
  nome: string;
  argumentos: Record<string, unknown>;
  erro: boolean;
}

export interface RespostaAssistente {
  conversa: string;
  resposta: string;
  ferramentas_usadas: FerramentaUsada[];
  mensagem: string;
}

export interface CapacidadesAssistente {
  ferramentas: { nome: string; descricao: string }[];
  exemplos: string[];
}

export interface Parcela {
  id: string;
  contrato: string;
  contrato_descricao: string;
  estabelecimento: string;
  tipo: TipoLancamento;
  categoria: string;
  classificacao: string;
  indice: number;
  competencia: string;
  data_planejada: string;
  valor_previsto: string;
  quantidade_planejada: number;
  pago: boolean;
}

export interface Previsao {
  competencia_inicial: string;
  horizonte: number;
  modelo: {
    nome: string;
    descricao: string;
    motivo: string;
    confiavel: boolean;
    observacoes: number;
    erro_medio: string | null;
    ganho_sobre_ingenuo: number | null;
    candidatos: {
      modelo: string;
      descricao: string;
      erro_medio: string;
      avaliacoes: number;
    }[];
  };
  meses: {
    competencia: string;
    contratado: string;
    estimado: string;
    resultado_p50: string;
    saldo_p10: string;
    saldo_p50: string;
    saldo_p90: string;
    probabilidade_negativo: number;
  }[];
  risco: {
    probabilidade_algum_mes_negativo: number;
    primeiro_mes_de_risco: string | null;
    saldo_final_p10: string;
    saldo_final_p50: string;
    saldo_final_p90: string;
    cenarios_simulados: number;
    confiavel: boolean;
  };
  resumo: string;
  aviso: string | null;
}

export interface LinhaConfronto {
  competencia: string;
  fechada: boolean;
  receita_prevista: string;
  receita_realizada: string;
  receita_efetiva: string;
  receita_desvio: string;
  despesa_prevista: string;
  despesa_realizada: string;
  despesa_efetiva: string;
  despesa_desvio: string;
  resultado_efetivo: string;
  saldo_acumulado: string;
}

export interface Confronto {
  meses: string[];
  linhas: LinhaConfronto[];
  competencia_corrente: string;
}

export interface SaldoARealizar {
  competencia_corrente: string;
  total_em_aberto: string;
  linhas: {
    contrato: string;
    descricao: string;
    estabelecimento: string;
    tipo: TipoLancamento;
    previsto_total: string;
    previsto_ate_agora: string;
    realizado: string;
    em_aberto: string;
    saldo_futuro: string;
  }[];
}

export interface MatrizContratos {
  agrupamento: string;
  meses: string[];
  linhas: {
    id: string;
    nome: string;
    tipo: TipoLancamento | "MISTO";
    valores: Record<string, string>;
    total: string;
  }[];
  totais: Record<string, string>;
  acumulado: Record<string, string>;
  total_geral: string;
}

export interface PainelCartoes {
  meses: string[];
  linhas: {
    id: string;
    apelido: string;
    bandeira: string;
    ultimos_digitos: string;
    dia_fechamento: number;
    dia_vencimento: number;
    proximo_vencimento: string;
    valores: Record<string, string>;
    total_periodo: string;
    limite: string | null;
    comprometido: string;
    disponivel: string | null;
    utilizacao_pct: string | null;
  }[];
  totais: Record<string, string>;
  resumo: {
    limite_total: string;
    comprometido_total: string;
    disponivel_total: string;
    utilizacao_pct: string | null;
    cartoes_ativos: number;
  };
}

export interface PagamentoNota {
  id: string;
  forma: string;
  valor: string;
  cartao: string | null;
  cartao_apelido: string | null;
  parcelas: number;
  bandeira: string;
  autorizacao: string;
  confirmado: boolean;
}

export interface SugestaoPagamento {
  forma: string;
  valor: string;
  cartao: string | null;
  parcelas: number;
  categoria: string | null;
  origem_da_sugestao: "nota" | "historico" | "estabelecimento" | "nenhuma";
}

export interface Cartao {
  id: string;
  apelido: string;
  bandeira: string;
  ultimos_digitos: string;
  emissor: string;
  limite: string | null;
  dia_fechamento: number;
  dia_vencimento: number;
  cartao_titular: string | null;
  ativo: boolean;
}

export interface Compra {
  id: string;
  nota: string | null;
  cartao: string;
  cartao_apelido: string;
  estabelecimento: string;
  estabelecimento_nome: string;
  categoria: string;
  categoria_nome: string;
  descricao: string;
  data_compra: string;
  valor_total: string;
  parcelas_total: number;
  parcelas: { id: string; numero: number; competencia: string; valor: string; conciliada_em: string | null }[];
}

export interface LancamentoFatura {
  id: string;
  descricao: string;
  descricao_original: string;
  data_compra: string | null;
  valor: string;
  parcela_atual: number | null;
  parcela_total: number | null;
  secao: "CORRENTE" | "FUTURA";
  conciliado: boolean;
  metodo_conciliacao: string;
  estabelecimento: string | null;
  estabelecimento_nome: string | null;
  categoria: string | null;
}

export interface Fatura {
  id: string;
  cartao: string;
  cartao_apelido: string;
  competencia: string;
  data_vencimento: string;
  valor_total_informado: string;
  status: string;
  lancamentos: LancamentoFatura[];
}

export interface ParcelaFinanciamento {
  id: string;
  numero: number;
  competencia: string;
  vencimento: string;
  valor_total: string;
  situacao: "PAGA" | "ABERTA" | "PROJETADA" | "VENCIDA";
  amortizacao: string;
  juros: string;
  seguro_mip: string;
  seguro_dfi: string;
  taxa_administracao: string;
  encargos: string;
  saldo_devedor: string;
}

export interface Financiamento {
  id: string;
  numero_contrato: string;
  instituicao: string;
  titular: string;
  paga_do_proprio_bolso: boolean;
  sistema_amortizacao: string;
  prazo_total: number | null;
  taxa_juros_anual: string;
  data_ultima_parcela: string | null;
  parcelas_pagas: number;
  parcelas_restantes: number;
  saldo_devedor_atual: string | null;
  total_a_pagar: string;
  juros_a_pagar: string;
  proxima_parcela: ParcelaFinanciamento | null;
}

export interface Verba {
  id: string;
  codigo: string;
  descricao: string;
  referencia: string | null;
  valor: string;
  natureza: "VENCIMENTO" | "DESCONTO";
}

export interface Holerite {
  id: string;
  empregador_nome: string;
  funcionario: string;
  competencia: string;
  tipo_folha: string;
  total_vencimentos: string;
  total_descontos: string;
  valor_liquido: string;
  salario_base: string | null;
  base_inss: string | null;
  base_fgts: string | null;
  fgts_mes: string | null;
  conferencia_ok: boolean;
  integrado: boolean;
  verbas: Verba[];
}

export interface ContaConsumo {
  id: string;
  unidade: string;
  unidade_apelido: string;
  competencia: string;
  vencimento: string | null;
  valor_total: string;
  consumo: string | null;
  leitura_anterior: string | null;
  leitura_atual: string | null;
  dias_faturados: number | null;
  tarifa_media: string | null;
  itens: { id: string; descricao: string; valor: string }[];
}

export interface DocumentoImportado {
  id: string;
  nome_arquivo: string;
  tipo: string;
  status: string;
  competencia: string | null;
  vencimento: string | null;
  valor_total: string | null;
  emitente: string;
  avisos: string[];
  erro: string;
  linhas?: { id: string; descricao: string; valor: string; data: string | null }[];
  resultado?: Record<string, unknown> | null;
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
    /** Status HTTP. **0 significa que a requisição não chegou ao servidor** —
     *  é como o código distingue "sem internet" de "servidor recusou". */
    readonly status: number,
    readonly campos: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Falha de rede: vale a pena guardar e tentar de novo depois. */
  get offline(): boolean {
    return this.status === 0;
  }
}

/** Mensagem legível a partir do corpo de erro do DRF. */
function extrairMensagem(status: number, corpo: unknown): string {
  if (typeof corpo === "string") return corpo;
  if (corpo && typeof corpo === "object") {
    // O backend padroniza toda falha em {detail, campos, codigo} — ver
    // apps/common/exceptions.py. O restante é fallback para respostas que
    // não passam por aquele handler (proxy, gateway, erro de rede).
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

  let resposta: Response;
  try {
    resposta = await fetch(`${BASE_URL}${caminho}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspace ? { "X-Workspace": workspace } : {}),
        ...init.headers,
      },
    });
  } catch {
    // fetch rejeita com TypeError quando a requisição não sai (offline, DNS,
    // servidor fora). Sem converter aqui, quem chama recebe um TypeError
    // tipado como ApiError e a checagem de status silenciosamente não funciona.
    throw new ApiError(
      "Sem conexão com o servidor. Verifique sua internet.",
      0,
    );
  }

  if (resposta.status === 204) return undefined as T;

  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const envelope = (corpo ?? {}) as { campos?: Record<string, string[]> };
    throw new ApiError(
      extrairMensagem(resposta.status, corpo),
      resposta.status,
      envelope.campos ?? {},
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

/**
 * Igual ao `request`, mas sem forçar Content-Type.
 *
 * Em multipart o navegador precisa definir o cabeçalho sozinho, porque ele
 * inclui o boundary. Definir "application/json" ali faz o servidor receber um
 * corpo que não consegue interpretar.
 */
async function requestBruto<T>(caminho: string, init: RequestInit): Promise<T> {
  const token = await obterToken();
  const workspace = localStorage.getItem("workspace_id");

  let resposta: Response;
  try {
    resposta = await fetch(`${BASE_URL}${caminho}`, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspace ? { "X-Workspace": workspace } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("Sem conexão com o servidor. Verifique sua internet.", 0);
  }

  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const envelope = (corpo ?? {}) as { campos?: Record<string, string[]> };
    throw new ApiError(
      extrairMensagem(resposta.status, corpo),
      resposta.status,
      envelope.campos ?? {},
    );
  }
  return corpo as T;
}

const qs = (params: Record<string, string | undefined>) =>
  new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null) as [string, string][],
  ).toString();

export interface ResultadoBusca {
  tipo: "contrato" | "realizado" | "nota";
  id: string;
  descricao: string;
  subtitulo: string;
  valor: string | null;
  rota: string;
}

export const api = {
  classificacoes: () => lista<Classificacao>("/classificacoes/"),
  salvarClassificacao: (dados: Partial<Classificacao>, id?: string) =>
    request<Classificacao>(id ? `/classificacoes/${id}/` : "/classificacoes/", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(dados),
    }),
  deletarClassificacao: (id: string) =>
    request<void>(`/classificacoes/${id}/`, { method: "DELETE" }),

  categorias: (tipo?: TipoLancamento) =>
    lista<Categoria>(`/categorias/?${qs({ tipo })}`),
  salvarCategoria: (dados: Partial<Categoria>, id?: string) =>
    request<Categoria>(id ? `/categorias/${id}/` : "/categorias/", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(dados),
    }),
  deletarCategoria: (id: string) =>
    request<void>(`/categorias/${id}/`, { method: "DELETE" }),

  estabelecimentos: () => lista<Estabelecimento>("/estabelecimentos/"),
  salvarEstabelecimento: (dados: Partial<Estabelecimento>, id?: string) =>
    request<Estabelecimento>(id ? `/estabelecimentos/${id}/` : "/estabelecimentos/", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(dados),
    }),
  deletarEstabelecimento: (id: string) =>
    request<void>(`/estabelecimentos/${id}/`, { method: "DELETE" }),

  /** Parcelas de todos os contratos no período — alimenta a linha do tempo. */
  parcelas: (filtros: Record<string, string | undefined> = {}) =>
    lista<Parcela>(`/parcelas/?${qs({ page_size: "200", ...filtros })}`),

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

  previsao: (horizonte = 12, saldoInicial = "0") =>
    request<Previsao>(
      `/previsao/?${qs({ horizonte: String(horizonte), saldo_inicial: saldoInicial })}`,
    ),
  modelosPrevisao: () =>
    request<{
      meses_de_historico: number;
      modelos: {
        nome: string;
        descricao: string;
        minimo_observacoes: number;
        disponivel: boolean;
      }[];
    }>("/previsao/modelos/"),

  confronto: (inicio: string, fim: string) =>
    request<Confronto>(`/confronto/?${qs({ inicio, fim })}`),
  saldoARealizar: () => request<SaldoARealizar>("/saldo-a-realizar/"),

  matrizContratos: (inicio: string, fim: string, agrupar_por = "estabelecimento") =>
    request<MatrizContratos>(
      `/matriz-contratos/?${qs({ inicio, fim, agrupar_por })}`,
    ),
  // --- realizados ----------------------------------------------------------
  realizados: (filtros: Record<string, string | undefined> = {}) =>
    lista<Realizado>(`/realizados/?${qs(filtros)}`),
  salvarRealizado: (dados: Partial<Realizado>, id?: string) =>
    request<Realizado>(id ? `/realizados/${id}/` : "/realizados/", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(dados),
    }),
  deletarRealizado: (id: string) =>
    request<void>(`/realizados/${id}/`, { method: "DELETE" }),

  // --- pagamento da nota ---------------------------------------------------
  sugestaoPagamento: (notaId: string) =>
    request<SugestaoPagamento>(`/notas/${notaId}/pagamento/`),
  registrarPagamento: (
    notaId: string,
    dados: {
      forma: string;
      valor?: string;
      cartao?: string | null;
      parcelas?: number;
      categoria?: string | null;
    },
  ) =>
    request<{
      nota: string;
      forma: string;
      compra: string | null;
      parcelas_geradas: number;
      realizado: string | null;
    }>(`/notas/${notaId}/pagamento/`, { method: "POST", body: JSON.stringify(dados) }),
  notasSemPagamento: () =>
    request<{ total: number; valor_total: string; notas: NotaFiscal[] }>(
      "/notas/sem-pagamento/",
    ),

  // --- documentos ----------------------------------------------------------
  tiposDocumento: () =>
    request<{ tipo: string; nome: string }[]>("/documentos/tipos/"),
  documento: (id: string) => request<DocumentoImportado>(`/documentos/${id}/`),
  reprocessarDocumento: (id: string) =>
    request<DocumentoImportado>(`/documentos/${id}/reprocessar/`, { method: "POST" }),

  // --- conciliação ---------------------------------------------------------
  duplicidadesFinanciamento: (id: string) =>
    request<{ duplicidades: Record<string, string>[] }>(
      `/financiamentos/${id}/duplicidades/`,
    ),
  simularVinculoRealizados: () =>
    request<{
      vinculados: Record<string, string>[];
      sem_correspondencia: Record<string, string>[];
      total_orfaos: number;
    }>("/vincular-realizados/"),
  aplicarVinculoRealizados: () =>
    request<{ vinculados: Record<string, string>[] }>("/vincular-realizados/", {
      method: "POST",
    }),

  cartoes: () => lista<Cartao>("/cartoes/"),
  compras: () => lista<Compra>("/compras/"),
  unidadesConsumidoras: () =>
    lista<{
      id: string;
      servico: string;
      codigo_cliente: string;
      apelido: string;
      concessionaria: string;
      contrato: string | null;
    }>("/unidades-consumidoras/"),
  salvarCartao: (dados: Partial<Cartao>, id?: string) =>
    request<Cartao>(id ? `/cartoes/${id}/` : "/cartoes/", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(dados),
    }),

  faturas: (filtros: Record<string, string | undefined> = {}) =>
    lista<Fatura>(`/faturas/?${qs(filtros)}`),
  fatura: (id: string) => request<Fatura>(`/faturas/${id}/`),
  autoConciliarFatura: (id: string) =>
    request<{ conciliados: number; pendentes_restantes: number }>(
      `/faturas/${id}/auto-conciliar/`,
      { method: "POST" },
    ),
  pendenciasFatura: (id: string) =>
    request<{ total: number; sem_categoria: number; lancamentos: LancamentoFatura[] }>(
      `/faturas/${id}/pendencias/`,
    ),

  financiamentos: () => lista<Financiamento>("/financiamentos/"),
  parcelasFinanciamento: (id: string, situacao?: string) =>
    request<ParcelaFinanciamento[]>(
      `/financiamentos/${id}/parcelas/?${qs({ situacao })}`,
    ),

  holerites: () => lista<Holerite>("/holerites/"),
  contasConsumo: () => lista<ContaConsumo>("/contas-consumo/"),
  historicoConsumo: () =>
    request<
      { competencia: string; valor: string; consumo: string | null; tarifa_media: string | null }[]
    >("/contas-consumo/historico/"),

  painelCartoes: (inicio: string, fim: string) =>
    request<PainelCartoes>(`/cartoes/painel/?${qs({ inicio, fim })}`),

  /**
   * Envia um PDF. Vai como multipart, então não passa pelo `request()`, que
   * força Content-Type JSON.
   */
  importarDocumento: async (
    arquivo: File,
    opcoes: { senha?: string; tipo?: string; simular?: boolean } = {},
  ): Promise<DocumentoImportado> => {
    const corpo = new FormData();
    corpo.append("arquivo", arquivo);
    if (opcoes.senha) corpo.append("senha", opcoes.senha);
    if (opcoes.tipo) corpo.append("tipo", opcoes.tipo);
    corpo.append("simular", String(Boolean(opcoes.simular)));
    return requestBruto<DocumentoImportado>("/documentos/importar/", {
      method: "POST",
      body: corpo,
    });
  },
  documentos: () => lista<DocumentoImportado>("/documentos/"),

  despesasPorCategoria: (competencia: string) =>
    request<{ categoria: string; classificacao: string; tipo: string; total: string }[]>(
      `/realizados/por-categoria/?${qs({ competencia })}`,
    ),

  fluxoCaixa: (inicio: string, fim: string, saldoInicial = "0") =>
    request<{ linhas: LinhaFluxo[]; totais: Record<string, string> }>(
      `/fluxo-caixa/?${qs({ inicio, fim, saldo_inicial: saldoInicial })}`,
    ),
  aderencia: (competencia: string) =>
    request<{ competencia: string; linhas: Record<string, unknown>[] }>(
      `/aderencia/?${qs({ competencia })}`,
    ),
  /**
   * Pergunta ao assistente. O backend decide quais consultas fazer no banco —
   * o frontend nunca manda filtro nem SQL, só a pergunta em texto.
   */
  perguntarAssistente: (pergunta: string, conversa?: string | null) =>
    request<RespostaAssistente>("/assistente/perguntar/", {
      method: "POST",
      body: JSON.stringify({ pergunta, conversa: conversa ?? undefined }),
    }),
  capacidadesAssistente: () =>
    request<CapacidadesAssistente>("/assistente/capacidades/"),
  conversas: () =>
    lista<{ id: string; titulo: string; atualizado_em: string }>("/assistente/"),

  realizados: (filtros: Record<string, string | undefined> = {}) =>
    lista<Realizado>(`/realizados/?${qs(filtros)}`),
  salvarRealizado: (dados: Partial<Realizado>, id?: string) =>
    request<Realizado>(id ? `/realizados/${id}/` : "/realizados/", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(dados),
    }),
  deletarRealizado: (id: string) =>
    request<void>(`/realizados/${id}/`, { method: "DELETE" }),

  baixarParcela: (parcela: string, valor: string, data_pagamento: string) =>
    request(`/realizados/baixar-parcela/`, {
      method: "POST",
      body: JSON.stringify({ parcela, valor, data_pagamento }),
    }),
};
