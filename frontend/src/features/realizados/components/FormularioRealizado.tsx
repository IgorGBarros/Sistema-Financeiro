import { useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { api, type Realizado } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";

const esquema = z.object({
  descricao: z.string().min(2, "Dê uma descrição com ao menos 2 caracteres."),
  tipo: z.enum(["RECEITA", "DESPESA"]),
  categoria: z.string().uuid("Escolha uma categoria."),
  valor: z.coerce.number().positive("O valor precisa ser maior que zero."),
  competencia: z.string().min(7, "Informe a competência."),
  data_pagamento: z.string().min(10, "Informe a data de pagamento."),
  forma_pagamento: z.string().default(""),
  observacao: z.string().default(""),
});

type Formulario = z.input<typeof esquema>;

interface Props {
  aberto: boolean;
  realizado: Realizado | null;
  onFechar: () => void;
}

export function FormularioRealizado({ aberto, realizado, onFechar }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  const formulario = useForm<Formulario>({
    resolver: zodResolver(esquema),
    defaultValues: {
      descricao: "",
      tipo: "DESPESA",
      categoria: "",
      valor: 0,
      competencia: hoje().slice(0, 7),
      data_pagamento: hoje(),
      forma_pagamento: "",
      observacao: "",
    },
  });

  const tipo = formulario.watch("tipo");

  useEffect(() => {
    if (!aberto) return;
    if (realizado) {
      formulario.reset({
        descricao: realizado.descricao,
        tipo: realizado.tipo,
        categoria: realizado.categoria,
        valor: Number(realizado.valor),
        competencia: realizado.competencia.slice(0, 7),
        data_pagamento: realizado.data_pagamento,
        forma_pagamento: realizado.forma_pagamento ?? "",
        observacao: realizado.observacao ?? "",
      });
    } else {
      formulario.reset();
    }
    setErroGeral(null);
  }, [aberto, realizado]);

  const categorias = useQuery({
    queryKey: ["categorias", tipo],
    queryFn: () => api.categorias(tipo),
    enabled: aberto,
  });

  const salvar = useMutation({
    mutationFn: (dados: Formulario) =>
      api.salvarRealizado(
        {
          descricao: dados.descricao,
          tipo: dados.tipo,
          categoria: dados.categoria,
          valor: String(dados.valor),
          competencia: `${dados.competencia}-01`,
          data_pagamento: dados.data_pagamento,
          forma_pagamento: dados.forma_pagamento,
          observacao: dados.observacao,
        },
        realizado?.id,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["realizados"] });
      queryClient.invalidateQueries({ queryKey: ["fluxo-caixa"] });
      toast({ title: realizado ? "Alterações salvas" : "Lançamento registrado" });
      onFechar();
    },
    onError: (e: Error) => setErroGeral(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {realizado ? "Editar lançamento" : "Novo lançamento realizado"}
          </DialogTitle>
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
                onClick={() => {
                  formulario.setValue("tipo", valor);
                  formulario.setValue("categoria", "");
                }}
                className={
                  "rounded-md border px-3 py-2 text-sm font-medium transition-colors " +
                  (tipo === valor
                    ? "border-secondary bg-secondary-container text-on-secondary-container"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high")
                }
              >
                {valor === "RECEITA" ? "Entrada" : "Saída"}
              </button>
            ))}
          </div>

          <Campo rotulo="Descrição" erro={formulario.formState.errors.descricao?.message}>
            <Input placeholder="Ex: Conta de luz, Salário…" {...formulario.register("descricao")} />
          </Campo>

          <Campo rotulo="Categoria" erro={formulario.formState.errors.categoria?.message}>
            <select
              className="h-10 w-full rounded-md border border-outline-variant bg-surface-container-low px-3 text-sm text-on-surface"
              {...formulario.register("categoria")}
            >
              <option value="">Escolha…</option>
              {(categorias.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} · {c.classificacao_nome}
                </option>
              ))}
            </select>
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Valor" erro={formulario.formState.errors.valor?.message}>
              <Input type="number" step="0.01" min="0.01" {...formulario.register("valor")} />
            </Campo>
            <Campo rotulo="Forma de pagamento">
              <Input placeholder="Pix, cartão, boleto…" {...formulario.register("forma_pagamento")} />
            </Campo>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Competência (mês/ano)" erro={formulario.formState.errors.competencia?.message}>
              <Input type="month" {...formulario.register("competencia")} />
            </Campo>
            <Campo rotulo="Data de pagamento" erro={formulario.formState.errors.data_pagamento?.message}>
              <Input type="date" {...formulario.register("data_pagamento")} />
            </Campo>
          </div>

          <Campo rotulo="Observação">
            <Input placeholder="Opcional" {...formulario.register("observacao")} />
          </Campo>

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
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-on-surface">{rotulo}</label>
      {children}
      {erro && <p className="text-xs text-error">{erro}</p>}
    </div>
  );
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}
