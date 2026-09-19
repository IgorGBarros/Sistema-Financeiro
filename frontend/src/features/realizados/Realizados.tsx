import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Pencil,
  Plus,
  TrendingUp,
  Trash2,
} from "lucide-react";

import { api, type Realizado, type TipoLancamento } from "@/shared/lib/api";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Kpi } from "@/shared/components/Kpi";
import { ModalConfirmacao } from "@/shared/components/ModalConfirmacao";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/use-toast";
import { cn } from "@/shared/lib/utils";
import { FormularioRealizado } from "./components/FormularioRealizado";

type Filtro = "TODOS" | TipoLancamento;

function formatarMoeda(valor: string | number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(valor),
  );
}

function formatarData(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

function formatarCompetencia(data: string): string {
  const [ano, mes] = data.split("-");
  return `${mes}/${ano}`;
}

export default function Realizados() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Realizado | null>(null);
  const [emExclusao, setEmExclusao] = useState<Realizado | null>(null);

  // Busca do mês corrente por padrão
  const hoje = new Date();
  const [mesRef] = useState(() => {
    const m = String(hoje.getMonth() + 1).padStart(2, "0");
    return `${hoje.getFullYear()}-${m}`;
  });

  const realizados = useQuery({
    queryKey: ["realizados", filtro, mesRef],
    queryFn: () =>
      api.realizados(
        filtro === "TODOS"
          ? { competencia: `${mesRef}-01` }
          : { tipo: filtro, competencia: `${mesRef}-01` },
      ),
  });

  const indicadores = useMemo(() => {
    const lista = realizados.data ?? [];
    const soma = (tipo: TipoLancamento) =>
      lista.filter((r) => r.tipo === tipo).reduce((t, r) => t + Number(r.valor), 0);
    const receitas = soma("RECEITA");
    const despesas = soma("DESPESA");
    return { receitas, despesas, resultado: receitas - despesas };
  }, [realizados.data]);

  const lista = realizados.data ?? [];

  const deletar = useMutation({
    mutationFn: (id: string) => api.deletarRealizado(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["realizados"] });
      queryClient.invalidateQueries({ queryKey: ["fluxo-caixa"] });
      toast({ title: "Lançamento removido" });
      setEmExclusao(null);
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  function abrir(realizado: Realizado | null) {
    setEmEdicao(realizado);
    setFormularioAberto(true);
  }

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Realizados"
        descricao="O que efetivamente entrou e saiu. Compare com o previsto nos contratos."
        acoes={
          <Button onClick={() => abrir(null)}>
            <Plus className="mr-2 h-4 w-4" />
            Novo lançamento
          </Button>
        }
      />

      <div className="mb-container-padding grid grid-cols-1 gap-container-padding md:grid-cols-3">
        <Kpi
          rotulo="Entradas no mês"
          valor={formatarMoeda(indicadores.receitas)}
          icone={ArrowDownToLine}
          tom="receita"
          apoio={`${lista.filter((r) => r.tipo === "RECEITA").length} lançamento(s)`}
          carregando={realizados.isLoading}
        />
        <Kpi
          rotulo="Saídas no mês"
          valor={formatarMoeda(indicadores.despesas)}
          icone={ArrowUpFromLine}
          tom="despesa"
          apoio={`${lista.filter((r) => r.tipo === "DESPESA").length} lançamento(s)`}
          carregando={realizados.isLoading}
        />
        <Kpi
          rotulo="Resultado do mês"
          valor={formatarMoeda(indicadores.resultado)}
          icone={TrendingUp}
          tom={indicadores.resultado >= 0 ? "receita" : "despesa"}
          apoio={
            indicadores.resultado >= 0 ? "Fechou positivo" : "Fechou negativo"
          }
          carregando={realizados.isLoading}
        />
      </div>

      <div className="cartao overflow-hidden">
        <div className="flex items-center justify-between border-b border-outline-variant bg-surface p-stack-md">
          <h2 className="text-headline-sm text-on-surface">
            Lançamentos — {formatarCompetencia(`${mesRef}-01`)}
          </h2>
          <div className="flex gap-1 rounded-lg bg-surface-container-low p-1">
            {(["TODOS", "RECEITA", "DESPESA"] as const).map((valor) => (
              <button
                key={valor}
                onClick={() => setFiltro(valor)}
                className={cn(
                  "rounded px-3 py-1 text-body-sm transition-colors",
                  filtro === valor
                    ? "bg-surface-container-lowest font-semibold text-on-surface shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface",
                )}
              >
                {valor === "TODOS" ? "Todos" : valor === "RECEITA" ? "Entradas" : "Saídas"}
              </button>
            ))}
          </div>
        </div>

        {realizados.isLoading ? (
          <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
            Carregando…
          </p>
        ) : realizados.isError ? (
          <div className="flex items-start gap-3 p-stack-md">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-error" />
            <div>
              <p className="text-body-md font-medium">A lista não carregou.</p>
              <p className="text-body-sm text-on-surface-variant">
                {(realizados.error as Error).message}
              </p>
            </div>
          </div>
        ) : lista.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-stack-lg text-center">
            <p className="text-body-sm text-on-surface-variant">
              Nenhum lançamento registrado neste mês.
            </p>
            <Button variant="outline" onClick={() => abrir(null)}>
              Registrar o primeiro
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  <th className="rotulo px-gutter-table py-2">Descrição</th>
                  <th className="rotulo px-gutter-table py-2">Categoria</th>
                  <th className="rotulo px-gutter-table py-2">Pagamento</th>
                  <th className="rotulo px-gutter-table py-2">Forma</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Valor</th>
                  <th className="rotulo px-gutter-table py-2 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="text-body-sm">
                {lista.map((r) => {
                  const receita = r.tipo === "RECEITA";
                  return (
                    <tr
                      key={r.id}
                      className="group h-[40px] border-b border-outline-variant transition-colors hover:bg-surface-container-low"
                    >
                      <td className="px-gutter-table py-2">
                        <div className="flex items-center gap-2 font-medium text-on-surface">
                          <span
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full",
                              receita ? "bg-receita" : "bg-despesa",
                            )}
                          />
                          <span className="truncate">{r.descricao}</span>
                        </div>
                        {r.contrato_descricao && (
                          <div className="ml-4 truncate text-[11px] text-on-surface-variant">
                            Contrato: {r.contrato_descricao}
                          </div>
                        )}
                      </td>
                      <td className="px-gutter-table py-2 text-on-surface-variant">
                        {r.categoria_nome}
                      </td>
                      <td className="whitespace-nowrap px-gutter-table py-2 tabular text-on-surface-variant">
                        {formatarData(r.data_pagamento)}
                      </td>
                      <td className="px-gutter-table py-2 text-on-surface-variant">
                        {r.forma_pagamento || "—"}
                      </td>
                      <td
                        className={cn(
                          "px-gutter-table py-2 text-right tabular",
                          receita ? "text-receita" : "text-despesa",
                        )}
                      >
                        {receita ? "+" : "−"} {formatarMoeda(r.valor)}
                      </td>
                      <td className="px-gutter-table py-2 text-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <div className="flex justify-center gap-1">
                          <button
                            className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-secondary"
                            title="Editar"
                            onClick={() => abrir(r)}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-on-error-container"
                            title="Remover"
                            onClick={() => setEmExclusao(r)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {lista.length > 0 && (
          <div className="flex items-center justify-between border-t border-outline-variant bg-surface-container-low p-stack-sm text-body-sm text-on-surface-variant">
            <span>
              {lista.length} lançamento{lista.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>

      <FormularioRealizado
        aberto={formularioAberto}
        realizado={emEdicao}
        onFechar={() => setFormularioAberto(false)}
      />

      <ModalConfirmacao
        aberto={!!emExclusao}
        titulo="Remover lançamento"
        mensagem={`Deseja remover "${emExclusao?.descricao}"? Esta ação não pode ser desfeita.`}
        rotuloBotao="Remover"
        carregando={deletar.isPending}
        onConfirmar={() => emExclusao && deletar.mutate(emExclusao.id)}
        onFechar={() => setEmExclusao(null)}
      />
    </div>
  );
}
