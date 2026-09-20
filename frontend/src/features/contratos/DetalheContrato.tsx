import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, Clock } from "lucide-react";

import { api, type Contrato } from "@/shared/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Kpi } from "@/shared/components/Kpi";
import { Selo } from "@/shared/components/Selo";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

const FREQUENCIAS: Record<string, string> = {
  M: "Mensal", B: "Bimestral", T: "Trimestral",
  S: "Semestral", A: "Anual", U: "Única",
};

const dataCurta = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(
    new Date(`${iso}T12:00:00`),
  );

export default function DetalheContrato() {
  const { id } = useParams<{ id: string }>();

  const contratosQ = useQuery({
    queryKey: ["contratos", {}],
    queryFn: () => api.contratos(),
  });

  const parcelasQ = useQuery({
    queryKey: ["parcelas-contrato", id],
    queryFn: () => api.parcelas({ contrato: id!, page_size: "200" }),
    enabled: Boolean(id),
  });

  const contrato: Contrato | undefined = useMemo(
    () => contratosQ.data?.find((c) => c.id === id),
    [contratosQ.data, id],
  );

  const parcelas = parcelasQ.data ?? [];
  const pagas = parcelas.filter((p) => p.pago);
  const emAberto = parcelas.filter((p) => !p.pago);
  const valorPago = pagas.reduce((t, p) => t + Number(p.valor_previsto), 0);
  const valorFuturo = emAberto.reduce((t, p) => t + Number(p.valor_previsto), 0);

  if (contratosQ.isLoading || parcelasQ.isLoading) {
    return (
      <p className="p-container-padding text-center text-body-sm text-on-surface-variant">
        Carregando…
      </p>
    );
  }

  if (!contrato) {
    return (
      <div className="p-container-padding text-center">
        <p className="text-body-sm text-on-surface-variant">Contrato não encontrado.</p>
        <Button variant="outline" className="mt-stack-md" asChild>
          <Link to="/contratos">Voltar</Link>
        </Button>
      </div>
    );
  }

  const receita = contrato.tipo === "RECEITA";

  return (
    <div className="p-container-padding">
      <Button variant="ghost" size="sm" className="mb-stack-sm" asChild>
        <Link to="/contratos">
          <ChevronLeft className="mr-1 h-4 w-4" />
          Contratos
        </Link>
      </Button>

      <CabecalhoPagina
        titulo={contrato.descricao}
        descricao={`${contrato.estabelecimento_nome} · ${contrato.classificacao_nome} · ${FREQUENCIAS[contrato.frequencia] ?? contrato.frequencia}`}
      />

      <div className="mb-container-padding grid grid-cols-2 gap-container-padding md:grid-cols-4">
        <Kpi
          rotulo="Parcela"
          valor={formatarMoeda(contrato.valor_unitario)}
          icone={receita ? Check : Clock}
          tom={receita ? "receita" : "despesa"}
        />
        <Kpi
          rotulo="Total do contrato"
          valor={formatarMoeda(contrato.valor_total_contrato)}
          icone={Clock}
          apoio={`${contrato.quantidade_parcelas} parcela(s)`}
        />
        <Kpi
          rotulo="Já pago / recebido"
          valor={valorPago > 0 ? formatarMoeda(valorPago) : "—"}
          icone={Check}
          tom="receita"
          apoio={`${pagas.length} parcela(s)`}
        />
        <Kpi
          rotulo="Em aberto"
          valor={valorFuturo > 0 ? formatarMoeda(valorFuturo) : "—"}
          icone={Clock}
          tom={valorFuturo > 0 ? "despesa" : "neutro"}
          apoio={`${emAberto.length} parcela(s)`}
        />
      </div>

      <div className="cartao overflow-hidden">
        <div className="border-b border-outline-variant bg-surface p-stack-md">
          <h2 className="text-headline-sm text-on-surface">
            Linha do tempo — {parcelas.length} parcela(s)
          </h2>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Vigência de {dataCurta(contrato.data_inicio)} a {dataCurta(contrato.data_fim)}.
            {contrato.data_rescisao && ` Rescindido em ${dataCurta(contrato.data_rescisao)}.`}
          </p>
        </div>

        {parcelas.length === 0 ? (
          <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
            Nenhuma parcela gerada ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  <th className="rotulo w-10 px-gutter-table py-2 text-center">#</th>
                  <th className="rotulo px-gutter-table py-2">Competência</th>
                  <th className="rotulo px-gutter-table py-2">Vencimento</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Valor previsto</th>
                  <th className="rotulo px-gutter-table py-2 text-center">Situação</th>
                </tr>
              </thead>
              <tbody className="text-body-sm">
                {parcelas.map((parcela) => (
                  <tr
                    key={parcela.id}
                    className={cn(
                      "h-[40px] border-b border-outline-variant",
                      parcela.pago && "opacity-60",
                    )}
                  >
                    <td className="px-gutter-table text-center tabular text-on-surface-variant">
                      {parcela.indice + 1}
                    </td>
                    <td className="px-gutter-table tabular text-on-surface">
                      {formatarCompetencia(parcela.competencia)}
                    </td>
                    <td className="px-gutter-table tabular text-on-surface-variant">
                      {dataCurta(parcela.data_planejada)}
                    </td>
                    <td
                      className={cn(
                        "px-gutter-table text-right tabular",
                        receita ? "text-receita" : "text-despesa",
                      )}
                    >
                      {formatarMoeda(parcela.valor_previsto)}
                    </td>
                    <td className="px-gutter-table text-center">
                      {parcela.pago ? (
                        <Selo tom="sucesso">
                          <Check className="h-3 w-3" />
                          Baixada
                        </Selo>
                      ) : (
                        <Selo tom="aviso">
                          <Clock className="h-3 w-3" />
                          Em aberto
                        </Selo>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
