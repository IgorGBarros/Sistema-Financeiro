import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, FlaskConical } from "lucide-react";

import { api, type Parcela } from "@/shared/lib/api";
import { formatarMoeda } from "@/features/fiscal/nfce";
import { cn } from "@/shared/lib/utils";

const MESES_A_FRENTE = 3;

function iso(data: Date) {
  return data.toISOString().slice(0, 10);
}

function competenciaLonga(chave: string) {
  const [ano, mes] = chave.split("-").map(Number);
  const texto = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(ano, mes - 1, 1));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

const diaCurto = (isoData: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" })
    .format(new Date(`${isoData}T12:00:00`))
    .replace(".", "");

/**
 * Linha do tempo das parcelas previstas dos próximos meses.
 *
 * Uma requisição só para todas as parcelas do período, agrupadas no cliente.
 * Buscar por contrato seria N+1 na rede para montar uma única lista.
 */
export function PainelProjecao() {
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + MESES_A_FRENTE - 1, 1);

  const parcelas = useQuery({
    queryKey: ["parcelas", iso(inicio), iso(fim)],
    queryFn: () => api.parcelas({ inicio: iso(inicio), fim: iso(fim) }),
  });

  const { meses, saldo } = useMemo(() => {
    const porMes = new Map<string, Parcela[]>();
    let total = 0;

    for (const parcela of parcelas.data ?? []) {
      const chave = parcela.competencia.slice(0, 7);
      if (!porMes.has(chave)) porMes.set(chave, []);
      porMes.get(chave)!.push(parcela);
      total +=
        Number(parcela.valor_previsto) * (parcela.tipo === "RECEITA" ? 1 : -1);
    }

    return {
      meses: [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b)),
      saldo: total,
    };
  }, [parcelas.data]);

  const mesCorrente = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div className="cartao relative flex flex-col overflow-hidden shadow-panel">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-secondary-container to-surface-dim" />

      <div className="flex items-center justify-between border-b border-outline-variant bg-surface p-stack-md">
        <div>
          <h2 className="flex items-center gap-2 text-headline-sm text-on-surface">
            <CalendarClock className="h-5 w-5 text-secondary" />
            Projeção materializada
          </h2>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Próximos {MESES_A_FRENTE} meses, gerados a partir da vigência dos contratos
          </p>
        </div>
        <span
          className="rounded p-1 text-on-surface-variant"
          title="A projeção é derivada dos contratos e não pode ser editada aqui"
        >
          <FlaskConical className="h-5 w-5" />
        </span>
      </div>

      <div className="flex-1 overflow-y-auto bg-surface-bright p-stack-md lg:max-h-[540px]">
        {parcelas.isLoading ? (
          <p className="py-8 text-center text-body-sm text-on-surface-variant">
            Carregando projeção…
          </p>
        ) : meses.length === 0 ? (
          <p className="py-8 text-center text-body-sm text-on-surface-variant">
            Nenhuma parcela prevista para o período. Cadastre um contrato com
            vigência que alcance estes meses.
          </p>
        ) : (
          <div className="relative ml-2 space-y-stack-md border-l-2 border-outline-variant pl-6">
            {meses.map(([chave, doMes]) => {
              const atual = chave === mesCorrente;
              return (
                <section key={chave} className="relative">
                  <span
                    className={cn(
                      "absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-surface-bright",
                      atual ? "bg-secondary-container" : "bg-outline-variant",
                    )}
                  >
                    {atual && (
                      <span className="h-1.5 w-1.5 rounded-full bg-on-secondary-container" />
                    )}
                  </span>

                  <h3
                    className={cn(
                      "mb-stack-sm text-label-caps uppercase",
                      atual ? "text-on-surface" : "text-on-surface-variant",
                    )}
                  >
                    {competenciaLonga(chave)}
                  </h3>

                  <div className="space-y-stack-sm">
                    {doMes.map((parcela) => {
                      const receita = parcela.tipo === "RECEITA";
                      return (
                        <article
                          key={parcela.id}
                          className={cn(
                            "relative overflow-hidden rounded-lg border bg-surface-container-lowest p-stack-sm transition-colors",
                            receita
                              ? "border-receita/30 hover:border-receita"
                              : "border-outline-variant hover:border-secondary",
                            parcela.pago && "opacity-60",
                          )}
                        >
                          {receita && (
                            <span className="absolute inset-y-0 left-0 w-1 bg-receita" />
                          )}
                          <div
                            className={cn(
                              "mb-1 flex items-start justify-between gap-2",
                              receita && "pl-2",
                            )}
                          >
                            <span className="truncate text-body-sm font-medium text-on-surface">
                              {parcela.contrato_descricao}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 tabular",
                                receita ? "text-receita" : "text-despesa",
                              )}
                            >
                              {receita ? "+" : "−"} {formatarMoeda(parcela.valor_previsto)}
                            </span>
                          </div>
                          <div
                            className={cn(
                              "flex items-center justify-between text-[11px] text-on-surface-variant",
                              receita && "pl-2",
                            )}
                          >
                            <span>
                              {parcela.pago ? "Pago" : "Vence"} {diaCurto(parcela.data_planejada)}
                            </span>
                            <span className="rounded bg-surface-container-high px-1.5 py-0.5 font-medium tabular">
                              {parcela.indice + 1}/{parcela.quantidade_planejada}
                            </span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-outline-variant bg-surface-container-low p-stack-md">
        <span className="text-body-sm text-on-surface-variant">
          Resultado projetado ({MESES_A_FRENTE} meses)
        </span>
        <span
          className={cn(
            "text-headline-sm font-bold tabular",
            saldo >= 0 ? "text-receita" : "text-despesa",
          )}
        >
          {saldo >= 0 ? "+" : "−"} {formatarMoeda(Math.abs(saldo))}
        </span>
      </div>
    </div>
  );
}
