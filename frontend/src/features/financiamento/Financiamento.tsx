import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, Building2, CalendarCheck, Percent, Wallet } from "lucide-react";

import { api, type Financiamento as TipoFinanciamento } from "@/shared/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Kpi } from "@/shared/components/Kpi";
import { Selo } from "@/shared/components/Selo";
import { Card, CardContent } from "@/shared/ui/card";
import { cn } from "@/shared/lib/utils";

const dataCurta = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(`${iso}T12:00:00`));

export default function Financiamento() {
  const financiamentos = useQuery({
    queryKey: ["financiamentos"],
    queryFn: () => api.financiamentos(),
  });

  const lista = financiamentos.data ?? [];
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const atual = lista.find((f) => f.id === selecionado) ?? lista[0];

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Financiamento"
        descricao="Parcelas vindas do demonstrativo do banco, com o valor exato de cada uma."
      />

      {financiamentos.isError ? (
        <p className="py-stack-lg text-center text-body-sm text-error">
          Não foi possível carregar os financiamentos. Verifique sua conexão e tente novamente.
        </p>
      ) : financiamentos.isLoading ? (
        <p className="py-stack-lg text-center text-body-sm text-on-surface-variant">
          Carregando…
        </p>
      ) : lista.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-stack-lg text-center">
            <Building2 className="h-8 w-8 text-on-surface-variant" />
            <p className="text-body-md">Nenhum financiamento importado.</p>
            <p className="max-w-md text-body-sm text-on-surface-variant">
              Envie o Demonstrativo Descritivo de Crédito (DDC) do banco em
              Documentos. Ele traz a tabela inteira, com a situação de cada
              parcela.
            </p>
            <Link
              to="/documentos"
              className="mt-1 inline-flex items-center rounded-md border border-input bg-background px-3 py-2 text-body-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Ir para Documentos
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {lista.length > 1 && (
            <div className="mb-container-padding flex flex-wrap gap-stack-sm">
              {lista.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelecionado(f.id)}
                  className={cn(
                    "rounded-lg border px-4 py-2 text-body-sm transition-colors",
                    atual?.id === f.id
                      ? "border-secondary bg-secondary-container text-on-secondary-container"
                      : "border-outline-variant hover:bg-surface-container-high",
                  )}
                >
                  {f.instituicao || "Contrato"} {f.numero_contrato}
                </button>
              ))}
            </div>
          )}
          {atual && <Detalhe financiamento={atual} />}
        </>
      )}
    </div>
  );
}

