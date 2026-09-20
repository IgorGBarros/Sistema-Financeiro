import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { api, ApiError, type Contrato, type Frequencia } from "@/shared/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";

const esquema = z
  .object({
    descricao: z.string().min(2, "Dê um nome que você reconheça na lista."),
    tipo: z.enum(["RECEITA", "DESPESA"]),
    categoria: z.string().uuid("Escolha uma categoria."),
    estabelecimento: z.string().uuid("Escolha de onde vem ou para onde vai."),
    valor_unitario: z.coerce.number().positive("O valor precisa ser maior que zero."),
    frequencia: z.enum(["M", "B", "T", "S", "A", "U"]),
    data_inicio: z.string().min(10, "Informe a data de início."),
    data_fim: z.string().min(10, "Informe a data de fim."),
    reajuste_anual_pct: z.coerce.number().min(0).max(100).default(0),
  })
  .refine((dados) => dados.data_fim >= dados.data_inicio, {
    path: ["data_fim"],
    message: "A data de fim não pode ser anterior ao início.",
  });

type Formulario = z.input<typeof esquema>;

const FREQUENCIAS: { valor: Frequencia; rotulo: string }[] = [
  { valor: "M", rotulo: "Mensal" },
  { valor: "B", rotulo: "Bimestral" },
  { valor: "T", rotulo: "Trimestral" },
  { valor: "S", rotulo: "Semestral" },
  { valor: "A", rotulo: "Anual" },
  { valor: "U", rotulo: "Única" },
];

interface Props {
  aberto: boolean;
  contrato: Contrato | null;
  /** Dados para pré-preencher o formulário como novo contrato (duplicação). */
  dadosIniciais?: Partial<Contrato>;
  onFechar: () => void;
}

