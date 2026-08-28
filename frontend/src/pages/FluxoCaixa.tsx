import { Suspense, lazy, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { ScanLine, TrendingDown, TrendingUp } from "lucide-react";

import { api, type LinhaFluxo } from "@/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/lib/nfce";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ScannerNota = lazy(() =>
  import("@/components/ScannerNota").then((m) => ({ default: m.ScannerNota })),
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
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fluxo de caixa</h1>
          <p className="text-sm text-muted-foreground">
            Meses passados mostram o que foi pago. Meses à frente mostram a projeção
            dos contratos.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Tabs value={String(horizonte)} onValueChange={(v) => setHorizonte(Number(v))}>
            <TabsList>
              {HORIZONTES.map((h) => (
                <TabsTrigger key={h.meses} value={String(h.meses)}>
                  {h.rotulo}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button onClick={() => setScannerAberto(true)}>
            <ScanLine className="mr-2 h-4 w-4" />
            Ler cupom
          </Button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Saldo ao fim do período
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {fluxo.data ? formatarMoeda(fluxo.data.totais.saldo_final) : "—"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Mercado neste mês
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {mercado.data ? formatarMoeda(mercado.data.valor_total) : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {mercado.data?.quantidade_notas ?? 0} cupom(ns) lidos · ticket médio{" "}
              {mercado.data ? formatarMoeda(mercado.data.ticket_medio) : "—"}
            </p>
          </CardContent>
        </Card>

        <Card className={primeiroNegativo ? "border-destructive" : undefined}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {primeiroNegativo ? "Saldo fica negativo em" : "Saldo positivo no período"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            {primeiroNegativo ? (
              <>
                <TrendingDown className="h-5 w-5 text-destructive" />
                <p className="text-2xl font-semibold">{primeiroNegativo.mes}</p>
              </>
            ) : (
              <>
                <TrendingUp className="h-5 w-5 text-emerald-600" />
                <p className="text-2xl font-semibold">Sem furo previsto</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Receitas, despesas e saldo acumulado</CardTitle>
        </CardHeader>
        <CardContent className="h-[380px]">
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
                <a href="/contratos/novo">Cadastrar a primeira entrada ou saída</a>
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
                <Bar dataKey="receita" name="Receita" fill="#16a34a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="despesa" name="Despesa" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Line
                  type="monotone"
                  dataKey="saldo"
                  name="Saldo acumulado"
                  stroke="#0ea5e9"
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
