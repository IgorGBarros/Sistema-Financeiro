import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { api, type Categoria } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";

const esquema = z.object({
  nome: z.string().min(2, "Dê um nome com ao menos 2 caracteres."),
  tipo: z.enum(["RECEITA", "DESPESA"]),
  classificacao: z.string().uuid("Escolha uma classificação."),
  consolida_mercado: z.boolean().default(false),
  ativo: z.boolean().default(true),
});

type Formulario = z.input<typeof esquema>;

interface Props {
  aberto: boolean;
  categoria: Categoria | null;
  onFechar: () => void;
}

export function FormularioCategoria({ aberto, categoria, onFechar }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  const formulario = useForm<Formulario>({
    resolver: zodResolver(esquema),
    defaultValues: {
      nome: "",
      tipo: "DESPESA",
      classificacao: "",
      consolida_mercado: false,
      ativo: true,
    },
  });

  useEffect(() => {
    if (!aberto) return;
    if (categoria) {
      formulario.reset({
        nome: categoria.nome,
        tipo: categoria.tipo,
        classificacao: categoria.classificacao,
        consolida_mercado: categoria.consolida_mercado,
        ativo: categoria.ativo,
      });
    } else {
      formulario.reset();
    }
    setErroGeral(null);
  }, [aberto, categoria]);

  const classificacoes = useQuery({
    queryKey: ["classificacoes"],
    queryFn: () => api.classificacoes(),
    enabled: aberto,
  });

  const salvar = useMutation({
    mutationFn: (dados: Formulario) => api.salvarCategoria(dados, categoria?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias"] });
      toast({ title: categoria ? "Alterações salvas" : "Categoria criada" });
      onFechar();
    },
    onError: (e: Error) => setErroGeral(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{categoria ? "Editar categoria" : "Nova categoria"}</DialogTitle>
        </DialogHeader>

        {erroGeral && (
          <p className="rounded-md bg-error-container p-3 text-sm text-on-error-container">
            {erroGeral}
          </p>
        )}

        <form
          className="space-y-4"
          onSubmit={formulario.handleSubmit((d) => salvar.mutate(d))}
        >
          <div className="grid grid-cols-2 gap-2">
            {(["RECEITA", "DESPESA"] as const).map((valor) => (
              <button
                key={valor}
                type="button"
                onClick={() => formulario.setValue("tipo", valor)}
                className={
                  "rounded-md border px-3 py-2 text-sm font-medium transition-colors " +
                  (formulario.watch("tipo") === valor
                    ? "border-secondary bg-secondary-container text-on-secondary-container"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high")
                }
              >
                {valor === "RECEITA" ? "Entrada" : "Saída"}
              </button>
            ))}
          </div>

          <Campo rotulo="Nome" erro={formulario.formState.errors.nome?.message}>
            <Input placeholder="Ex: Alimentação, Salário…" {...formulario.register("nome")} />
          </Campo>

          <Campo rotulo="Classificação" erro={formulario.formState.errors.classificacao?.message}>
            <select
              className="h-10 w-full rounded-md border border-outline-variant bg-surface-container-low px-3 text-sm text-on-surface"
              {...formulario.register("classificacao")}
            >
              <option value="">Escolha…</option>
              {(classificacoes.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Campo>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...formulario.register("consolida_mercado")}
              className="h-4 w-4 rounded"
            />
            <span className="text-on-surface">Consolida mercado (NFC-e)</span>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...formulario.register("ativo")} className="h-4 w-4 rounded" />
            <span className="text-on-surface">Ativo</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Campo({ rotulo, erro, children }: { rotulo: string; erro?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-on-surface">{rotulo}</label>
      {children}
      {erro && <p className="text-xs text-error">{erro}</p>}
    </div>
  );
}
