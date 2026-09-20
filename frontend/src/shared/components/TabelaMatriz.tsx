import { useMemo } from "react";

import { formatarMoeda } from "@/features/fiscal/nfce";
import { cn } from "@/shared/lib/utils";

export interface ColunaExtra {
  chave: string;
  rotulo: string;
  /** Alinhamento à direita por padrão; use "left" para texto. */
  alinhamento?: "left" | "right";
}

export interface LinhaMatriz {
  id: string;
  nome: string;
  /** Colunas fixas (limite, disponível...) antes ou depois dos meses. */
  extras?: Record<string, string | number | null>;
  valores: Record<string, string | number>;
  total?: string | number;
  destaque?: boolean;
}

interface Props {
  meses: string[];
  linhas: LinhaMatriz[];
  totais?: Record<string, string | number>;
  /** Segunda linha de rodapé — normalmente o acumulado. */
  acumulado?: Record<string, string | number>;
  colunasAntes?: ColunaExtra[];
  colunasDepois?: ColunaExtra[];
  rotuloPrimeiraColuna?: string;
  /** Pinta valor negativo de vermelho e positivo de verde. */
  colorirSinal?: boolean;
  vazio?: React.ReactNode;
  /** Callback disparado ao clicar em uma linha; recebe o id da linha. */
  aoClicarLinha?: (id: string) => void;
}

const rotuloMes = (iso: string) => {
  const [ano, mes] = iso.split("-");
  return `${mes}/${ano.slice(2)}`;
};

function Celula({ valor, colorir }: { valor: string | number | null | undefined; colorir: boolean }) {
  const numero = Number(valor ?? 0);
  if (!numero) {
    // Zero vira travessão: uma coluna de "0,00" repetido esconde onde há
    // movimento de verdade.
    return <span className="text-on-surface-variant/40">—</span>;
  }
  return (
    <span
      className={cn(
        colorir && (numero > 0 ? "text-receita" : "text-despesa"),
      )}
    >
      {formatarMoeda(Math.abs(numero))}
    </span>
  );
}

/**
 * Tabela de linhas × meses.
 *
 * A primeira coluna e as colunas extras ficam fixas na rolagem horizontal.
 * Sem isso, rolar até dezembro faz perder de vista de quem é a linha — e o
 * número sozinho não diz nada.
 */
export function TabelaMatriz({
  meses,
  linhas,
  totais,
  acumulado,
  colunasAntes = [],
  colunasDepois = [],
  rotuloPrimeiraColuna = "Nome",
  colorirSinal = true,
  vazio,
  aoClicarLinha,
}: Props) {
  const larguraFixa = useMemo(
    () => 224 + colunasAntes.length * 88,
    [colunasAntes.length],
  );

  if (linhas.length === 0) {
    return (
      <div className="p-stack-lg text-center text-body-sm text-on-surface-variant">
        {vazio ?? "Nada para mostrar neste período."}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-outline-variant bg-surface-container-low">
            <th
              className="rotulo sticky left-0 z-10 bg-surface-container-low px-gutter-table py-2"
              style={{ minWidth: 224 }}
            >
              {rotuloPrimeiraColuna}
            </th>
            {colunasAntes.map((coluna) => (
              <th
                key={coluna.chave}
                className="rotulo whitespace-nowrap px-gutter-table py-2 text-center"
              >
                {coluna.rotulo}
              </th>
            ))}
            {meses.map((mes) => (
              <th
                key={mes}
                className="rotulo whitespace-nowrap px-gutter-table py-2 text-right"
              >
                {rotuloMes(mes)}
              </th>
            ))}
            {colunasDepois.map((coluna) => (
              <th
                key={coluna.chave}
                className="rotulo whitespace-nowrap border-l border-outline-variant px-gutter-table py-2 text-right"
              >
                {coluna.rotulo}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="text-body-sm">
          {linhas.map((linha) => (
            <tr
              key={linha.id}
              onClick={aoClicarLinha ? () => aoClicarLinha(linha.id) : undefined}
              className={cn(
                "h-[36px] border-b border-outline-variant transition-colors hover:bg-surface-container-low",
                linha.destaque && "font-semibold",
                aoClicarLinha && "cursor-pointer",
              )}
            >
              <td
                className="sticky left-0 z-10 truncate bg-surface-container-lowest px-gutter-table text-on-surface"
                style={{ minWidth: 224, maxWidth: larguraFixa }}
              >
                {linha.nome}
              </td>
              {colunasAntes.map((coluna) => (
                <td
                  key={coluna.chave}
                  className="whitespace-nowrap px-gutter-table text-center tabular text-on-surface-variant"
                >
                  {linha.extras?.[coluna.chave] ?? "—"}
                </td>
              ))}
              {meses.map((mes) => (
                <td key={mes} className="px-gutter-table text-right tabular">
                  <Celula valor={linha.valores[mes]} colorir={colorirSinal} />
                </td>
              ))}
              {colunasDepois.map((coluna) => (
                <td
                  key={coluna.chave}
                  className="whitespace-nowrap border-l border-outline-variant px-gutter-table text-right tabular text-on-surface"
                >
                  {linha.extras?.[coluna.chave] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>

        {(totais || acumulado) && (
          <tfoot>
            {totais && (
              <tr className="border-t-2 border-outline bg-surface-container-low font-semibold">
                <td
                  className="sticky left-0 z-10 bg-surface-container-low px-gutter-table py-2"
                  style={{ minWidth: 224 }}
                >
                  Total
                </td>
                {colunasAntes.map((c) => (
                  <td key={c.chave} />
                ))}
                {meses.map((mes) => (
                  <td key={mes} className="px-gutter-table py-2 text-right tabular">
                    <Celula valor={totais[mes]} colorir={colorirSinal} />
                  </td>
                ))}
                {colunasDepois.map((c) => (
                  <td key={c.chave} className="border-l border-outline-variant" />
                ))}
              </tr>
            )}
            {acumulado && (
              <tr className="bg-surface-container-low text-on-surface-variant">
                <td
                  className="sticky left-0 z-10 bg-surface-container-low px-gutter-table py-2"
                  style={{ minWidth: 224 }}
                  title="Soma dos meses anteriores mais o mês corrente"
                >
                  Acumulado
                </td>
                {colunasAntes.map((c) => (
                  <td key={c.chave} />
                ))}
                {meses.map((mes) => (
                  <td key={mes} className="px-gutter-table py-2 text-right tabular">
                    <Celula valor={acumulado[mes]} colorir={colorirSinal} />
                  </td>
                ))}
                {colunasDepois.map((c) => (
                  <td key={c.chave} className="border-l border-outline-variant" />
                ))}
              </tr>
            )}
          </tfoot>
        )}
      </table>
    </div>
  );
}