function Detalhe({ financiamento }: { financiamento: TipoFinanciamento }) {
  const parcelas = useQuery({
    queryKey: ["financiamento", financiamento.id, "parcelas"],
    queryFn: () => api.parcelasFinanciamento(financiamento.id),
  });

  const duplicidades = useQuery({
    queryKey: ["financiamento", financiamento.id, "duplicidades"],
    queryFn: () => api.duplicidadesFinanciamento(financiamento.id),
    enabled: financiamento.paga_do_proprio_bolso,
  });

  const total = financiamento.parcelas_pagas + financiamento.parcelas_restantes;
  const progresso = total ? (financiamento.parcelas_pagas / total) * 100 : 0;

  /**
   * A parcela do SAC cai ao longo do contrato, e a composição muda junto: no
   * começo a maior parte é juro, no fim é amortização. O gráfico empilhado
   * mostra as duas coisas de uma vez.
   */
  const serie = useMemo(() => {
    const linhas = parcelas.data ?? [];
    // Uma amostra a cada 6 meses mantém o gráfico legível com 296 pontos.
    return linhas
      .filter((_, indice) => indice % 6 === 0)
      .map((p) => ({
        mes: formatarCompetencia(p.competencia),
        amortização: Number(p.amortizacao),
        juros: Number(p.juros),
        seguros: Number(p.seguro_mip) + Number(p.seguro_dfi),
      }));
  }, [parcelas.data]);

  const proximas = (parcelas.data ?? [])
    .filter((p) => p.situacao !== "PAGA")
    .slice(0, 12);

  return (
    <>
      <div className="mb-container-padding grid grid-cols-1 gap-container-padding md:grid-cols-4">
        <Kpi
          rotulo="Saldo devedor"
          valor={
            financiamento.saldo_devedor_atual
              ? formatarMoeda(financiamento.saldo_devedor_atual)
              : "—"
          }
          icone={Wallet}
          apoio={`Após a parcela ${financiamento.parcelas_pagas}`}
        />
        <Kpi
          rotulo="Total a pagar"
          valor={formatarMoeda(financiamento.total_a_pagar)}
          icone={CalendarCheck}
          tom="despesa"
          apoio={`${financiamento.parcelas_restantes} parcelas restantes`}
        />
        <Kpi
          rotulo="Juros a pagar"
          valor={formatarMoeda(financiamento.juros_a_pagar)}
          icone={Percent}
          tom="despesa"
          apoio={`${(
            (Number(financiamento.juros_a_pagar) /
              Number(financiamento.total_a_pagar)) *
            100
          ).toFixed(0)}% do que ainda falta`}
        />
        <Kpi
          rotulo="Próxima parcela"
          valor={
            financiamento.proxima_parcela
              ? formatarMoeda(financiamento.proxima_parcela.valor_total)
              : "—"
          }
          icone={Building2}
          apoio={
            financiamento.proxima_parcela
              ? `Vence ${dataCurta(financiamento.proxima_parcela.vencimento)}`
              : "Contrato quitado"
          }
        />
      </div>

      <div className="cartao mb-container-padding p-container-padding">
        <div className="mb-stack-sm flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-headline-sm text-on-surface">
              Contrato {financiamento.numero_contrato}
            </h2>
            <p className="text-body-sm text-on-surface-variant">
              {financiamento.instituicao} · {financiamento.sistema_amortizacao} ·{" "}
              {financiamento.taxa_juros_anual} ao ano
              {financiamento.data_ultima_parcela &&
                ` · quita em ${dataCurta(financiamento.data_ultima_parcela)}`}
            </p>
          </div>
          {!financiamento.paga_do_proprio_bolso && (
            <Selo>Pago por terceiro — fora do fluxo de caixa</Selo>
          )}
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-surface-container-high">
          <div
            className="h-full rounded-full bg-receita transition-all"
            style={{ width: `${progresso}%` }}
          />
        </div>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          {financiamento.parcelas_pagas} de {total} parcelas pagas ({progresso.toFixed(0)}%)
          {financiamento.titular && ` · titular ${financiamento.titular}`}
        </p>
      </div>

      {(duplicidades.data?.duplicidades ?? []).length > 0 && (
        <Card className="mb-container-padding border-warning/60">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="text-body-sm">
              <p className="font-medium">
                {duplicidades.data!.duplicidades.length} parcela(s) com possível duplicidade
              </p>
              <p className="text-on-surface-variant">
                Parece que estas parcelas já estão lançadas como despesa no fluxo de caixa.
                Verifique para não contar a mesma saída duas vezes.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-container-padding lg:grid-cols-5">
        <div className="cartao p-container-padding lg:col-span-3">
          <h2 className="text-headline-sm text-on-surface">Composição da parcela</h2>
          <p className="mb-stack-md mt-1 text-body-sm text-on-surface-variant">
            Só a amortização reduz a dívida. No começo do SAC a maior parte da
            parcela é juro — e é por isso que o saldo devedor cai devagar nos
            primeiros anos.
          </p>
          <div className="h-[300px]">
            {parcelas.isLoading ? (
              <p className="pt-stack-lg text-center text-body-sm text-on-surface-variant">
                Carregando parcelas…
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="mes" tickLine={false} axisLine={false} fontSize={11} minTickGap={30} />
                  <YAxis
                    tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                  />
                  <Tooltip formatter={(v: number, nome) => [formatarMoeda(v), nome]} />
                  <Area
                    type="monotone" dataKey="juros" stackId="1"
                    stroke="var(--despesa)" fill="var(--despesa)" fillOpacity={0.7}
                  />
                  <Area
                    type="monotone" dataKey="amortização" stackId="1"
                    stroke="var(--receita)" fill="var(--receita)" fillOpacity={0.7}
                  />
                  <Area
                    type="monotone" dataKey="seguros" stackId="1"
                    stroke="var(--outline)" fill="var(--outline)" fillOpacity={0.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="cartao overflow-hidden lg:col-span-2">
          <div className="border-b border-outline-variant bg-surface p-stack-md">
            <h2 className="text-headline-sm text-on-surface">Próximas parcelas</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  <th className="rotulo px-gutter-table py-2">Venc.</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Valor</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Juros</th>
                  <th className="rotulo px-gutter-table py-2">Situação</th>
                </tr>
              </thead>
              <tbody className="text-body-sm">
                {proximas.map((p) => (
                  <tr key={p.id} className="h-[36px] border-b border-outline-variant">
                    <td className="px-gutter-table tabular text-on-surface-variant">
                      {dataCurta(p.vencimento)}
                    </td>
                    <td className="px-gutter-table text-right tabular">
                      {formatarMoeda(p.valor_total)}
                    </td>
                    <td className="px-gutter-table text-right tabular text-despesa">
                      {formatarMoeda(p.juros)}
                    </td>
                    <td className="px-gutter-table">
                      <Selo tom={p.situacao === "ABERTA" ? "aviso" : "neutro"}>
                        {p.situacao === "ABERTA" ? "Aberta" : "Projetada"}
                      </Selo>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
