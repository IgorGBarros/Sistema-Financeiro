/**
 * Fila de cupons lidos sem conexão.
 *
 * O caso de uso é concreto: corredor de supermercado, sinal fraco ou ausente.
 * A pessoa lê o QR, o app não consegue falar com a API, e o cupom não pode
 * simplesmente se perder — o papel vai para o lixo na saída da loja.
 *
 * Por que isso é seguro
 * ---------------------
 * O endpoint `notas/scan/` é idempotente pela chave de acesso: reenviar o
 * mesmo cupom devolve a nota existente em vez de duplicar despesa. Isso é o
 * que permite reenviar a fila sem medo, inclusive se o app for fechado no meio
 * do envio e a mesma entrada for tentada duas vezes.
 *
 * Antes de entrar na fila, a chave é validada localmente (dígito verificador,
 * módulo 11). Assim uma leitura corrompida falha na hora, com a pessoa ainda
 * segurando o cupom, e não três horas depois em casa.
 *
 * Por que localStorage e não IndexedDB
 * ------------------------------------
 * A alternativa "correta" seria IndexedDB com Background Sync, para o service
 * worker esvaziar a fila sozinho. Mas o Safari do iOS não implementa Background
 * Sync, e boa parte das leituras vai acontecer justamente em iPhone. Como a
 * fila precisa ser drenada pelo próprio app de qualquer forma, localStorage
 * resolve: as entradas são strings curtas e a escrita é síncrona.
 */

import { validarChaveAcesso } from "@/features/fiscal/nfce";

const CHAVE_ARMAZENAMENTO = "cupons_pendentes";
const MAX_TENTATIVAS = 5;

export interface CupomPendente {
  /** Conteúdo bruto do QR ou a chave de 44 dígitos. */
  conteudo: string;
  /** Chave extraída — identidade da entrada, evita duplicar na própria fila. */
  chave: string;
  lidoEm: string;
  tentativas: number;
  ultimoErro?: string;
}

function ler(): CupomPendente[] {
  try {
    const bruto = localStorage.getItem(CHAVE_ARMAZENAMENTO);
    const dados = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(dados) ? dados : [];
  } catch {
    // Storage corrompido não pode derrubar o app; a fila recomeça vazia.
    return [];
  }
}

function gravar(fila: CupomPendente[]): void {
  try {
    localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(fila));
  } catch (erro) {
    console.error("Não foi possível gravar a fila de cupons", erro);
  }
  avisar();
}

// Assinantes (o indicador na barra superior) reagem a mudanças da fila.
const assinantes = new Set<() => void>();

function avisar() {
  assinantes.forEach((fn) => fn());
}

export function assinarFila(callback: () => void): () => void {
  assinantes.add(callback);
  return () => assinantes.delete(callback);
}

export const listarPendentes = (): CupomPendente[] => ler();
export const quantidadePendente = (): number => ler().length;

/** Devolve false se a chave for inválida ou já estiver na fila. */
export function enfileirar(conteudo: string, chave: string): boolean {
  if (!validarChaveAcesso(chave)) return false;

  const fila = ler();
  if (fila.some((c) => c.chave === chave)) return true; // já enfileirado, tudo bem

  fila.push({
    conteudo,
    chave,
    lidoEm: new Date().toISOString(),
    tentativas: 0,
  });
  gravar(fila);
  return true;
}

export function remover(chave: string): void {
  gravar(ler().filter((c) => c.chave !== chave));
}

export function registrarFalha(chave: string, erro: string): void {
  const fila = ler()
    .map((c) =>
      c.chave === chave
        ? { ...c, tentativas: c.tentativas + 1, ultimoErro: erro }
        : c,
    )
    // Depois de MAX_TENTATIVAS a entrada sai da fila. Insistir para sempre
    // numa chave que a SEFAZ rejeita só faria a fila crescer sem fim.
    .filter((c) => c.tentativas < MAX_TENTATIVAS);
  gravar(fila);
}

export function limpar(): void {
  gravar([]);
}

export interface ResultadoSincronizacao {
  enviados: number;
  falharam: number;
  restantes: number;
}

/**
 * Tenta enviar a fila inteira. Chamada quando a conexão volta e ao abrir o app.
 *
 * Sequencial de propósito: em rede ruim, disparar dez requisições ao mesmo
 * tempo costuma fazer todas expirarem juntas.
 */
export async function sincronizar(
  enviar: (conteudo: string) => Promise<unknown>,
): Promise<ResultadoSincronizacao> {
  const fila = ler();
  let enviados = 0;
  let falharam = 0;

  for (const cupom of fila) {
    try {
      await enviar(cupom.conteudo);
      remover(cupom.chave);
      enviados += 1;
    } catch (erro) {
      registrarFalha(cupom.chave, (erro as Error).message);
      falharam += 1;
    }
  }

  return { enviados, falharam, restantes: quantidadePendente() };
}
