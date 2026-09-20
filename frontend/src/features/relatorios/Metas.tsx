import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Target, Trash2 } from "lucide-react";

import { api, ApiError, type MetaOrcamentaria } from "@/shared/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";
import { cn } from "@/shared/lib/utils";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function Metas() {
  const hoje = new Date();
  const mes = iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<MetaOrcamentaria | null>(null);
  const [categoriaId, setCategoriaId] = useState("");
  const [teto, setTeto] = useState("");

  const metas = useQuery({
    queryKey: ["metas-orcamentarias"],
    queryFn: () => api.metasOrcamentarias(),
  });

  const categorias = useQuery({
    queryKey: ["categorias", "DESPESA"],
    queryFn: () => api.categorias("DESPESA"),
  });

  const realizados = useQuery({
    queryKey: ["realizados", mes],
    queryFn: () => api.realizados({ competencia: mes }),
  });

  const gastosPorCategoria = (realizados.data ?? [])
    .filter((r) => r.tipo === "DESPESA")
    .reduce<Record<string, number>>((acc, r) => {
      acc[r.categoria] = (acc[r.categoria] ?? 0) + Number(r.valor);
      return acc;
    }, {});

  const salvar = useMutation({
    mutationFn: () =>
      api.salvarMeta(
        { categoria: categoriaId, teto },
        editando?.id,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["metas-orcamentarias"] });
      toast({ title: editando ? "Meta atualizada" : "Meta criada" });
      setModalAberto(false);
    },
    onError: (e: ApiError) =>
      toast({ variant: "destructive", title: "Erro ao salvar", description: e.message }),
  });

  const excluirMeta = useMutation({
    mutationFn: (id: string) => api.deletarMeta(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["metas-orcamentarias"] });
      toast({ title: "Meta removida" });
    },
    onError: (e: ApiError) =>
      toast({ variant: "destructive", title: "Erro ao excluir", description: e.message }),
  });

  function abrirNova() {
    setEditando(null);
    setCategoriaId("");
    setTeto("");
    setModalAberto(true);
  }

  function abrirEditar(meta: MetaOrcamentaria) {
    setEditando(meta);
    setCategoriaId(meta.categoria);
    setTeto(meta.teto);
    setModalAberto(true);
  }

  const lista = metas.data ?? [];

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Metas orçamentárias"
        descricao={`Tetos por categoria para ${formatarCompetencia(mes)}. Sincronizados entre dispositivos.`}
        acoes={
          <Button onClick={abrirNova}>
            <Plus className="mr-2 h-4 w-4" />
            Nova meta
          </Button>
        }
      />

      {metas.isLoading ? (
        <p className="py-stack-lg text-center text-body-sm text-on-surface-variant">Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="cartao flex flex-col items-center gap-3 p-stack-lg text-center">
          <Target className="h-8 w-8 text-on-surface-variant" />
          <p className="text-body-sm text-on-surface-variant">
            Nenhuma meta definida ainda. Crie uma para acompanhar o orçamento.
          </p>
          <Button variant="outline" onClick={abrirNova}>
            Criar primeira meta
          </Button>
        </div>
      ) : (
        <div className="grid gap-container-padding sm:grid-cols-2 lg:grid-cols-3">
          {lista.map((meta) => {
            const gasto = gastosPorCategoria[meta.categoria] ?? 0;
            const tetoNum = Number(meta.teto);
            const pct = Math.min((gasto / tetoNum) * 100, 100);
            const excedeu = gasto > tetoNum;
            return (
              <div key={meta.id} className="cartao group p-stack-md">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-on-surface">{meta.categoria_nome}</p>
                    <p className="text-body-sm text-on-surface-variant">
                      Teto: {formatarMoeda(meta.teto)}
                    </p>
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => abrirEditar(meta)}
                      className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => excluirMeta.mutate(meta.id)}
                      className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-on-error-container"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mb-2 h-2 overflow-hidden rounded-full bg-surface-container-high">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      excedeu ? "bg-despesa" : pct >= 80 ? "bg-amber-500" : "bg-receita",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex justify-between text-body-sm">
                  <span className={cn(excedeu ? "font-semibold text-despesa" : "text-on-surface")}>
                    {formatarMoeda(gasto)}
                  </span>
                  <span className={cn(
                    "font-semibold",
                    excedeu ? "text-despesa" : pct >= 80 ? "text-amber-600" : "text-on-surface-variant",
                  )}>
                    {Math.round(pct)}%
                    {excedeu && ` (+${formatarMoeda(gasto - tetoNum)})`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={modalAberto} onOpenChange={(v) => !v && setModalAberto(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar meta" : "Nova meta orçamentária"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Categoria de despesa</label>
              <select
                value={categoriaId}
                onChange={(e) => setCategoriaId(e.target.value)}
                disabled={Boolean(editando)}
                className="h-10 w-full rounded-md border border-outline-variant bg-surface-container-low px-3 text-sm text-on-surface disabled:opacity-60"
              >
                <option value="">Escolha…</option>
                {(categorias.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Teto mensal (R$)</label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={teto}
                onChange={(e) => setTeto(e.target.value)}
                placeholder="Ex: 800"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setModalAberto(false)}>Cancelar</Button>
              <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
                {salvar.isPending ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
