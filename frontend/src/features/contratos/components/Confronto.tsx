import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";

import { api } from "@/shared/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { Selo } from "@/shared/components/Selo";
import { cn } from "@/shared/lib/utils";

const HORIZONTES = [6, 12, 24];
const iso = (data: Date) => data.toISOString().slice(0, 10);

/**
 * Previsto, realizado e efetivo lado a lado.
 *
 * A coluna que importa é a "efetiva": em mês fechado ela é o realizado, em mês
 * aberto é o maior entre os dois. É ela que pode ser somada sem contar o mesmo
 * dinheiro duas vezes.
 */
export function Confronto() {
  const [meses, setMeses] = useState(12);
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - Math.floor(meses / 2), 1);
  const fim = new Date(inicio.getFullYear(), inicio.getMonth() + meses - 1, 1);

  const confronto = useQuery({
    queryKey: ["confronto", meses],
    queryFn: () => api.confronto(iso(inicio), iso(fim)),
  });

  const saldo = useQuery({
    queryKey: ["saldo-a-realizar"],
    queryFn: () => api.saldoARealizar(),
  });

  const emAberto = saldo.data?.linhas.filter((l) => Number(l.em_aberto) > 0) ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-stack-sm border-b border-outline-variant px-stack-md py-stack-sm">
        <span className="rotulo">Período</span>
        <div className="flex gap-1 rounded-lg bg-surface-container-low p-1">
          {HORIZONTES.map((n) => (
            <button
              key={n}
              onClick={() => setMeses(n)}
              className={cn(
                "rounded px-3 py-1 text-body-sm transition-colors",
                meses === n
                  ? "bg-surface-container-lowest font-semibold text-on-surface shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface",
              )}
            >
              {n}m
            </button>
          ))}
        </div>
      </div>

      {confronto.isLoading ? (
        <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
          Carregando…
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low">
                <th className="rotulo px-gutter-table py-2">Mês</th>
                <th className="rotulo px-gutter-table py-2 text-right">Previsto</th>
                <th className="rotulo px-gutter-table py-2 text-right">Realizado</th>
                <th className="rotulo px-gutter-table py-2 text-right">Desvio</th>
                <th className="rotulo border-l border-outline-variant px-gutter-table py-2 text-right">
                  Efetivo
                </th>
                <th className="rotulo px-gutter-table py-2 text-right">Saldo acum.</th>
              </tr>
            </thead>
            <tbody className="text-body-sm">
              {confronto.data?.linhas.map((linha) => {
                const desvio = Number(linha.despesa_desvio);
                const acumulado = Number(linha.saldo_acumulado);
                return (
                  <tr
                    key={linha.competencia}
                    className={cn(
                      "h-[36px] border-b border-outline-variant",
                      !linha.fechada && "bg-surface-container-low/50",
                    )}
                  >
                    <td className="px-gutter-table">
                      <span className="text-on-surface">
                        {formatarCompetencia(linha.competencia)}
                      </span>
                      {!linha.fechada && (
                        <Selo className="ml-2">em aberto</Selo>
                      )}
                    </td>
                    <td className="px-gutter-table text-right tabular text-on-surface-variant">
                      {formatarMoeda(linha.despesa_prevista)}
                    </td>
                    <td className="px-gutter-table text-right tabular text-on-surface-variant">
                      {Number(linha.despesa_realizada)
                        ? formatarMoeda(linha.despesa_realizada)
                        : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-gutter-table text-right tabular",
                        desvio > 0 ? "text-despesa" : desvio < 0 ? "text-receita" : "text-on-surface-variant/40",
                      )}
                    >
                      {desvio ? `${desvio > 0 ? "+" : "−"} ${formatarMoeda(Math.abs(desvio))}` : "—"}
                    </td>
                    <td className="border-l border-outline-variant px-gutter-table text-right tabular font-medium">
                      {formatarMoeda(linha.despesa_efetiva)}
                    </td>
                    <td
                      className={cn(
                        "px-gutter-table text-right tabular",
                        acumulado < 0 ? "text-despesa" : "text-receita",
                      )}
                    >
                      {formatarMoeda(Math.abs(acumulado))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-outline-variant bg-surface-container-low px-stack-md py-stack-sm">
        <p className="flex items-start gap-2 text-[11px] text-on-surface-variant">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Em mês fechado, o efetivo é o realizado — se o mês passou e nada foi
            pago, a despesa não aconteceu. Em mês aberto, vale o maior entre
            previsto e realizado, porque o resto ainda pode chegar.
          </span>
        </p>
      </div>

      {emAberto.length > 0 && (
        <div className="border-t border-outline-variant">
          <div className="bg-surface p-stack-md">
            <h3 className="text-headline-sm text-on-surface">
              Previsto que não se concretizou
            </h3>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Contas previstas em meses já fechados sem pagamento registrado.
              Pode ser lançamento faltando, ou conta que realmente não foi paga.
            </p>
          </div>
          <table className="w-full border-collapse text-left">
            <tbody className="text-body-sm">
              {emAberto.slice(0, 8).map((linha) => (
                <tr key={linha.contrato} className="h-[36px] border-t border-outline-variant">
                  <td className="px-gutter-table">
                    <p className="text-on-surface">{linha.descricao}</p>
                    <p className="text-[11px] text-on-surface-variant">
                      {linha.estabelecimento}
                    </p>
                  </td>
                  <td className="px-gutter-table text-right tabular text-on-surface-variant">
                    previsto {formatarMoeda(linha.previsto_ate_agora)}
                  </td>
                  <td className="px-gutter-table text-right tabular text-on-surface-variant">
                    pago {formatarMoeda(linha.realizado)}
                  </td>
                  <td className="px-gutter-table text-right tabular font-medium text-despesa">
                    {formatarMoeda(linha.em_aberto)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