export function FormularioContrato({ aberto, contrato, dadosIniciais, onFechar }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  const formulario = useForm<Formulario>({
    resolver: zodResolver(esquema),
    defaultValues: {
      tipo: "DESPESA",
      frequencia: "M",
      reajuste_anual_pct: 0,
      descricao: "",
      valor_unitario: 0,
      data_inicio: "",
      data_fim: "",
      categoria: "",
      estabelecimento: "",
    },
  });

  const tipo = formulario.watch("tipo");

  useEffect(() => {
    if (!aberto) return;
    const fonte = contrato ?? (dadosIniciais as Contrato | null);
    if (fonte) {
      formulario.reset({
        descricao: fonte.descricao ?? "",
        tipo: fonte.tipo ?? "DESPESA",
        categoria: fonte.categoria ?? "",
        estabelecimento: fonte.estabelecimento ?? "",
        valor_unitario: Number(fonte.valor_unitario ?? 0),
        frequencia: fonte.frequencia ?? "M",
        data_inicio: fonte.data_inicio ?? "",
        data_fim: fonte.data_fim ?? "",
        reajuste_anual_pct: Number(fonte.reajuste_anual_pct ?? 0),
      });
    } else {
      formulario.reset();
    }
    setErroGeral(null);
  }, [aberto, contrato, dadosIniciais]);

  const categorias = useQuery({
    queryKey: ["categorias", tipo],
    queryFn: () => api.categorias(tipo),
    enabled: aberto,
  });

  const estabelecimentos = useQuery({
    queryKey: ["estabelecimentos"],
    queryFn: () => api.estabelecimentos(),
    enabled: aberto,
  });

  // Preview da projeção. Roda no backend para garantir que o número mostrado
  // aqui é o mesmo que será gravado — reimplementar a regra no frontend seria
  // criar duas fontes de verdade.
  const valores = formulario.watch();
  const podeSimular =
    Boolean(valores.data_inicio && valores.data_fim && Number(valores.valor_unitario) > 0) &&
    valores.data_fim >= valores.data_inicio;

  const simulacao = useQuery({
    queryKey: [
      "simulacao",
      valores.data_inicio,
      valores.data_fim,
      valores.valor_unitario,
      valores.frequencia,
      valores.reajuste_anual_pct,
    ],
    queryFn: () =>
      api.simularContrato({
        data_inicio: valores.data_inicio,
        data_fim: valores.data_fim,
        valor_unitario: String(valores.valor_unitario),
        frequencia: valores.frequencia,
        reajuste_anual_pct: String(valores.reajuste_anual_pct ?? 0),
      }),
    enabled: aberto && podeSimular,
  });

  const salvar = useMutation({
    mutationFn: (dados: Formulario) => {
      const categoriaEscolhida = categorias.data?.find((c) => c.id === dados.categoria);
      return api.salvarContrato(
        {
          descricao: dados.descricao,
          tipo: dados.tipo,
          categoria: dados.categoria,
          classificacao: categoriaEscolhida?.classificacao,
          estabelecimento: dados.estabelecimento,
          valor_unitario: String(dados.valor_unitario),
          frequencia: dados.frequencia,
          data_inicio: dados.data_inicio,
          data_fim: dados.data_fim,
          reajuste_anual_pct: String(dados.reajuste_anual_pct ?? 0),
        },
        contrato?.id,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contratos"] });
      queryClient.invalidateQueries({ queryKey: ["fluxo-caixa"] });
      toast({
        title: contrato ? "Alterações salvas" : "Cadastrado",
        description: "A projeção foi recalculada.",
      });
      onFechar();
    },
    onError: (erro: ApiError) => {
      // Erro de campo vai para o campo; o resto vira mensagem no topo.
      const campos = erro.campos ?? {};
      let tratou = false;
      for (const [campo, mensagens] of Object.entries(campos)) {
        if (campo in formulario.getValues() && Array.isArray(mensagens)) {
          formulario.setError(campo as keyof Formulario, { message: mensagens[0] });
          tratou = true;
        }
      }
      if (!tratou) setErroGeral(erro.message);
    },
  });

  const resumoProjecao = useMemo(() => {
    if (!simulacao.data) return null;
    const { quantidade_parcelas, valor_total, parcelas } = simulacao.data;
    return {
      quantidade: quantidade_parcelas,
      total: valor_total,
      primeira: parcelas[0],
      ultima: parcelas[parcelas.length - 1],
    };
  }, [simulacao.data]);

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {contrato ? "Editar entrada ou saída" : "Nova entrada ou saída"}
          </DialogTitle>
        </DialogHeader>

        {erroGeral && (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {erroGeral}
          </p>
        )}

        <form
          className="space-y-4"
          onSubmit={formulario.handleSubmit((dados) => salvar.mutate(dados))}
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
                    ? "border-primary bg-secondary"
                    : "text-muted-foreground hover:bg-accent")
                }
              >
                {valor === "RECEITA" ? "Entrada" : "Saída"}
              </button>
            ))}
          </div>

          <Campo rotulo="Descrição" erro={formulario.formState.errors.descricao?.message}>
            <Input placeholder="Aluguel, salário, escola…" {...formulario.register("descricao")} />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Categoria" erro={formulario.formState.errors.categoria?.message}>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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

            <Campo
              rotulo={tipo === "RECEITA" ? "Pagador" : "Recebedor"}
              erro={formulario.formState.errors.estabelecimento?.message}
            >
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                {...formulario.register("estabelecimento")}
              >
                <option value="">Escolha…</option>
                {(estabelecimentos.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Valor" erro={formulario.formState.errors.valor_unitario?.message}>
              <Input
                type="number"
                step="0.01"
                min="0"
                {...formulario.register("valor_unitario")}
              />
            </Campo>
            <Campo rotulo="Frequência">
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                {...formulario.register("frequencia")}
              >
                {FREQUENCIAS.map((f) => (
                  <option key={f.valor} value={f.valor}>
                    {f.rotulo}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Início" erro={formulario.formState.errors.data_inicio?.message}>
              <Input type="date" {...formulario.register("data_inicio")} />
            </Campo>
            <Campo rotulo="Fim" erro={formulario.formState.errors.data_fim?.message}>
              <Input type="date" {...formulario.register("data_fim")} />
            </Campo>
          </div>

          <Campo rotulo="Reajuste anual (%)">
            <Input
              type="number"
              step="0.1"
              min="0"
              {...formulario.register("reajuste_anual_pct")}
            />
          </Campo>

          {resumoProjecao && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">
                {resumoProjecao.quantidade} parcela
                {resumoProjecao.quantidade === 1 ? "" : "s"} ·{" "}
                {formatarMoeda(resumoProjecao.total)} no total
              </p>
              {resumoProjecao.primeira && resumoProjecao.ultima && (
                <p className="text-muted-foreground">
                  De {formatarCompetencia(resumoProjecao.primeira.competencia)} até{" "}
                  {formatarCompetencia(resumoProjecao.ultima.competencia)}.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Campo({
  rotulo,
  erro,
  children,
}: {
  rotulo: string;
  erro?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{rotulo}</label>
      {children}
      {erro && <p className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}
