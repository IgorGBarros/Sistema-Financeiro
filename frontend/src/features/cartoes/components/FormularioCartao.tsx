import { useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Trash2 } from "lucide-react";

import { api, ApiError, type Cartao } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";

const esquema = z
  .object({
    apelido: z.string().min(2, "Dê um nome que você reconheça na lista."),
    bandeira: z.enum(["VISA", "MASTERCARD", "ELO", "AMEX", "HIPERCARD", "OUTRA"]),
    ultimos_digitos: z
      .string()
      .regex(/^\d{0,4}$/, "Só os quatro últimos números.")
      .optional()
      .or(z.literal("")),
    emissor: z.string().optional(),
    limite: z.coerce.number().min(0).optional(),
    dia_fechamento: z.coerce.number().int().min(1).max(31),
    dia_vencimento: z.coerce.number().int().min(1).max(31),
  })
  .refine((d) => d.dia_fechamento !== d.dia_vencimento, {
    path: ["dia_vencimento"],
    message: "Fechamento e vencimento não podem cair no mesmo dia.",
  });

type Formulario = z.input<typeof esquema>;

const BANDEIRAS = [
  { valor: "VISA", rotulo: "Visa" },
  { valor: "MASTERCARD", rotulo: "Mastercard" },
  { valor: "ELO", rotulo: "Elo" },
  { valor: "AMEX", rotulo: "American Express" },
  { valor: "HIPERCARD", rotulo: "Hipercard" },
  { valor: "OUTRA", rotulo: "Outra" },
] as const;

interface Props {
  aberto: boolean;
  cartao: Cartao | null;
  onFechar: () => void;
}

