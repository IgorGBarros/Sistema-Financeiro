import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { api, type Estabelecimento } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";

const esquema = z.object({
  nome: z.string().min(2, "Dê um nome com ao menos 2 caracteres."),
  cnpj: z
    .string()
    .regex(/^\d{14}$/, "CNPJ deve ter 14 dígitos (só números).")
    .or(z.literal(""))
    .default(""),
  codigo: z.coerce.number().int().positive().optional().or(z.literal("")).transform((v) =>
    v === "" ? undefined : v,
  ),
});

type Formulario = z.input<typeof esquema>;

interface Props {
  aberto: boolean;
  estabelecimento: Estabelecimento | null;
  onFechar: () => void;
}

export function FormularioEstabelecimento({ aberto, estabelecimento, onFechar }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  const formulario = useForm<Formulario>({
    resolver: zodResolver(esquema),
    defaultValues: { nome: "", cnpj: "", codigo: "" },
  });

  useEffect(() => {
    if (!aberto) return;
    if (estabelecimento) {
      formulario.reset({
        nome: estabelecimento.nome,
        cnpj: estabelecimento.cnpj ?? "",
        codigo: estabelecimento.codigo ?? "",
      });
    } else {
      formulario.reset();
    }
    setErroGeral(null);
  }, [aberto, estabelecimento]);

  const salvar = useMutation({
    mutationFn: (dados: Formulario) =>
      api.salvarEstabelecimento(
        {
          nome: dados.nome,
          cnpj: dados.cnpj || undefined,
          codigo: dados.codigo ? Number(dados.codigo) : null,
        },
        estabelecimento?.id,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["estabelecimentos"] });
      toast({ title: estabelecimento ? "Alterações salvas" : "Estabelecimento criado" });
      onFechar();
    },
    onError: (e: Error) => setErroGeral(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {estabelecimento ? "Editar estabelecimento" : "Novo estabelecimento"}
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
            <Input placeholder="Ex: Supermercado, Empresa XYZ…" {...formulario.register("nome")} />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="CNPJ (14 dígitos)" erro={formulario.formState.errors.cnpj?.message}>
              <Input
                placeholder="00000000000000"
                maxLength={14}
                {...formulario.register("cnpj")}
              />
            </Campo>
            <Campo rotulo="Código interno">
              <Input type="number" min="1" placeholder="Opcional" {...formulario.register("codigo")} />
            </Campo>
          </div>

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
