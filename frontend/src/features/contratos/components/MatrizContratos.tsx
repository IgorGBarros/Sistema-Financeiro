import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/shared/lib/api";
import { TabelaMatriz } from "@/shared/components/TabelaMatriz";
import { cn } from "@/shared/lib/utils";

const AGRUPAMENTOS = [
  { valor: "estabelecimento", rotulo: "Estabelecimento" },
  { valor: "categoria", rotulo: "Categoria" },
  { valor: "classificacao", rotulo: "Classificação" },
] as const;

const HORIZONTES = [6, 12, 24];

const iso = (data: Date) => data.toISOString().slice(0, 10);

/**
 * Previsto mês a mês, em formato de tabela dinâmica.
 *
 * Responde o que a lista não responde: o que muda de um mês para o outro,
 * linha a linha. A linha "Acumulado" no rodapé mostra em que mês o saldo
 * atravessa o zero, sem exigir soma de cabeça.
 */
export function MatrizContratos() {
  const [agrupamento, setAgrupamento] =
    useState<(typeof AGRUPAMENTOS)[number]["valor"]>("estabelecimento");
  const [meses, setMeses] = useState(12);

  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + meses - 1, 1);

  const matriz = useQuery({
    queryKey: ["matriz-contratos", agrupamento, meses],
    queryFn: () => api.matrizContratos(iso(inicio), iso(fim), agrupamento),
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-stack-sm border-b border-outline-variant px-stack-md py-stack-sm">
        <span className="rotulo">Agrupar por</span>
        <div className="flex gap-1 rounded-lg bg-surface-container-low p-1">
          {AGRUPAMENTOS.map((opcao) => (
            <button
              key={opcao.valor}
              onClick={() => setAgrupamento(opcao.valor)}
              className={cn(
                "rounded px-3 py-1 text-body-sm transition-colors",
                agrupamento === opcao.valor
                  ? "bg-surface-container-lowest font-semibold text-on-surface shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface",
              )}
            >
              {opcao.rotulo}
            </button>
          ))}
        </div>

        <span className="rotulo ml-stack-md">Período</span>
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

      {matriz.isLoading ? (
        <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
          Montando a matriz…
        </p>
      ) : (
        <>
          <TabelaMatriz
            meses={matriz.data?.meses ?? []}
            linhas={(matriz.data?.linhas ?? []).map((linha) => ({
              id: linha.id,
              nome: linha.nome,
              valores: linha.valores,
            }))}
            totais={matriz.data?.totais}
            acumulado={matriz.data?.acumulado}
            rotuloPrimeiraColuna={
              AGRUPAMENTOS.find((a) => a.valor === agrupamento)?.rotulo ?? "Nome"
            }
            vazio="Nenhum contrato com parcela prevista neste período."
          />
          <p className="border-t border-outline-variant px-stack-md py-stack-sm text-[11px] text-on-surface-variant">
            Entradas em verde, saídas em vermelho. O total de cada mês é o
            resultado: positivo sobra, negativo falta.
          </p>
        </>
      )}
    </div>
  );
}
