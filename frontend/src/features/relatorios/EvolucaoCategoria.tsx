import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { api, type LinhaEvolucaoCategoria } from "@/shared/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { cn } from "@/shared/lib/utils";

const HORIZONTES = [3, 6, 12];

const CORES = [
  "#0058be", "#137333", "#7b2d9f", "#c05e00", "#006c7a",
  "#8b3a3a", "#1a6b5a", "#4a4a00", "#5c3d6e", "#2d5a8e",
];

export default function EvolucaoCategoria() {
  const [meses, setMeses] = useState(6);
  const [categoriasFiltro, setCategoriasFiltro] = useState<Set<string>>(new Set());

  const evolucao = useQuery({
    queryKey: ["evolucao-categoria", meses],
    queryFn: () => api.evolucaoPorCategoria(meses),
  });

  // Pivotar linhas em { competencia, [categoria]: total }
  const { mesesLista, categorias, dadosPivo } = useMemo(() => {
    const linhas: LinhaEvolucaoCategoria[] = evolucao.data ?? [];

    const mesesSet = new Set<string>();
    const catSet = new Set<string>();
    for (const l of linhas) {
      mesesSet.add(l.competencia);
      catSet.add(l.categoria);
    }

    const mesesOrdenados = Array.from(mesesSet).sort();
    const categoriasOrdenadas = Array.from(catSet).sort();

    const pivo: Record<string, Record<string, number>> = {};
    for (const m of mesesOrdenados) {
      pivo[m] = {};
    }
    for (const l of linhas) {
      pivo[l.competencia][l.categoria] = Number(l.total);
    }

    const dadosPivo = mesesOrdenados.map((m) => ({
      mes: formatarCompetencia(m),
      ...pivo[m],
    }));

    return { mesesLista: mesesOrdenados, categorias: categoriasOrdenadas, dadosPivo };
  }, [evolucao.data]);

  const categoriasFiltradas =
    categoriasFiltro.size === 0
      ? categorias
      : categorias.filter((c) => categoriasFiltro.has(c));

  function toggleCategoria(cat: string) {
    setCategoriasFiltro((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Evolução por categoria"
        descricao="Como cada categoria de despesa variou ao longo dos meses."
        acoes={
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
        }
      />

      {categorias.length > 0 && (
        <div className="mb-container-padding flex flex-wrap gap-1.5">
          {categorias.map((cat, i) => (
            <button
              key={cat}
              onClick={() => toggleCategoria(cat)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-body-sm transition-colors",
                categoriasFiltro.has(cat) || categoriasFiltro.size === 0
                  ? "border-transparent font-medium text-white"
                  : "border-outline-variant bg-surface text-on-surface-variant opacity-40",
              )}
              style={
                categoriasFiltro.has(cat) || categoriasFiltro.size === 0
                  ? { background: CORES[i % CORES.length] }
                  : undefined
              }
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {evolucao.isLoading ? (
        <p className="py-stack-xl text-center text-body-sm text-on-surface-variant">
          Carregando…
        </p>
      ) : categoriasFiltradas.length === 0 ? (
        <p className="py-stack-xl text-center text-body-sm text-on-surface-variant">
          Nenhum dado de despesa nos últimos {meses} meses.
        </p>
      ) : (
        <div className="cartao p-container-padding">
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dadosPivo} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="mes" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                />
                <Tooltip formatter={(v: number, nome) => [formatarMoeda(v), nome]} labelClassName="font-medium" />
                <Legend />
                {categoriasFiltradas.map((cat, i) => (
                  <Line
                    key={cat}
                    type="monotone"
                    dataKey={cat}
                    stroke={CORES[categorias.indexOf(cat) % CORES.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Tabela resumo */}
          <div className="mt-container-padding overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  <th className="rotulo px-gutter-table py-2">Categoria</th>
                  {mesesLista.map((m) => (
                    <th key={m} className="rotulo px-gutter-table py-2 text-right">
                      {formatarCompetencia(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-body-sm">
                {categoriasFiltradas.map((cat) => (
                  <tr key={cat} className="h-[40px] border-b border-outline-variant">
                    <td className="px-gutter-table font-medium text-on-surface">{cat}</td>
                    {mesesLista.map((m) => {
                      const val = (evolucao.data ?? []).find(
                        (l) => l.competencia === m && l.categoria === cat,
                      );
                      return (
                        <td key={m} className="px-gutter-table text-right tabular text-despesa">
                          {val ? formatarMoeda(val.total) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
