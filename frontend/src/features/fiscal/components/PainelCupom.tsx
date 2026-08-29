import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Receipt } from "lucide-react";

import { api } from "@/shared/lib/api";
import { formatarChave, formatarCnpj, formatarMoeda } from "@/features/fiscal/nfce";
import { Button } from "@/shared/ui/button";

const dataHora = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso))
    : "—";

/**
 * Detalhe do cupom selecionado.
 *
 * Fica fixo na lateral em telas grandes para que a lista continue visível
 * enquanto se compara um cupom com outro.
 */
export function PainelCupom({
  notaId,
  onFechar,
}: {
  notaId: string | null;
  onFechar: () => void;
}) {
  const nota = useQuery({
    queryKey: ["nota", notaId],
    queryFn: () => api.nota(notaId!),
    enabled: Boolean(notaId),
  });

  if (!notaId) {
    return (
      <div className="cartao flex h-full min-h-[320px] flex-col items-center justify-center gap-2 p-container-padding text-center lg:sticky lg:top-[88px]">
        <Receipt className="h-8 w-8 text-on-surface-variant" />
        <p className="text-body-sm text-on-surface-variant">
          Escolha um cupom na lista para ver os itens e os tributos.
        </p>
      </div>
    );
  }

  const dados = nota.data;

  return (
    <div className="cartao flex flex-col overflow-hidden shadow-panel lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-120px)]">
      <div className="flex items-start justify-between gap-2 border-b border-outline-variant bg-surface-bright p-container-padding">
        <div className="min-w-0">
          <h2 className="text-headline-sm text-on-surface">Detalhes do cupom</h2>
          {dados && (
            <p className="mt-1 break-all font-mono text-[11px] leading-4 text-on-surface-variant">
              {formatarChave(dados.chave_acesso)}
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onFechar}>
          Fechar
        </Button>
      </div>

      {nota.isLoading ? (
        <p className="p-container-padding text-body-sm text-on-surface-variant">
          Carregando…
        </p>
      ) : !dados ? (
        <p className="p-container-padding text-body-sm text-on-surface-variant">
          Não consegui carregar este cupom.
        </p>
      ) : (
        <>
          <div className="flex flex-1 flex-col gap-stack-lg overflow-y-auto p-container-padding">
            <div>
              <p className="rotulo mb-unit">Emitente</p>
              <p className="text-body-lg font-medium text-on-surface">
                {dados.nome_emitente || "Não informado"}
              </p>
              <p className="mt-1 tabular text-on-surface-variant">
                CNPJ: {formatarCnpj(dados.cnpj_emitente)}
              </p>
              {dados.municipio && (
                <p className="text-body-sm text-on-surface-variant">{dados.municipio}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-stack-md rounded-lg border border-outline-variant bg-surface-container px-4 py-3">
              <div>
                <p className="rotulo">Emissão</p>
                <p className="mt-1 tabular text-on-surface">{dataHora(dados.data_emissao)}</p>
              </div>
              <div>
                <p className="rotulo">Protocolo</p>
                <p className="mt-1 truncate tabular text-on-surface">
                  {dados.protocolo || "—"}
                </p>
              </div>
            </div>

            {dados.status === "ERRO" && (
              <div className="rounded-lg border border-error/40 bg-error-container p-stack-sm">
                <p className="text-body-sm text-on-error-container">
                  A SEFAZ não respondeu na importação, então os itens não vieram.
                  Os dados acima foram extraídos da própria chave de acesso.
                </p>
              </div>
            )}

            <div>
              <div className="mb-stack-md flex items-end justify-between border-b border-outline-variant pb-2">
                <h3 className="text-headline-sm text-on-surface">Itens</h3>
                <span className="text-body-sm text-on-surface-variant">
                  {dados.quantidade_itens} item{dados.quantidade_itens === 1 ? "" : "ns"}
                </span>
              </div>

              {(dados.itens ?? []).length === 0 ? (
                <p className="text-body-sm text-on-surface-variant">
                  Os itens ainda não foram carregados.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {dados.itens!.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-body-md text-on-surface">{item.descricao}</p>
                        <p className="text-[11px] tabular text-on-surface-variant">
                          {Number(item.quantidade).toLocaleString("pt-BR")} {item.unidade} ×{" "}
                          {formatarMoeda(item.valor_unitario)}
                        </p>
                      </div>
                      <span className="shrink-0 font-medium tabular text-on-surface">
                        {formatarMoeda(item.valor_total)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-outline-variant bg-surface-container-low p-4">
              <div className="flex justify-between text-body-md text-on-surface-variant">
                <span>Descontos</span>
                <span className="tabular">{formatarMoeda(dados.valor_desconto ?? 0)}</span>
              </div>
              <div className="flex justify-between border-t border-outline-variant/50 pt-2 text-body-md text-on-surface-variant">
                <span>Tributos incidentes (Lei 12.741/12)</span>
                <span className="tabular">{formatarMoeda(dados.valor_tributos ?? 0)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-outline-variant pt-2 text-headline-sm font-bold text-on-surface">
                <span>Total</span>
                <span className="tabular">{formatarMoeda(dados.valor_total)}</span>
              </div>
            </div>
          </div>

          <div className="border-t border-outline-variant bg-surface-container-lowest p-container-padding">
            {/* Sem botões de imprimir e baixar XML: nós não temos o XML — só o
                HTML raspado do portal. Um botão que promete XML e entrega
                outra coisa é pior que a ausência dele. O link leva ao
                documento oficial na SEFAZ, esse sim autêntico. */}
            <Button variant="outline" className="w-full" asChild>
              <a href={dados.qr_url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Abrir na SEFAZ
              </a>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
