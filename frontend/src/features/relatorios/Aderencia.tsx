import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { api } from "@/shared/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Kpi } from "@/shared/components/Kpi";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

const iso = (d: Date) => d.toISOString().slice(0, 10);

function mudarMes(mes: string, passo: number) {
  const [ano, m] = mes.split("-").map(Number);
  return iso(new Date(ano, m - 1 + passo, 1));
}

interface LinhaAderencia {
  contrato_id: string;
  descricao: string;
  categoria: string;
  classificacao: string;
  tipo: "RECEITA" | "DESPESA";
  previsto: string;
  realizado: string;
  desvio: string;
  desvio_pct: string | null;
}

export default function Aderencia() {
  const hoje = new Date();
  const [mes, setMes] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)));

  const aderencia = useQuery({
    queryKey: ["aderencia", mes],
    queryFn: () => api.aderencia(mes),
  });

  const linhas = (aderencia.data?.linhas ?? []) as unknown as LinhaAderencia[];

  const totais = linhas.reduce(
    (acc, l) => ({
      previsto: acc.previsto + Number(l.previsto),
      realizado: acc.realizado + Number(l.realizado),
    }),
    { previsto: 0, realizado: 0 },
  );

  const adherentes = linhas.filter(
    (l) => l.desvio_pct !== null && Math.abs(Number(l.desvio_pct)) <= 5,
  );
  const pctAderencia = linhas.length
    ? Math.round((adherentes.length / linhas.length) * 100)
    : 0;

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Aderência ao planejado"
        descricao="Previsto × realizado contrato a contrato. Desvios acima de 5% destacados em vermelho."
        acoes={
          <div className="flex items-center gap-1 rounded-lg bg-surface-container-low p-1">
            <Button variant="ghost" size="sm" onClick={() => setMes((m) => mudarMes(m, -1))}>←</Button>
            <span className="min-w-28 text-center text-body-sm font-semibold">
              {formatarCompetencia(mes)}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setMes((m) => mudarMes(m, 1))}>→</Button>
          </div>
        }
      />

      <div className="mb-container-padding grid grid-cols-1 gap-container-padding md:grid-cols-3">
        <Kpi
          rotulo="Total previsto"
          valor={formatarMoeda(totais.previsto)}
          icone={Minus}
          carregando={aderencia.isLoading}
        />
        <Kpi
          rotulo="Total realizado"
          valor={formatarMoeda(totais.realizado)}
          icone={totais.realizado >= totais.previsto ? ArrowUp : ArrowDown}
          tom={totais.realizado >= totais.previsto ? "receita" : "despesa"}
          carregando={aderencia.isLoading}
        />
        <Kpi
          rotulo="Contratos adherentes (±5%)"
          valor={`${pctAderencia}%`}
          icone={Minus}
          tom={pctAderencia >= 80 ? "receita" : pctAderencia >= 50 ? "neutro" : "despesa"}
          apoio={`${adherentes.length} de ${linhas.length} contratos`}
          carregando={aderencia.isLoading}
        />
      </div>

      <section className="cartao overflow-hidden">
        <div className="border-b border-outline-variant bg-surface p-stack-md">
          <h2 className="text-headline-sm text-on-surface">Detalhamento por contrato</h2>
        </div>

        {aderencia.isLoading ? (
          <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">Carregando…</p>
        ) : linhas.length === 0 ? (
          <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
            Nenhuma parcela prevista em {formatarCompetencia(mes)}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  <th className="rotulo px-gutter-table py-2">Contrato</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Previsto</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Realizado</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Desvio</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Desvio %</th>
                </tr>
              </thead>
              <tbody className="text-body-sm">
                {linhas.map((l) => {
                  const desvio = Number(l.desvio);
                  const pct = l.desvio_pct !== null ? Number(l.desvio_pct) : null;
                  const critico = pct !== null && Math.abs(pct) > 5;
                  return (
                    <tr
                      key={l.contrato_id}
                      className={cn(
                        "h-[40px] border-b border-outline-variant",
                        critico && "bg-despesa-surface/30",
                      )}
                    >
                      <td className="px-gutter-table">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full",
                              l.tipo === "RECEITA" ? "bg-receita" : "bg-despesa",
                            )}
                          />
                          <div>
                            <p className="truncate font-medium text-on-surface">{l.descricao}</p>
                            <p className="truncate text-[11px] text-on-surface-variant">
                              {l.categoria} · {l.classificacao}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-gutter-table text-right tabular text-on-surface-variant">
                        {formatarMoeda(l.previsto)}
                      </td>
                      <td className={cn(
                        "px-gutter-table text-right tabular",
                        l.tipo === "RECEITA" ? "text-receita" : "text-despesa",
                      )}>
                        {formatarMoeda(l.realizado)}
                      </td>
                      <td className={cn(
                        "px-gutter-table text-right tabular font-semibold",
                        desvio > 0 ? "text-receita" : desvio < 0 ? "text-despesa" : "text-on-surface-variant",
                      )}>
                        {desvio >= 0 ? "+" : ""}{formatarMoeda(Math.abs(desvio))}
                      </td>
                      <td className={cn(
                        "px-gutter-table text-right tabular",
                        critico ? "font-bold text-despesa" : "text-on-surface-variant",
                      )}>
                        {pct !== null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
