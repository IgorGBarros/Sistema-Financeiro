import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { Gauge, Lightbulb, TrendingDown, TrendingUp } from "lucide-react";

import { api } from "@/shared/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Selo } from "@/shared/components/Selo";
import { Kpi } from "@/shared/components/Kpi";
import { Card, CardContent } from "@/shared/ui/card";

/**
 * Contas de consumo.
 *
 * A tela existe para responder uma pergunta que o valor sozinho não responde:
 * a conta subiu porque consumi mais, ou porque a tarifa aumentou? As duas
 * causas pedem reações opostas — uma se resolve mudando hábito, a outra não
 * tem o que fazer.
 */
/**
 * Unidades consumidoras.
 *
 * Nascem sozinhas na importação, a partir do código do cliente na conta.
 * Ligar cada uma ao contrato correspondente é o que faz a conta importada
 * confirmar o previsto em vez de virar despesa nova.
 */
function UnidadesConsumidoras() {
  const unidades = useQuery({
    queryKey: ["unidades-consumidoras"],
    queryFn: () => api.unidadesConsumidoras(),
  });
  const lista = unidades.data ?? [];
  if (lista.length === 0) return null;

  const semContrato = lista.filter((u) => !u.contrato);

  return (
    <div className="cartao mb-container-padding overflow-hidden">
      <div className="border-b border-outline-variant bg-surface p-stack-md">
        <h2 className="text-headline-sm text-on-surface">Unidades consumidoras</h2>
        {semContrato.length > 0 && (
          <p className="mt-1 text-body-sm text-on-surface-variant">
            {semContrato.length} sem contrato vinculado: a conta entra como
            despesa nova em vez de confirmar a parcela prevista.
          </p>
        )}
      </div>
      <div className="divide-y divide-outline-variant">
        {lista.map((unidade) => (
          <div key={unidade.id} className="flex items-center justify-between gap-2 p-stack-md">
            <div className="min-w-0">
              <p className="truncate text-on-surface">
                {unidade.apelido || unidade.codigo_cliente}
              </p>
              <p className="text-body-sm text-on-surface-variant">
                {unidade.concessionaria || unidade.servico} · cliente {unidade.codigo_cliente}
              </p>
            </div>
            {unidade.contrato ? (
              <Selo tom="sucesso">vinculada</Selo>
            ) : (
              <Selo tom="aviso">sem contrato</Selo>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Contas() {
  const historico = useQuery({
    queryKey: ["contas-consumo", "historico"],
    queryFn: () => api.historicoConsumo(),
  });

  const serie = useMemo(
    () =>
      (historico.data ?? []).map((mes) => ({
        mes: formatarCompetencia(mes.competencia),
        valor: Number(mes.valor),
        consumo: mes.consumo ? Number(mes.consumo) : null,
        tarifa: mes.tarifa_media ? Number(mes.tarifa_media) : null,
      })),
    [historico.data],
  );

  const analise = useMemo(() => {
    if (serie.length < 2) return null;
    const [anterior, atual] = serie.slice(-2);
    if (!anterior.consumo || !atual.consumo || !anterior.tarifa || !atual.tarifa) {
      return null;
    }

    const variacaoValor = (atual.valor - anterior.valor) / anterior.valor;
    const variacaoConsumo = (atual.consumo - anterior.consumo) / anterior.consumo;
    const variacaoTarifa = (atual.tarifa - anterior.tarifa) / anterior.tarifa;

    // Atribui a variação à causa dominante. Se as duas subiram, aponta a maior
    // — dizer "os dois subiram" não ajuda ninguém a decidir o que fazer.
    const causa =
      Math.abs(variacaoConsumo) > Math.abs(variacaoTarifa) ? "consumo" : "tarifa";

    return { variacaoValor, variacaoConsumo, variacaoTarifa, causa, atual, anterior };
  }, [serie]);

  const ultimo = serie[serie.length - 1];

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Contas de consumo"
        descricao="Luz, água e gás — com consumo e tarifa, não só o valor."
      />

      {historico.isLoading ? (
        <p className="py-stack-lg text-center text-body-sm text-on-surface-variant">
          Carregando…
        </p>
      ) : serie.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-stack-lg text-center">
            <Lightbulb className="h-8 w-8 text-on-surface-variant" />
            <p className="text-body-md">Nenhuma conta importada.</p>
            <p className="max-w-md text-body-sm text-on-surface-variant">
              Envie o PDF da conta de luz em Cartões → Importar PDF. Além do
              valor, o leitor extrai o consumo em kWh e a leitura do medidor.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-container-padding grid grid-cols-1 gap-container-padding md:grid-cols-3">
            <Kpi
              rotulo="Última conta"
              valor={formatarMoeda(ultimo.valor)}
              icone={Lightbulb}
              tom="despesa"
              apoio={ultimo.mes}
            />
            <Kpi
              rotulo="Consumo"
              valor={ultimo.consumo ? `${ultimo.consumo.toLocaleString("pt-BR")} kWh` : "—"}
              icone={Gauge}
              apoio="Medido no relógio"
            />
            <Kpi
              rotulo="Tarifa média"
              valor={ultimo.tarifa ? `R$ ${ultimo.tarifa.toFixed(4)}` : "—"}
              icone={analise?.variacaoTarifa && analise.variacaoTarifa > 0 ? TrendingUp : TrendingDown}
              apoio="Por kWh, incluindo impostos e bandeira"
            />
          </div>

          {analise && Math.abs(analise.variacaoValor) > 0.02 && (
            <Card className="mb-container-padding">
              <CardContent className="pt-6">
                <p className="text-body-md">
                  A conta {analise.variacaoValor > 0 ? "subiu" : "caiu"}{" "}
                  <strong>{Math.abs(analise.variacaoValor * 100).toFixed(0)}%</strong> em
                  relação ao mês anterior, principalmente por{" "}
                  <strong>{analise.causa}</strong>.
                </p>
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  Consumo {analise.variacaoConsumo >= 0 ? "+" : ""}
                  {(analise.variacaoConsumo * 100).toFixed(0)}% · tarifa{" "}
                  {analise.variacaoTarifa >= 0 ? "+" : ""}
                  {(analise.variacaoTarifa * 100).toFixed(0)}%.{" "}
                  {analise.causa === "consumo"
                    ? "Consumo é o que está no seu controle."
                    : "Reajuste de tarifa ou mudança de bandeira — não há o que fazer além de reduzir o consumo."}
                </p>
              </CardContent>
            </Card>
          )}

          <UnidadesConsumidoras />

          <div className="cartao p-container-padding">
            <h2 className="text-headline-sm text-on-surface">Valor, consumo e tarifa</h2>
            <p className="mb-stack-md mt-1 text-body-sm text-on-surface-variant">
              As barras são o valor pago. A linha é o consumo. Quando as barras
              sobem e a linha não, o aumento veio da tarifa.
            </p>
            <div className="h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="mes" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis
                    yAxisId="valor"
                    tickFormatter={(v) => `${v}`}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                  />
                  <YAxis
                    yAxisId="consumo"
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                  />
                  <Tooltip
                    formatter={(valor: number, nome) =>
                      nome === "valor" ? [formatarMoeda(valor), "Valor"] : [`${valor} kWh`, "Consumo"]
                    }
                  />
                  <Legend />
                  <Bar yAxisId="valor" dataKey="valor" name="Valor" fill="var(--despesa)" radius={[4, 4, 0, 0]} />
                  <Line
                    yAxisId="consumo" type="monotone" dataKey="consumo" name="Consumo (kWh)"
                    stroke="var(--secondary)" strokeWidth={2} dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