export function FormularioCartao({ aberto, cartao, onFechar }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);

  const formulario = useForm<Formulario>({
    resolver: zodResolver(esquema),
    defaultValues: {
      apelido: "",
      bandeira: "OUTRA",
      ultimos_digitos: "",
      emissor: "",
      limite: 0,
      dia_fechamento: 25,
      dia_vencimento: 5,
    },
  });

  useEffect(() => {
    if (!aberto) return;
    setErroGeral(null);
    setConfirmarExclusao(false);
    if (cartao) {
      formulario.reset({
        apelido: cartao.apelido,
        bandeira: (cartao.bandeira as Formulario["bandeira"]) ?? "OUTRA",
        ultimos_digitos: cartao.ultimos_digitos ?? "",
        emissor: cartao.emissor ?? "",
        limite: cartao.limite ? Number(cartao.limite) : 0,
        dia_fechamento: cartao.dia_fechamento,
        dia_vencimento: cartao.dia_vencimento,
      });
    } else {
      formulario.reset();
    }
  }, [aberto, cartao]);

  const fechamento = Number(formulario.watch("dia_fechamento"));
  const vencimento = Number(formulario.watch("dia_vencimento"));

  const desativar = useMutation({
    mutationFn: () => api.salvarCartao({ ativo: false }, cartao!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cartoes"] });
      toast({ title: "Cartão desativado" });
      onFechar();
    },
    onError: (erro: ApiError) => setErroGeral(erro.message),
  });

  const excluir = useMutation({
    mutationFn: () => api.deletarCartao(cartao!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cartoes"] });
      queryClient.invalidateQueries({ queryKey: ["cartoes", "painel"] });
      toast({ title: "Cartão excluído", description: "As compras e faturas associadas foram removidas." });
      onFechar();
    },
    onError: (erro: ApiError) => setErroGeral(erro.message),
  });

  const salvar = useMutation({
    mutationFn: (dados: Formulario) =>
      api.salvarCartao(
        {
          apelido: dados.apelido,
          bandeira: dados.bandeira,
          ultimos_digitos: dados.ultimos_digitos || "",
          emissor: dados.emissor || "",
          limite: dados.limite ? String(dados.limite) : null,
          dia_fechamento: Number(dados.dia_fechamento),
          dia_vencimento: Number(dados.dia_vencimento),
        },
        cartao?.id,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cartoes"] });
      toast({
        title: cartao ? "Cartão atualizado" : "Cartão cadastrado",
        description: "As faturas importadas passam a ser reconhecidas por ele.",
      });
      onFechar();
    },
    onError: (erro: ApiError) => {
      let tratou = false;
      for (const [campo, mensagens] of Object.entries(erro.campos ?? {})) {
        if (campo in formulario.getValues() && Array.isArray(mensagens)) {
          formulario.setError(campo as keyof Formulario, { message: mensagens[0] });
          tratou = true;
        }
      }
      if (!tratou) setErroGeral(erro.message);
    },
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{cartao ? "Editar cartão" : "Novo cartão"}</DialogTitle>
        </DialogHeader>

        {erroGeral && (
          <p className="rounded-md bg-error-container p-3 text-body-sm text-on-error-container">
            {erroGeral}
          </p>
        )}

        <form
          className="space-y-stack-md"
          onSubmit={formulario.handleSubmit((dados) => salvar.mutate(dados))}
        >
          <Campo rotulo="Apelido" erro={formulario.formState.errors.apelido?.message}>
            <Input placeholder="Nubank roxinho" {...formulario.register("apelido")} />
          </Campo>

          <div className="grid gap-stack-md sm:grid-cols-2">
            <Campo rotulo="Bandeira">
              <select
                className="h-10 w-full rounded-md border border-outline-variant bg-surface-container-lowest px-3 text-body-sm"
                {...formulario.register("bandeira")}
              >
                {BANDEIRAS.map((b) => (
                  <option key={b.valor} value={b.valor}>
                    {b.rotulo}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo
              rotulo="Quatro últimos dígitos"
              erro={formulario.formState.errors.ultimos_digitos?.message}
              ajuda="É o que permite reconhecer o cartão ao importar a fatura."
            >
              <Input inputMode="numeric" maxLength={4} {...formulario.register("ultimos_digitos")} />
            </Campo>
          </div>

          <div className="grid gap-stack-md sm:grid-cols-2">
            <Campo rotulo="Emissor">
              <Input placeholder="Nubank, Itaú…" {...formulario.register("emissor")} />
            </Campo>
            <Campo rotulo="Limite" ajuda="Deixe zero se preferir não acompanhar.">
              <Input type="number" step="0.01" min="0" {...formulario.register("limite")} />
            </Campo>
          </div>

          <div className="grid gap-stack-md sm:grid-cols-2">
            <Campo
              rotulo="Dia do fechamento"
              erro={formulario.formState.errors.dia_fechamento?.message}
            >
              <Input type="number" min="1" max="31" {...formulario.register("dia_fechamento")} />
            </Campo>
            <Campo
              rotulo="Dia do vencimento"
              erro={formulario.formState.errors.dia_vencimento?.message}
            >
              <Input type="number" min="1" max="31" {...formulario.register("dia_vencimento")} />
            </Campo>
          </div>

          {/* Explicar a regra de corte aqui evita o "achei que ia cair esse
              mês" — que é a dúvida número um sobre cartão. */}
          {fechamento >= 1 && fechamento <= 31 && (
            <p className="rounded-lg border border-outline-variant bg-surface-container-low p-stack-sm text-body-sm text-on-surface-variant">
              Compras até o dia <strong className="text-on-surface">{fechamento}</strong> entram na
              fatura do próprio mês. A partir do dia{" "}
              <strong className="text-on-surface">{fechamento + 1}</strong>, vão para a fatura
              seguinte
              {vencimento <= fechamento
                ? ", que vence no mês depois desse."
                : `, que vence no dia ${vencimento}.`}
            </p>
          )}

          {confirmarExclusao && (
            <div className="rounded-md border border-error/40 bg-error-container p-stack-sm text-body-sm text-on-error-container">
              <p className="font-medium">Excluir permanentemente?</p>
              <p className="mt-0.5 text-[12px]">
                Remove o cartão e todas as compras e faturas vinculadas. Essa ação não pode ser desfeita.
              </p>
              <div className="mt-stack-sm flex gap-stack-sm">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-on-error-container"
                  onClick={() => setConfirmarExclusao(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="bg-error text-on-error hover:bg-error/90"
                  disabled={excluir.isPending}
                  onClick={() => excluir.mutate()}
                >
                  {excluir.isPending ? "Excluindo…" : "Confirmar exclusão"}
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            {cartao ? (
              <div className="flex gap-stack-sm">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-error hover:bg-error-container hover:text-on-error-container"
                  disabled={salvar.isPending || excluir.isPending}
                  onClick={() => desativar.mutate()}
                >
                  Desativar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-error hover:bg-error-container hover:text-on-error-container"
                  disabled={salvar.isPending || excluir.isPending}
                  onClick={() => setConfirmarExclusao(true)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Excluir
                </Button>
              </div>
            ) : <span />}
            <div className="flex gap-stack-sm">
              <Button type="button" variant="ghost" onClick={onFechar}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvar.isPending || excluir.isPending}>
                {salvar.isPending ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Campo({
  rotulo,
  erro,
  ajuda,
  children,
}: {
  rotulo: string;
  erro?: string;
  ajuda?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-body-sm font-medium">{rotulo}</label>
      {children}
      {erro ? (
        <p className="text-[11px] text-error">{erro}</p>
      ) : ajuda ? (
        <p className="text-[11px] text-on-surface-variant">{ajuda}</p>
      ) : null}
    </div>
  );
}
