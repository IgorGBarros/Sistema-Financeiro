import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Plus } from "lucide-react";

import { api, type Contrato, type TipoLancamento } from "@/shared/lib/api";
import { formatarMoeda } from "@/features/fiscal/nfce";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { FormularioContrato } from "@/features/contratos/components/FormularioContrato";

type Filtro = "TODOS" | TipoLancamento;

const dataCurta = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "2-digit", year: "numeric" }).format(
    new Date(`${iso}T12:00:00`),
  );

export default function Contratos() {
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Contrato | null>(null);

  const contratos = useQuery({
    queryKey: ["contratos", filtro],
    queryFn: () => api.contratos(filtro === "TODOS" ? {} : { tipo: filtro }),
  });

  const lista = contratos.data ?? [];
  const receitas = lista.filter((c) => c.tipo === "RECEITA");
  const despesas = lista.filter((c) => c.tipo === "DESPESA");

  const somaMensal = (itens: Contrato[]) =>
    itens
      .filter((c) => c.frequencia === "M" && c.status === "ATIVO")
      .reduce((total, c) => total + Number(c.valor_unitario), 0);

  function abrirNovo() {
    setEmEdicao(null);
    setFormularioAberto(true);
  }

  function abrirEdicao(contrato: Contrato) {
    setEmEdicao(contrato);
    setFormularioAberto(true);
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Entradas e saídas</h1>
          <p className="text-sm text-muted-foreground">
            Cada linha tem vigência própria. A projeção mês a mês nasce daí.
          </p>
        </div>
        <Button onClick={abrirNovo}>
          <Plus className="mr-2 h-4 w-4" />
          Nova entrada ou saída
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Receitas mensais recorrentes</p>
            <p className="text-2xl font-semibold tabular-nums text-[hsl(var(--receita))]">
              {formatarMoeda(somaMensal(receitas))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Despesas mensais recorrentes</p>
            <p className="text-2xl font-semibold tabular-nums text-[hsl(var(--despesa))]">
              {formatarMoeda(somaMensal(despesas))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Sobra por mês</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatarMoeda(somaMensal(receitas) - somaMensal(despesas))}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
        <TabsList>
          <TabsTrigger value="TODOS">Todos</TabsTrigger>
          <TabsTrigger value="RECEITA">Entradas</TabsTrigger>
          <TabsTrigger value="DESPESA">Saídas</TabsTrigger>
        </TabsList>
      </Tabs>

      {contratos.isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : contratos.isError ? (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">A lista não carregou.</p>
              <p className="text-sm text-muted-foreground">
                {(contratos.error as Error).message} Confira se a API está no ar em
                http://127.0.0.1:8000.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : lista.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhuma entrada ou saída cadastrada ainda.
            </p>
            <Button variant="outline" onClick={abrirNovo}>
              Cadastrar a primeira
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Descrição</th>
                  <th className="px-4 py-3 font-medium">Classificação</th>
                  <th className="px-4 py-3 font-medium">Vigência</th>
                  <th className="px-4 py-3 text-right font-medium">Valor</th>
                  <th className="px-4 py-3 text-right font-medium">Parcelas</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.map((contrato) => (
                  <tr
                    key={contrato.id}
                    className="cursor-pointer hover:bg-accent/50"
                    onClick={() => abrirEdicao(contrato)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {contrato.tipo === "RECEITA" ? (
                          <ArrowUpRight className="h-4 w-4 shrink-0 text-[hsl(var(--receita))]" />
                        ) : (
                          <ArrowDownRight className="h-4 w-4 shrink-0 text-[hsl(var(--despesa))]" />
                        )}
                        <div>
                          <p className="font-medium">{contrato.descricao}</p>
                          <p className="text-xs text-muted-foreground">
                            {contrato.estabelecimento_nome}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{contrato.classificacao_nome}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {dataCurta(contrato.data_inicio)} → {dataCurta(contrato.data_fim)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatarMoeda(contrato.valor_unitario)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {contrato.quantidade_parcelas}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {formatarMoeda(contrato.valor_total_contrato)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <FormularioContrato
        aberto={formularioAberto}
        contrato={emEdicao}
        onFechar={() => setFormularioAberto(false)}
      />
    </div>
  );
}
