import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Brain, Info, ShieldAlert, TrendingUp } from "lucide-react";

import { api } from "@/shared/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Kpi } from "@/shared/components/Kpi";
import { Selo } from "@/shared/components/Selo";
import { Card, CardContent } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/utils";

const HORIZONTES = [6, 12, 24];

export default function Previsao() {
  const [horizonte, setHorizonte] = useState(12);
  const [saldoInicial, setSaldoInicial] = useState("0");

  const previsao = useQuery({
    queryKey: ["previsao", horizonte, saldoInicial],
    queryFn: () => api.previsao(horizonte, saldoInicial || "0"),
  });

  const modelos = useQuery({
    queryKey: ["modelos-previsao"],
    queryFn: () => api.modelosPrevisao(),
  });

  const dados = previsao.data;

  /**
   * A faixa é desenhada como área entre P10 e P90. O Recharts empilha áreas,
   * então o truque é uma área invisível até P10 e outra com a altura da faixa
   * — desenhar duas áreas cheias sobreporia a de baixo.
   */
  const serie = useMemo(
    () =>
      (dados?.meses ?? []).map((mes) => ({
        mes: formatarCompetencia(mes.competencia),
        base: Number(mes.saldo_p10),
        faixa: Number(mes.saldo_p90) - Number(mes.saldo_p10),
        provavel: Number(mes.saldo_p50),
        risco: mes.probabilidade_negativo,
      })),
    [dados],
  );

  const risco = dados?.risco;
  const modelo = dados?.modelo;
  const temFaixa = Boolean(risco?.confiavel);

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Previsão"
        descricao="Como os próximos meses tendem a se comportar, com a faixa de incerteza."
        acoes={
          <div className="flex items-center gap-stack-sm">
            <div className="flex items-center gap-2">
              <span className="rotulo whitespace-nowrap">Saldo hoje</span>
              <Input
                type="number"
                step="100"
                className="w-32"
                value={saldoInicial}
                onChange={(e) => setSaldoInicial(e.target.value)}
              />
            </div>
            <div className="flex gap-1 rounded-lg bg-surface-container-low p-1">
              {HORIZONTES.map((n) => (
                <button
                  key={n}
                  onClick={() => setHorizonte(n)}
                  className={cn(
                    "rounded px-3 py-1 text-body-sm transition-colors",
                    horizonte === n
                      ? "bg-surface-container-lowest font-semibold text-on-surface shadow-sm"
                      : "text-on-surface-variant hover:text-on-surface",
                  )}
                >
                  {n}m
                </button>
              ))}
            </div>
          </div>
        }
      />

      {dados?.aviso && (
        <Card className="mb-container-padding border-warning/60">
          <CardContent className="flex items-start gap-3 pt-6">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="text-body-sm">
              <p className="font-medium">Projeção sem faixa de incerteza</p>
              <p className="text-on-surface-variant">{dados.aviso}</p>
              <p className="mt-1 text-on-surface-variant">
                A cada mês de uso, o sistema mede o próprio erro e aperta a
                faixa sozinho. Com quatro meses ele já valida um modelo; com
                seis, a faixa passa a significar alguma coisa.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-container-padding grid grid-cols-1 gap-container-padding md:grid-cols-3">
        <Kpi
          rotulo="Saldo provável ao fim"
          valor={risco ? formatarMoeda(risco.saldo_final_p50) : "—"}
          icone={TrendingUp}
          tom={risco && Number(risco.saldo_final_p50) < 0 ? "despesa" : "receita"}
          apoio={
            temFaixa
              ? `Entre ${formatarMoeda(risco!.saldo_final_p10)} e ${formatarMoeda(risco!.saldo_final_p90)}`
              : "Sem faixa: só o contratado"
          }
          carregando={previsao.isLoading}
        />
        <Kpi
          rotulo="Risco de ficar no vermelho"
          valor={
            risco ? `${(risco.probabilidade_algum_mes_negativo * 100).toFixed(0)}%` : "—"
          }
          icone={ShieldAlert}
          tom={
            risco && risco.probabilidade_algum_mes_negativo >= 0.2 ? "despesa" : "receita"
          }
          apoio={
            risco?.primeiro_mes_de_risco
              ? `Primeiro mês de risco: ${formatarCompetencia(risco.primeiro_mes_de_risco)}`
              : "Em algum mês do período"
          }
          carregando={previsao.isLoading}
        />
        <Kpi
          rotulo="Modelo em uso"
          valor={modelo?.descricao ?? "—"}
          icone={Brain}
          tom="neutro"
          apoio={
            modelo?.confiavel
              ? `Erra ${formatarMoeda(modelo.erro_medio ?? "0")} por mês, em média`
              : `${modelo?.observacoes ?? 0} mês(es) de histórico`
          }
          carregando={previsao.isLoading}
        />
      </div>

      {dados && (
        <Card className="mb-container-padding">
          <CardContent className="pt-6">
            <p className="text-body-lg">{dados.resumo}</p>
          </CardContent>
        </Card>
      )}

      {/* Próximos 3 meses — leitura rápida sem ter que rolar o gráfico */}
      {(dados?.meses ?? []).length > 0 && (
        <div className="cartao mb-container-padding overflow-hidden">
          <div className="border-b border-outline-variant bg-surface p-stack-md">
            <h2 className="text-headline-sm text-on-surface">Próximos 3 meses</h2>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Previsto vs. realizado e saldo estimado para cada mês.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  <th className="rotulo px-gutter-table py-2">Mês</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Contratado</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Resultado prev.</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Saldo estimado</th>
                  <th className="rotulo px-gutter-table py-2 text-center">Risco negativo</th>
                </tr>
              </thead>
              <tbody className="text-body-sm">
                {(dados?.meses ?? []).slice(0, 3).map((mes) => {
                  const saldo50 = Number(mes.saldo_p50);
                  const resultado = Number(mes.resultado_p50);
                  return (
                    <tr key={mes.competencia} className="h-[40px] border-b border-outline-variant">
                      <td className="px-gutter-table font-medium text-on-surface">
                        {formatarCompetencia(mes.competencia)}
                      </td>
                      <td className="px-gutter-table text-right tabular text-on-surface">
                        {formatarMoeda(mes.contratado)}
                      </td>
                      <td className={`px-gutter-table text-right tabular ${resultado >= 0 ? "text-receita" : "text-despesa"}`}>
                        {formatarMoeda(mes.resultado_p50)}
                      </td>
                      <td className={`px-gutter-table text-right tabular font-semibold ${saldo50 < 0 ? "text-despesa" : "text-on-surface"}`}>
                        {formatarMoeda(mes.saldo_p50)}
                      </td>
                      <td className="px-gutter-table text-center text-on-surface-variant">
                        {(mes.probabilidade_negativo * 100).toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="cartao mb-container-padding p-container-padding">
        <h2 className="text-headline-sm text-on-surface">Saldo projetado</h2>
        <p className="mb-stack-md mt-1 text-body-sm text-on-surface-variant">
          {temFaixa
            ? `A área é a faixa onde o saldo cai em 80% dos ${risco!.cenarios_simulados.toLocaleString("pt-BR")} cenários simulados. A linha é o resultado mais provável.`
            : "Apenas o que já está contratado. Sem histórico, não há como estimar a variação."}
        </p>
        <div className="h-[340px]">
          {previsao.isLoading ? (
            <p className="pt-stack-lg text-center text-body-sm text-on-surface-variant">
              Simulando cenários…
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="mes" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                />
                <Tooltip
                  formatter={(valor: number, nome) =>
                    nome === "faixa" ? [formatarMoeda(valor), "Amplitude"] : [formatarMoeda(valor), "Saldo provável"]
                  }
                />
                <Legend />
                {/* O zero é a referência que importa: cruzá-lo é o evento. */}
                <ReferenceLine y={0} stroke="var(--despesa)" strokeDasharray="4 4" />
                <Area
                  type="monotone" dataKey="base" stackId="faixa" name=" "
                  stroke="none" fill="transparent"
                />
                <Area
                  type="monotone" dataKey="faixa" stackId="faixa" name="faixa"
                  stroke="none" fill="var(--secondary)" fillOpacity={0.18}
                />
                <Line
                  type="monotone" dataKey="provavel" name="Saldo provável"
                  stroke="var(--secondary)" strokeWidth={2} dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-container-padding lg:grid-cols-5">
        <div className="cartao overflow-hidden lg:col-span-3">
          <div className="border-b border-outline-variant bg-surface p-stack-md">
            <h2 className="text-headline-sm text-on-surface">Mês a mês</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  <th className="rotulo px-gutter-table py-2">Mês</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Contratado</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Estimado</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Saldo provável</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Risco</th>
                </tr>
              </thead>
              <tbody className="text-body-sm">
                {(dados?.meses ?? []).map((mes) => {
                  const perigo = mes.probabilidade_negativo >= 0.2;
                  return (
                    <tr
                      key={mes.competencia}
                      className={cn(
                        "h-[36px] border-b border-outline-variant",
                        perigo && "bg-warning-container/30",
                      )}
                    >
                      <td className="px-gutter-table">{formatarCompetencia(mes.competencia)}</td>
                      <td
                        className={cn(
                          "px-gutter-table text-right tabular",
                          Number(mes.contratado) < 0 ? "text-despesa" : "text-receita",
                        )}
                      >
                        {formatarMoeda(mes.contratado)}
                      </td>
                      <td className="px-gutter-table text-right tabular text-on-surface-variant">
                        {Number(mes.estimado) ? formatarMoeda(mes.estimado) : "—"}
                      </td>
                      <td className="px-gutter-table text-right tabular font-medium">
                        {formatarMoeda(mes.saldo_p50)}
                      </td>
                      <td className="px-gutter-table text-right">
                        {mes.probabilidade_negativo > 0.01 ? (
                          <Selo tom={perigo ? "aviso" : "neutro"}>
                            {(mes.probabilidade_negativo * 100).toFixed(0)}%
                          </Selo>
                        ) : (
                          <span className="text-on-surface-variant/40">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="cartao p-container-padding lg:col-span-2">
          <h2 className="text-headline-sm text-on-surface">Como o modelo foi escolhido</h2>
          <p className="mt-1 text-body-sm text-on-surface-variant">{modelo?.motivo}</p>

          {modelo?.ganho_sobre_ingenuo !== null && modelo?.ganho_sobre_ingenuo !== undefined && (
            <p className="mt-stack-sm text-body-sm">
              Erra{" "}
              <strong className="text-receita">
                {(modelo.ganho_sobre_ingenuo * 100).toFixed(0)}% menos
              </strong>{" "}
              que simplesmente repetir o último mês.
            </p>
          )}

          {(modelo?.candidatos ?? []).length > 0 && (
            <>
              <p className="rotulo mt-stack-md border-b border-outline-variant pb-1">
                Testados, por erro médio
              </p>
              <div className="mt-stack-sm space-y-1">
                {modelo!.candidatos.slice(0, 6).map((candidato, indice) => (
                  <div
                    key={candidato.modelo}
                    className={cn(
                      "flex justify-between gap-2 text-body-sm",
                      indice === 0 && "font-semibold",
                    )}
                  >
                    <span className="truncate">{candidato.descricao}</span>
                    <span className="shrink-0 tabular text-on-surface-variant">
                      {formatarMoeda(candidato.erro_medio)}
                    </span>
                  </div>
                ))}
              </div>
              {/* Explicar o método evita que o número vire fé. */}
              <p className="mt-stack-md text-[11px] text-on-surface-variant">
                Cada modelo é testado prevendo meses que ele não viu, um de
                cada vez. Vence quem erra menos em reais. Sem ganho relevante
                sobre o mais simples, fica o mais simples.
              </p>
            </>
          )}

          {(modelos.data?.modelos ?? []).length > 0 && (
            <>
              <p className="rotulo mt-stack-md border-b border-outline-variant pb-1">
                Disponibilidade dos modelos
              </p>
              <p className="mt-1 text-[11px] text-on-surface-variant">
                {modelos.data!.meses_de_historico} mês(es) de histórico registrados.
              </p>
              <div className="mt-stack-sm space-y-1">
                {modelos.data!.modelos.map((m) => (
                  <div key={m.nome} className="flex items-center justify-between gap-2 text-body-sm">
                    <span className={cn("truncate", !m.disponivel && "text-on-surface-variant/50")}>
                      {m.descricao}
                    </span>
                    <Selo tom={m.disponivel ? "sucesso" : "neutro"}>
                      {m.disponivel ? "pronto" : `min ${m.minimo_observacoes}m`}
                    </Selo>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
