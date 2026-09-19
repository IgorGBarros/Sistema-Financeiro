import { Suspense, lazy, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { ScanLine, TrendingDown, TrendingUp } from "lucide-react";

import { api, type LinhaFluxo } from "@/shared/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";

import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Kpi } from "@/shared/components/Kpi";
import { cn } from "@/shared/lib/utils";

const ScannerNota = lazy(() =>
  import("@/features/fiscal/components/ScannerNota").then((m) => ({ default: m.ScannerNota })),
);

const HORIZONTES = [
  { rotulo: "6 meses", meses: 6 },
  { rotulo: "12 meses", meses: 12 },
  { rotulo: "24 meses", meses: 24 },
];

function somarMeses(data: Date, meses: number) {
  return new Date(data.getFullYear(), data.getMonth() + meses, 1);
}
const iso = (data: Date) => data.toISOString().slice(0, 10);

export default function FluxoCaixa() {
  const [horizonte, setHorizonte] = useState(12);
  const [scannerAberto, setScannerAberto] = useState(false);

  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fim = somarMeses(inicio, horizonte - 1);

  const fluxo = useQuery({
    queryKey: ["fluxo-caixa", iso(inicio), iso(fim)],
    queryFn: () => api.fluxoCaixa(iso(inicio), iso(fim)),
  });

  const mercado = useQuery({
    queryKey: ["mercado", "mes-corrente"],
    queryFn: () => api.mercadoMesCorrente(),
  });

  const dados = useMemo(
    () =>
      (fluxo.data?.linhas ?? []).map((linha: LinhaFluxo) => ({
        mes: formatarCompetencia(linha.competencia),
        receita: Number(linha.projetado ? linha.receita_prevista : linha.receita_realizada || linha.receita_prevista),
        despesa: Number(linha.projetado ? linha.despesa_prevista : linha.despesa_realizada || linha.despesa_prevista),
        saldo: Number(linha.saldo_acumulado),
        projetado: linha.projetado,
      })),
    [fluxo.data],
  );

  const primeiroNegativo = dados.find((d) => d.saldo < 0);

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Fluxo de caixa"
        descricao="Meses passados mostram o que foi pago. Meses à frente, a projeção dos contratos."
        acoes={
          <>
            <div className="flex gap-1 rounded-lg bg-surface-container-low p-1">
              {HORIZONTES.map((h) => (
                <button
                  key={h.meses}
                  onClick={() => setHorizonte(h.meses)}
                  className={cn(
                    "rounded px-3 py-1 text-body-sm transition-colors",
                    horizonte === h.meses
                      ? "bg-surface-container-lowest font-semibold text-on-surface shadow-sm"
                      : "text-on-surface-variant hover:text-on-surface",
                  )}
                >
                  {h.rotulo}
                </button>
              ))}
            </div>
            <Button onClick={() => setScannerAberto(true)}>
              <ScanLine className="mr-2 h-4 w-4" />
              Ler cupom
            </Button>
          </>
        }
      />

      <div className="mb-container-padding grid grid-cols-1 gap-container-padding md:grid-cols-3">
        <Kpi
          rotulo="Saldo ao fim do período"
          valor={fluxo.data ? formatarMoeda(fluxo.data.totais.saldo_final) : "—"}
          icone={TrendingUp}
          tom={
            fluxo.data && Number(fluxo.data.totais.saldo_final) < 0 ? "despesa" : "receita"
          }
          carregando={fluxo.isLoading}
        />
        <Kpi
          rotulo="Mercado neste mês"
          valor={mercado.data ? formatarMoeda(mercado.data.valor_total) : "—"}
          icone={ScanLine}
          apoio={
            mercado.data
              ? `${mercado.data.quantidade_notas} cupom(ns) · média ${formatarMoeda(mercado.data.ticket_medio)}`
              : undefined
          }
          carregando={mercado.isLoading}
        />
        <Kpi
          rotulo={primeiroNegativo ? "Saldo fica negativo em" : "Saldo positivo no período"}
          valor={primeiroNegativo ? primeiroNegativo.mes : "Sem furo previsto"}
          icone={primeiroNegativo ? TrendingDown : TrendingUp}
          tom={primeiroNegativo ? "despesa" : "receita"}
          carregando={fluxo.isLoading}
        />
      </div>

      <Card>
        <CardContent className="h-[380px] pt-6">
          {fluxo.isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Carregando a projeção…
            </div>
          ) : dados.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhum contrato cadastrado ainda.
              </p>
              <Button variant="outline" asChild>
                <Link to="/contratos">Cadastrar a primeira entrada ou saída</Link>
              </Button>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="mes" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                />
                <Tooltip
                  formatter={(valor: number, nome) => [formatarMoeda(valor), nome]}
                  labelClassName="font-medium"
                />
                <Legend />
                <Bar dataKey="receita" name="Receita" fill="var(--receita)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="despesa" name="Despesa" fill="var(--despesa)" radius={[4, 4, 0, 0]} />
                <Line
                  type="monotone"
                  dataKey="saldo"
                  name="Saldo acumulado"
                  stroke="var(--secondary)"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Suspense fallback={null}>
        {scannerAberto && (
          <ScannerNota aberto onFechar={() => setScannerAberto(false)} />
        )}
      </Suspense>
    </div>
  );
}
