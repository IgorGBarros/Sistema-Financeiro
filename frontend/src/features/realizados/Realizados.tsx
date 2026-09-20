import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Check, CircleDollarSign, Clock, Download, Link2, MessageSquare, Pencil, Plus, Trash2, Wallet } from "lucide-react";

import { api, ApiError, type Parcela, type Realizado } from "@/shared/lib/api";
import { exportarCsv } from "@/shared/lib/exportar";
import { FormularioRealizado } from "@/features/realizados/components/FormularioRealizado";
import { ModalConfirmacao } from "@/shared/components/ModalConfirmacao";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Kpi } from "@/shared/components/Kpi";
import { Selo } from "@/shared/components/Selo";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";
import { cn } from "@/shared/lib/utils";

const iso = (data: Date) => data.toISOString().slice(0, 10);

const dataCurta = (valor: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(
    new Date(`${valor}T12:00:00`),
  );

/**
 * A tela que faltava para o sistema ter dados de realizado.
 *
 * Sem ela, a projeção existia mas nada nunca virava "aconteceu" — e o
 * confronto previsto × realizado, a aderência e a previsão estatística ficavam
 * todos vazios, porque todos dependem de histórico realizado.
 */
export default function Realizados() {
  const hoje = new Date();
  const [mes, setMes] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)));
  const [baixando, setBaixando] = useState<Parcela | null>(null);
  const [editando, setEditando] = useState<Realizado | null>(null);
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [excluindo, setExcluindo] = useState<Realizado | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<"TODOS" | "RECEITA" | "DESPESA">("TODOS");
  const [filtroClassificacao, setFiltroClassificacao] = useState<string>("TODAS");
  const [filtroOrigem, setFiltroOrigem] = useState<string>("TODAS");
  const [vincularAberto, setVincularAberto] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const parcelas = useQuery({
    queryKey: ["parcelas", mes],
    queryFn: () => api.parcelas({ competencia: mes }),
  });

  const realizados = useQuery({
    queryKey: ["realizados", mes, filtroTipo],
    queryFn: () =>
      api.realizados({
        competencia: mes,
        ...(filtroTipo !== "TODOS" ? { tipo: filtroTipo } : {}),
      }),
  });

  const { pendentes, pagas } = useMemo(() => {
    const lista = parcelas.data ?? [];
    return {
      pendentes: lista.filter((p) => !p.pago),
      pagas: lista.filter((p) => p.pago),
    };
  }, [parcelas.data]);

  const totalPendente = pendentes.reduce((t, p) => t + Number(p.valor_previsto), 0);

  const classificacoes = useMemo(() => {
    const nomes = new Set((realizados.data ?? []).map((r) => r.classificacao_nome).filter(Boolean));
    return Array.from(nomes).sort();
  }, [realizados.data]);

  const origens = useMemo(() => {
    const set = new Set((realizados.data ?? []).map((r) => r.origem));
    return Array.from(set).sort();
  }, [realizados.data]);

  const realizadosFiltrados = useMemo(() => {
    return (realizados.data ?? []).filter((r) => {
      if (filtroClassificacao !== "TODAS" && r.classificacao_nome !== filtroClassificacao) return false;
      if (filtroOrigem !== "TODAS" && r.origem !== filtroOrigem) return false;
      return true;
    });
  }, [realizados.data, filtroClassificacao, filtroOrigem]);

  const totalPago = realizadosFiltrados.reduce((t, r) => t + Number(r.valor), 0);

  const excluir = useMutation({
    mutationFn: (id: string) => api.deletarRealizado(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["realizados"] });
      queryClient.invalidateQueries({ queryKey: ["fluxo-caixa"] });
      toast({ title: "Lançamento excluído" });
      setExcluindo(null);
    },
    onError: (e: ApiError) =>
      toast({ variant: "destructive", title: "Erro ao excluir", description: e.message }),
  });

  function mudarMes(passo: number) {
    const [ano, m] = mes.split("-").map(Number);
    setMes(iso(new Date(ano, m - 1 + passo, 1)));
  }

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Lançamentos"
        descricao="Marque o que já foi pago ou recebido. É isto que alimenta a comparação com o previsto."
        acoes={
          <div className="flex items-center gap-stack-sm">
          <Button
            variant="outline"
            onClick={() =>
              exportarCsv(
                `lancamentos-${mes}`,
                (realizados.data ?? []).map((r) => ({
                  descricao: r.descricao,
                  tipo: r.tipo,
                  categoria: r.categoria_nome,
                  valor: r.valor,
                  competencia: r.competencia,
                  data_pagamento: r.data_pagamento,
                  forma_pagamento: r.forma_pagamento,
                  origem: r.origem,
                })),
              )
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
          <Button variant="outline" onClick={() => setVincularAberto(true)}>
            <Link2 className="mr-2 h-4 w-4" />
            Vincular órfãos
          </Button>
          <Button onClick={() => { setEditando(null); setFormularioAberto(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            Novo lançamento
          </Button>
          <div className="flex items-center gap-1 rounded-lg bg-surface-container-low p-1">
            <Button variant="ghost" size="sm" onClick={() => mudarMes(-1)}>
              ←
            </Button>
            <span className="min-w-28 text-center text-body-sm font-semibold">
              {formatarCompetencia(mes)}
            </span>
            <Button variant="ghost" size="sm" onClick={() => mudarMes(1)}>
              →
            </Button>
          </div>
          </div>
        }
      />

      <div className="mb-container-padding grid grid-cols-1 gap-container-padding md:grid-cols-3">
        <Kpi
          rotulo="A pagar ou receber"
          valor={formatarMoeda(totalPendente)}
          icone={Clock}
          tom={totalPendente > 0 ? "despesa" : "neutro"}
          apoio={`${pendentes.length} parcela(s) em aberto`}
          carregando={parcelas.isLoading}
        />
        <Kpi
          rotulo="Já lançado no mês"
          valor={formatarMoeda(totalPago)}
          icone={Check}
          tom="receita"
          apoio={`${(realizados.data ?? []).length} lançamento(s)`}
          carregando={realizados.isLoading}
        />
        <Kpi
          rotulo="Parcelas baixadas"
          valor={`${pagas.length}/${(parcelas.data ?? []).length}`}
          icone={CalendarCheck}
          apoio="Do previsto para este mês"
          carregando={parcelas.isLoading}
        />
      </div>

      <section className="cartao mb-container-padding overflow-hidden">
        <div className="border-b border-outline-variant bg-surface p-stack-md">
          <h2 className="text-headline-sm text-on-surface">Previsto para este mês</h2>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Cada parcela vem da vigência do contrato. Marcar como paga cria o
            lançamento realizado com a data e o valor que realmente saíram.
          </p>
        </div>

        {parcelas.isLoading ? (
          <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
            Carregando…
          </p>
        ) : (parcelas.data ?? []).length === 0 ? (
          <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
            Nenhuma parcela prevista para {formatarCompetencia(mes)}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  <th className="rotulo px-gutter-table py-2">Descrição</th>
                  <th className="rotulo w-20 px-gutter-table py-2">Vence</th>
                  <th className="rotulo px-gutter-table py-2 text-right">Previsto</th>
                  <th className="rotulo w-36 px-gutter-table py-2 text-center">Situação</th>
                </tr>
              </thead>
              <tbody className="text-body-sm">
                {(parcelas.data ?? []).map((parcela) => (
                  <tr
                    key={parcela.id}
                    className={cn(
                      "h-[40px] border-b border-outline-variant",
                      parcela.pago && "opacity-60",
                    )}
                  >
                    <td className="px-gutter-table">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            parcela.tipo === "RECEITA" ? "bg-receita" : "bg-despesa",
                          )}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-on-surface">
                            {parcela.contrato_descricao}
                          </p>
                          <p className="truncate text-[11px] text-on-surface-variant">
                            {parcela.categoria} · parcela {parcela.indice + 1}/
                            {parcela.quantidade_planejada}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-gutter-table tabular text-on-surface-variant">
                      {dataCurta(parcela.data_planejada)}
                    </td>
                    <td
                      className={cn(
                        "px-gutter-table text-right tabular",
                        parcela.tipo === "RECEITA" ? "text-receita" : "text-despesa",
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
                        <Button size="sm" variant="outline" onClick={() => setBaixando(parcela)}>
                          Marcar como pago
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="cartao overflow-hidden">
        <div className="border-b border-outline-variant bg-surface p-stack-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-headline-sm text-on-surface">Lançado em {formatarCompetencia(mes)}</h2>
            <div className="flex flex-wrap gap-1">
              {(["TODOS", "RECEITA", "DESPESA"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFiltroTipo(t)}
                  className={cn(
                    "rounded px-2.5 py-1 text-body-sm transition-colors",
                    filtroTipo === t
                      ? "bg-secondary-container font-semibold text-on-secondary-container"
                      : "text-on-surface-variant hover:bg-surface-container-high",
                  )}
                >
                  {t === "TODOS" ? "Todos" : t === "RECEITA" ? "Receitas" : "Despesas"}
                </button>
              ))}
              {classificacoes.length > 0 && (
                <select
                  className="rounded border border-outline-variant bg-surface-container-low px-2 py-1 text-body-sm text-on-surface"
                  value={filtroClassificacao}
                  onChange={(e) => setFiltroClassificacao(e.target.value)}
                >
                  <option value="TODAS">Todas as classificações</option>
                  {classificacoes.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
              {origens.length > 1 && (
                <select
                  className="rounded border border-outline-variant bg-surface-container-low px-2 py-1 text-body-sm text-on-surface"
                  value={filtroOrigem}
                  onChange={(e) => setFiltroOrigem(e.target.value)}
                >
                  <option value="TODAS">Todas as origens</option>
                  {origens.map((o) => (
                    <option key={o} value={o}>{o.toLowerCase()}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
        {(realizados.data ?? []).length === 0 ? (
          <Card className="border-0 shadow-none">
            <CardContent className="flex flex-col items-center gap-2 py-stack-lg text-center">
              <CircleDollarSign className="h-8 w-8 text-on-surface-variant" />
              <p className="text-body-sm text-on-surface-variant">
                Nada lançado ainda neste mês.
              </p>
            </CardContent>
          </Card>
        ) : realizadosFiltrados.length === 0 ? (
          <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
            Nenhum lançamento com esse filtro.
          </p>
        ) : (
          <div className="divide-y divide-outline-variant">
            {realizadosFiltrados.map((lancamento) => (
              <div
                key={lancamento.id}
                className="group flex items-center justify-between gap-stack-md p-stack-md"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-on-surface">{lancamento.descricao}</p>
                    {lancamento.observacao && (
                      <span title={lancamento.observacao} className="shrink-0 cursor-help text-on-surface-variant">
                        <MessageSquare className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                  <p className="text-body-sm text-on-surface-variant">
                    {lancamento.classificacao_nome && `${lancamento.classificacao_nome} · `}
                    {lancamento.categoria_nome} · pago em {dataCurta(lancamento.data_pagamento)}
                    {lancamento.origem !== "MANUAL" && ` · ${lancamento.origem.toLowerCase()}`}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 tabular font-semibold",
                    lancamento.tipo === "RECEITA" ? "text-receita" : "text-despesa",
                  )}
                >
                  {formatarMoeda(lancamento.valor)}
                </span>
                {lancamento.origem === "MANUAL" && (
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-secondary"
                      title="Editar"
                      onClick={() => { setEditando(lancamento); setFormularioAberto(true); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-on-error-container"
                      title="Excluir"
                      onClick={() => setExcluindo(lancamento)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <DialogoBaixa parcela={baixando} onFechar={() => setBaixando(null)} />

      <DialogVincularOrfaos aberto={vincularAberto} onFechar={() => setVincularAberto(false)} />

      <FormularioRealizado
        aberto={formularioAberto}
        realizado={editando}
        onFechar={() => { setFormularioAberto(false); setEditando(null); }}
      />

      <ModalConfirmacao
        aberto={Boolean(excluindo)}
        titulo="Excluir lançamento"
        mensagem={`Deseja excluir "${excluindo?.descricao}"? Esta ação não pode ser desfeita.`}
        rotuloBotao="Excluir"
        carregando={excluir.isPending}
        onConfirmar={() => excluindo && excluir.mutate(excluindo.id)}
        onFechar={() => setExcluindo(null)}
      />
    </div>
  );
}

/**
 * Vincula lançamentos sem contrato ao contrato de mesma descrição.
 *
 * GET simula; POST aplica. Útil após importar extratos antigos: as descrições
 * coincidem mas o campo contrato chegou em branco.
 */
function DialogVincularOrfaos({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const simulacao = useQuery({
    queryKey: ["vincular-realizados-simulacao"],
    queryFn: () => api.simularVinculoRealizados(),
    enabled: aberto,
  });

  const aplicar = useMutation({
    mutationFn: () => api.aplicarVinculoRealizados(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["realizados"] });
      toast({ title: `${res.vinculados.length} lançamento(s) vinculado(s)` });
      onFechar();
    },
    onError: (e: ApiError) =>
      toast({ variant: "destructive", title: "Erro ao vincular", description: e.message }),
  });

  const dados = simulacao.data;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Vincular lançamentos órfãos</DialogTitle>
        </DialogHeader>

        {simulacao.isLoading ? (
          <p className="py-4 text-center text-body-sm text-on-surface-variant">Simulando…</p>
        ) : !dados ? null : (
          <div className="space-y-4">
            <p className="text-body-sm text-on-surface-variant">
              {dados.total_orfaos} lançamento(s) sem contrato no histórico.{" "}
              {dados.vinculados.length > 0
                ? `${dados.vinculados.length} podem ser vinculados por descrição.`
                : "Nenhum pode ser vinculado automaticamente."}
            </p>

            {dados.vinculados.length > 0 && (
              <div className="max-h-60 overflow-y-auto rounded-md border border-outline-variant">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-outline-variant bg-surface-container-low">
                      <th className="rotulo px-gutter-table py-1.5">Lançamento</th>
                      <th className="rotulo px-gutter-table py-1.5">Contrato</th>
                    </tr>
                  </thead>
                  <tbody className="text-body-sm">
                    {dados.vinculados.map((v, i) => (
                      <tr key={i} className="h-[36px] border-b border-outline-variant">
                        <td className="max-w-[180px] truncate px-gutter-table text-on-surface">
                          {v.realizado_descricao ?? v.realizado}
                        </td>
                        <td className="max-w-[180px] truncate px-gutter-table text-on-surface-variant">
                          {v.contrato_descricao ?? v.contrato}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onFechar}>Fechar</Button>
              {dados.vinculados.length > 0 && (
                <Button onClick={() => aplicar.mutate()} disabled={aplicar.isPending}>
                  <Link2 className="mr-2 h-4 w-4" />
                  {aplicar.isPending ? "Vinculando…" : `Aplicar (${dados.vinculados.length})`}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Baixa da parcela.
 *
 * O valor vem preenchido com o previsto, mas é editável: a conta de luz quase
 * nunca sai pelo valor projetado, e forçar o previsto criaria um realizado
 * falso — justamente o dado que a previsão vai usar para aprender.
 */
function DialogoBaixa({
  parcela,
  onFechar,
}: {
  parcela: Parcela | null;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [valor, setValor] = useState("");
  const [data, setData] = useState("");

  const aberto = Boolean(parcela);
  const valorEfetivo = valor || parcela?.valor_previsto || "0";
  const dataEfetiva = data || parcela?.data_planejada || "";
  const diferenca = parcela
    ? Number(valorEfetivo) - Number(parcela.valor_previsto)
    : 0;

  const baixar = useMutation({
    mutationFn: () => api.baixarParcela(parcela!.id, valorEfetivo, dataEfetiva),
    onSuccess: () => {
      for (const chave of ["parcelas", "realizados", "fluxo-caixa", "confronto", "previsao"]) {
        queryClient.invalidateQueries({ queryKey: [chave] });
      }
      toast({ title: "Lançamento registrado" });
      setValor("");
      setData("");
      onFechar();
    },
    onError: (erro: ApiError) =>
      toast({ variant: "destructive", title: "Não deu para registrar", description: erro.message }),
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Marcar como pago</DialogTitle>
        </DialogHeader>

        {parcela && (
          <div className="space-y-stack-md">
            <div className="rounded-lg border border-outline-variant bg-surface-container-low p-stack-sm">
              <p className="font-medium text-on-surface">{parcela.contrato_descricao}</p>
              <p className="text-body-sm text-on-surface-variant">
                Previsto: {formatarMoeda(parcela.valor_previsto)} em{" "}
                {dataCurta(parcela.data_planejada)}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-body-sm font-medium">Valor pago</label>
              <Input
                type="number"
                step="0.01"
                value={valor}
                placeholder={parcela.valor_previsto}
                onChange={(e) => setValor(e.target.value)}
              />
              {Math.abs(diferenca) > 0.01 && (
                <p className="text-[11px] text-on-surface-variant">
                  {diferenca > 0 ? "Acima" : "Abaixo"} do previsto em{" "}
                  {formatarMoeda(Math.abs(diferenca))}.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-body-sm font-medium">Data do pagamento</label>
              <Input
                type="date"
                value={data}
                placeholder={parcela.data_planejada}
                onChange={(e) => setData(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-stack-sm">
              <Button variant="ghost" onClick={onFechar}>
                Cancelar
              </Button>
              <Button onClick={() => baixar.mutate()} disabled={baixar.isPending}>
                <Wallet className="mr-2 h-4 w-4" />
                {baixar.isPending ? "Registrando…" : "Registrar"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
