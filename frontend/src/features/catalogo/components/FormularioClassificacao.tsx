import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { api, type Classificacao } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";

const esquema = z.object({
  nome: z.string().min(2, "Dê um nome com ao menos 2 caracteres."),
  descricao: z.string().default(""),
  peso: z.coerce.number().int().min(-10).max(10).default(0),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida.").default("#64748b"),
  ordem: z.coerce.number().int().min(0).default(0),
  ativo: z.boolean().default(true),
});

type Formulario = z.input<typeof esquema>;

interface Props {
  aberto: boolean;
  classificacao: Classificacao | null;
  onFechar: () => void;
}

export function FormularioClassificacao({ aberto, classificacao, onFechar }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  const formulario = useForm<Formulario>({
    resolver: zodResolver(esquema),
    defaultValues: { nome: "", descricao: "", peso: 0, cor: "#64748b", ordem: 0, ativo: true },
  });

  useEffect(() => {
    if (!aberto) return;
    if (classificacao) {
      formulario.reset({
        nome: classificacao.nome,
        descricao: classificacao.descricao,
        peso: classificacao.peso,
        cor: classificacao.cor,
        ordem: classificacao.ordem,
        ativo: classificacao.ativo,
      });
    } else {
      formulario.reset();
    }
    setErroGeral(null);
  }, [aberto, classificacao]);

  const salvar = useMutation({
    mutationFn: (dados: Formulario) => api.salvarClassificacao(dados, classificacao?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classificacoes"] });
      toast({ title: classificacao ? "Alterações salvas" : "Classificação criada" });
      onFechar();
    },
    onError: (e: Error) => setErroGeral(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {classificacao ? "Editar classificação" : "Nova classificação"}
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
          <Campo rotulo="Nome" erro={formulario.formState.errors.nome?.message}>
            <Input placeholder="Ex: Essenciais, Lazer, Operacional…" {...formulario.register("nome")} />
          </Campo>

          <Campo rotulo="Descrição">
            <Input placeholder="Descrição opcional" {...formulario.register("descricao")} />
          </Campo>

          <div className="grid grid-cols-3 gap-3">
            <Campo rotulo="Peso" erro={formulario.formState.errors.peso?.message}>
              <Input type="number" step="1" min="-10" max="10" {...formulario.register("peso")} />
            </Campo>
            <Campo rotulo="Ordem">
              <Input type="number" step="1" min="0" {...formulario.register("ordem")} />
            </Campo>
            <Campo rotulo="Cor" erro={formulario.formState.errors.cor?.message}>
              <Input type="color" className="h-10 cursor-pointer p-1" {...formulario.register("cor")} />
            </Campo>
          </div>

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
