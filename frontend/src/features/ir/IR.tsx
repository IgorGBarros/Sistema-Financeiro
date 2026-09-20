import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  AlertCircle,
  Calculator,
  ChevronDown,
  FilePlus,
  Heart,
  PiggyBank,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";

import { api, ApiError, type ResultadoCalculo } from "@/shared/lib/api";
import { formatarMoeda } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Kpi } from "@/shared/components/Kpi";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const anoAtual = new Date().getFullYear();

function moeda(valor: string | number): string {
  return formatarMoeda(Number(valor));
}

function sinal(valor: string | number): { texto: string; cor: string } {
  const n = Number(valor);
  if (Math.abs(n) < 0.01) return { texto: "R$ 0,00", cor: "text-on-surface-variant" };
  if (n < 0) return { texto: `Restituição: ${moeda(Math.abs(n))}`, cor: "text-receita" };
  return { texto: `A pagar: ${moeda(n)}`, cor: "text-despesa" };
}

// ---------------------------------------------------------------------------
// Campo reutilizável
// ---------------------------------------------------------------------------

function Campo({
  rotulo,
  erro,
  children,
}: {
  rotulo: string;
  erro?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-on-surface">
        {rotulo}
      </label>
      {children}
      {erro && <p className="text-xs text-error">{erro}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seletor de ano / modalidade
// ---------------------------------------------------------------------------

interface SeletorProps {
  ano: number;
  modalidade: "INDIVIDUAL" | "CONJUNTA";
  onAno: (a: number) => void;
  onModalidade: (m: "INDIVIDUAL" | "CONJUNTA") => void;
}

function Seletor({ ano, modalidade, onAno, onModalidade }: SeletorProps) {
  return (
    <div className="mb-container-padding flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Ano-base</label>
        <select
          value={ano}
          onChange={(e) => onAno(Number(e.target.value))}
          className="h-9 rounded-md border border-outline-variant bg-surface-container-low px-3 text-sm"
        >
          {[anoAtual - 1, anoAtual - 2, anoAtual - 3].map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>
      <div className="flex overflow-hidden rounded-md border border-outline-variant">
        {(["INDIVIDUAL", "CONJUNTA"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onModalidade(m)}
            className={
              "px-4 py-1.5 text-sm transition-colors " +
              (modalidade === m
                ? "bg-secondary-container text-on-secondary-container font-medium"
                : "text-on-surface-variant hover:bg-surface-container-high")
            }
          >
            {m === "INDIVIDUAL" ? "Individual" : "Conjunta (casal)"}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel do resultado do cálculo
// ---------------------------------------------------------------------------

function PainelResultado({ resultado }: { resultado: ResultadoCalculo }) {
  const s = sinal(resultado.imposto_a_pagar_ou_restituir);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          rotulo="Renda bruta tributável"
          valor={moeda(resultado.renda_bruta_tributavel)}
          icone={TrendingUp}
        />
        <Kpi
          rotulo="Total de deduções"
          valor={moeda(resultado.total_deducoes)}
          icone={ChevronDown}
          tom="despesa"
        />
        <Kpi
          rotulo="Base de cálculo"
          valor={moeda(resultado.base_calculo)}
          icone={Calculator}
        />
        <Kpi
          rotulo="Alíquota efetiva"
          valor={`${Number(resultado.aliquota_efetiva).toFixed(1)}%`}
          icone={Calculator}
        />
      </div>

      <div className={`rounded-xl border-2 p-4 text-center ${s.cor.includes("receita") ? "border-receita/30 bg-surface-container-low" : s.cor.includes("despesa") ? "border-despesa/30 bg-surface-container-low" : "border-outline-variant"}`}>
        <p className="text-sm text-on-surface-variant">Resultado da declaração</p>
        <p className={`mt-1 text-2xl font-bold tabular ${s.cor}`}>{s.texto}</p>
        {Number(resultado.irrf_a_creditar) > 0 && (
          <p className="mt-1 text-sm text-on-surface-variant">
            IRRF retido na fonte: {moeda(resultado.irrf_a_creditar)} (já deduzido)
          </p>
        )}
      </div>

      {/* Deduções detalhadas */}
      <div className="cartao overflow-hidden">
        <div className="border-b border-outline-variant bg-surface-container-low p-3">
          <h3 className="text-sm font-semibold text-on-surface">Deduções</h3>
        </div>
        <div className="divide-y divide-outline-variant">
          {[
            ["Dependentes", resultado.deducao_dependentes],
            ["Saúde", resultado.deducao_saude],
            ["Educação (com limite)", resultado.deducao_educacao],
            ["PGBL (até 12% da renda)", resultado.deducao_pgbl],
            ["Pensão alimentícia", resultado.deducao_pensao],
            ["Outras", resultado.deducao_outras],
          ].map(([nome, valor]) =>
            Number(valor) > 0 ? (
              <div key={String(nome)} className="flex justify-between px-3 py-2 text-sm">
                <span className="text-on-surface-variant">{nome}</span>
                <span className="tabular text-on-surface">{moeda(valor)}</span>
              </div>
            ) : null,
          )}
          <div className="flex justify-between bg-surface-container px-3 py-2 text-sm font-semibold">
            <span>Total de deduções</span>
            <span className="tabular">{moeda(resultado.total_deducoes)}</span>
          </div>
        </div>
      </div>

      {resultado.avisos.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-secondary bg-secondary-container/30 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
          <div className="space-y-1">
            {resultado.avisos.map((a, i) => (
              <p key={i} className="text-sm text-on-secondary-container">{a}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparativo de modalidades
// ---------------------------------------------------------------------------

function PainelComparativo({ ano }: { ano: number }) {
  const comparacao = useQuery({
    queryKey: ["ir-comparacao", ano],
    queryFn: () => api.compararIR(ano),
  });

  if (comparacao.isError) {
    const e = comparacao.error as ApiError;
    if (e.status === 404) {
      return (
        <p className="rounded-lg border border-outline-variant bg-surface-container-low p-4 text-sm text-on-surface-variant">
          Para comparar, crie uma declaração <strong>Individual</strong> e uma <strong>Conjunta</strong> para o ano {ano}.
        </p>
      );
    }
    return (
      <p className="text-sm text-error">Erro ao carregar a comparação. Tente novamente.</p>
    );
  }

  if (comparacao.isLoading) {
    return <p className="text-sm text-on-surface-variant">Calculando comparação…</p>;
  }

  const { data } = comparacao;
  if (!data) return null;

  const s = sinal(data.diferenca);

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border-2 p-4 text-center ${Number(data.diferenca) > 0 ? "border-receita/40" : Number(data.diferenca) < 0 ? "border-secondary/40" : "border-outline-variant"}`}>
        <p className={`text-lg font-semibold ${s.cor}`}>{data.recomendacao}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="cartao overflow-hidden">
          <div className="border-b border-outline-variant bg-surface-container-low p-3">
            <h3 className="text-sm font-semibold">Individual (titular)</h3>
          </div>
          <div className="space-y-2 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Renda bruta</span>
              <span className="tabular">{moeda(data.individual_titular.renda_bruta_tributavel)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Base de cálculo</span>
              <span className="tabular">{moeda(data.individual_titular.base_calculo)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Resultado</span>
              <span className={`tabular ${sinal(data.individual_titular.imposto_a_pagar_ou_restituir).cor}`}>
                {sinal(data.individual_titular.imposto_a_pagar_ou_restituir).texto}
              </span>
            </div>
          </div>
        </div>

        <div className="cartao overflow-hidden">
          <div className="border-b border-outline-variant bg-surface-container-low p-3">
            <h3 className="text-sm font-semibold">Conjunta (casal)</h3>
          </div>
          <div className="space-y-2 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Renda bruta</span>
              <span className="tabular">{moeda(data.conjunta.renda_bruta_tributavel)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Base de cálculo</span>
              <span className="tabular">{moeda(data.conjunta.base_calculo)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Resultado</span>
              <span className={`tabular ${sinal(data.conjunta.imposto_a_pagar_ou_restituir).cor}`}>
                {sinal(data.conjunta.imposto_a_pagar_ou_restituir).texto}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista de itens com botão de exclusão
// ---------------------------------------------------------------------------

interface ItemListaProps {
  titulo: string;
  subtitulo: string;
  valor: string;
  onDeletar: () => void;
  deletando: boolean;
}

function ItemLista({ titulo, subtitulo, valor, onDeletar, deletando }: ItemListaProps) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm text-on-surface">{titulo}</p>
        <p className="text-xs text-on-surface-variant">{subtitulo}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="tabular text-sm text-on-surface">{moeda(valor)}</span>
        <button
          onClick={onDeletar}
          disabled={deletando}
          className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-error"
          title="Remover"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Abas de gestão de dados
// ---------------------------------------------------------------------------

// -- Dependentes

const esquemaDependente = z.object({
  nome: z.string().min(2, "Informe o nome."),
  parentesco: z.enum(["CONJUGE", "FILHO", "ENTEADO", "PAI_MAE", "AVO", "OUTRO"]),
  cpf: z.string().optional(),
  gera_deducao: z.boolean().default(true),
});

function AbaDependentes({ declaracaoId }: { declaracaoId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const dependentes = useQuery({
    queryKey: ["ir-dependentes", declaracaoId],
    queryFn: () => api.irDependentes(declaracaoId),
  });

  const form = useForm({ resolver: zodResolver(esquemaDependente), defaultValues: { nome: "", parentesco: "FILHO" as const, cpf: "", gera_deducao: true } });

  const adicionar = useMutation({
    mutationFn: (d: z.infer<typeof esquemaDependente>) =>
      api.salvarIrDependente({ ...d, declaracao: declaracaoId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ir-dependentes", declaracaoId] });
      queryClient.invalidateQueries({ queryKey: ["ir-calculo"] });
      toast({ title: "Dependente adicionado" });
      form.reset();
    },
    onError: (e: ApiError) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  const deletar = useMutation({
    mutationFn: (id: string) => api.deletarIrDependente(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ir-dependentes", declaracaoId] });
      queryClient.invalidateQueries({ queryKey: ["ir-calculo"] });
    },
    onError: (e: ApiError) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  const lista = dependentes.data ?? [];
  const totalDeducao = lista.filter((d) => d.gera_deducao).length * 2275.08;

  return (
    <div className="space-y-4">
      <div className="cartao overflow-hidden">
        <div className="border-b border-outline-variant bg-surface-container-low p-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Dependentes</h3>
            <p className="text-xs text-on-surface-variant">
              {lista.filter((d) => d.gera_deducao).length} com dedução · R$ 2.275,08 cada · total {moeda(totalDeducao)}
            </p>
          </div>
        </div>

        {lista.length === 0 ? (
          <p className="p-4 text-center text-sm text-on-surface-variant">
            Nenhum dependente cadastrado.
          </p>
        ) : (
          <div className="divide-y divide-outline-variant">
            {lista.map((dep) => (
              <div key={dep.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-on-surface">{dep.nome}</p>
                  <p className="text-xs text-on-surface-variant">
                    {dep.parentesco_display}
                    {!dep.gera_deducao && " · não gera dedução"}
                  </p>
                </div>
                <button
                  onClick={() => deletar.mutate(dep.id)}
                  disabled={deletar.isPending}
                  className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-error"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <form
        className="cartao space-y-3 p-3"
        onSubmit={form.handleSubmit((d) => adicionar.mutate(d))}
      >
        <h4 className="text-sm font-semibold">Adicionar dependente</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome" erro={form.formState.errors.nome?.message}>
            <Input placeholder="Nome completo" {...form.register("nome")} />
          </Campo>
          <Campo rotulo="Parentesco">
            <select
              className="h-10 w-full rounded-md border border-outline-variant bg-surface-container-low px-3 text-sm"
              {...form.register("parentesco")}
            >
              <option value="FILHO">Filho(a)</option>
              <option value="ENTEADO">Enteado(a)</option>
              <option value="CONJUGE">Cônjuge / Companheiro(a)</option>
              <option value="PAI_MAE">Pai / Mãe</option>
              <option value="AVO">Avô / Avó</option>
              <option value="OUTRO">Outro</option>
            </select>
          </Campo>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...form.register("gera_deducao")} defaultChecked />
          Gera dedução por dependente
        </label>
        <Button type="submit" size="sm" disabled={adicionar.isPending}>
          {adicionar.isPending ? "Adicionando…" : "Adicionar"}
        </Button>
      </form>
    </div>
  );
}

// -- Saúde

const esquemaSaude = z.object({
  prestador: z.string().min(2, "Informe o prestador."),
  tipo: z.enum(["CONSULTA", "EXAME", "INTERNACAO", "DENTAL", "PSICOLOGIA", "FISIOTERAPIA", "PLANO_SAUDE", "OUTROS"]),
  data: z.string().min(10),
  valor: z.coerce.number().positive("Valor deve ser positivo."),
  beneficiario: z.string().default(""),
});

function AbaSaude({ declaracaoId }: { declaracaoId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const despesas = useQuery({
    queryKey: ["ir-saude", declaracaoId],
    queryFn: () => api.irDespesasMedicas(declaracaoId),
  });

  const form = useForm({
    resolver: zodResolver(esquemaSaude),
    defaultValues: { prestador: "", tipo: "CONSULTA" as const, data: "", valor: 0, beneficiario: "" },
  });

  const adicionar = useMutation({
    mutationFn: (d: z.infer<typeof esquemaSaude>) =>
      api.salvarIrDespesaMedica({ ...d, valor: String(d.valor), declaracao: declaracaoId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ir-saude", declaracaoId] });
      queryClient.invalidateQueries({ queryKey: ["ir-calculo"] });
      toast({ title: "Despesa de saúde adicionada" });
      form.reset();
    },
    onError: (e: ApiError) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  const deletar = useMutation({
    mutationFn: (id: string) => api.deletarIrDespesaMedica(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ir-saude", declaracaoId] });
      queryClient.invalidateQueries({ queryKey: ["ir-calculo"] });
    },
  });

  const lista = despesas.data ?? [];
  const totalSaude = lista.reduce((acc, d) => acc + Number(d.valor), 0);

  return (
    <div className="space-y-4">
      <div className="cartao overflow-hidden">
        <div className="border-b border-outline-variant bg-surface-container-low p-3">
          <h3 className="text-sm font-semibold">Despesas de saúde</h3>
          <p className="text-xs text-on-surface-variant">
            Sem limite · total dedutível: {moeda(totalSaude)}
          </p>
        </div>
        {lista.length === 0 ? (
          <p className="p-4 text-center text-sm text-on-surface-variant">Nenhuma despesa cadastrada.</p>
        ) : (
          <div className="divide-y divide-outline-variant">
            {lista.map((d) => (
              <ItemLista
                key={d.id}
                titulo={d.prestador}
                subtitulo={`${d.tipo_display} · ${d.data}${d.beneficiario ? ` · ${d.beneficiario}` : ""}`}
                valor={d.valor}
                onDeletar={() => deletar.mutate(d.id)}
                deletando={deletar.isPending}
              />
            ))}
          </div>
        )}
      </div>

      <form
        className="cartao space-y-3 p-3"
        onSubmit={form.handleSubmit((d) => adicionar.mutate(d))}
      >
        <h4 className="text-sm font-semibold">Adicionar despesa de saúde</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Prestador" erro={form.formState.errors.prestador?.message}>
            <Input placeholder="Clínica, médico, hospital…" {...form.register("prestador")} />
          </Campo>
          <Campo rotulo="Tipo">
            <select
              className="h-10 w-full rounded-md border border-outline-variant bg-surface-container-low px-3 text-sm"
              {...form.register("tipo")}
            >
              <option value="CONSULTA">Consulta médica</option>
              <option value="EXAME">Exame laboratorial / imagem</option>
              <option value="INTERNACAO">Internação / cirurgia</option>
              <option value="DENTAL">Odontológico</option>
              <option value="PSICOLOGIA">Psicologia / terapia</option>
              <option value="FISIOTERAPIA">Fisioterapia</option>
              <option value="PLANO_SAUDE">Plano de saúde</option>
              <option value="OUTROS">Outros</option>
            </select>
          </Campo>
          <Campo rotulo="Data" erro={form.formState.errors.data?.message}>
            <Input type="date" {...form.register("data")} />
          </Campo>
          <Campo rotulo="Valor" erro={form.formState.errors.valor?.message}>
            <Input type="number" step="0.01" min="0.01" {...form.register("valor")} />
          </Campo>
          <Campo rotulo="Beneficiário (opcional)">
            <Input placeholder="Em branco = titular" {...form.register("beneficiario")} />
          </Campo>
        </div>
        <Button type="submit" size="sm" disabled={adicionar.isPending}>
          {adicionar.isPending ? "Adicionando…" : "Adicionar"}
        </Button>
      </form>
    </div>
  );
}

// -- Capital variável

const esquemaCapital = z.object({
  descricao: z.string().min(2, "Informe o ativo."),
  tipo: z.enum(["DIVIDENDO", "JCP", "GANHO_CAPITAL", "FII", "CRIPTOATIVO", "RENDA_FIXA", "OUTRO"]),
  data: z.string().min(10),
  valor_bruto: z.coerce.number().positive(),
  imposto_retido: z.coerce.number().min(0).default(0),
  isento: z.boolean().default(false),
});

function AbaCapitalVariavel({ declaracaoId }: { declaracaoId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const rendimentos = useQuery({
    queryKey: ["ir-capital", declaracaoId],
    queryFn: () => api.irCapitalVariavel(declaracaoId),
  });

  const form = useForm({
    resolver: zodResolver(esquemaCapital),
    defaultValues: { descricao: "", tipo: "DIVIDENDO" as const, data: "", valor_bruto: 0, imposto_retido: 0, isento: true },
  });

  const adicionar = useMutation({
    mutationFn: (d: z.infer<typeof esquemaCapital>) =>
      api.salvarIrCapitalVariavel({
        ...d,
        valor_bruto: String(d.valor_bruto),
        imposto_retido: String(d.imposto_retido),
        declaracao: declaracaoId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ir-capital", declaracaoId] });
      queryClient.invalidateQueries({ queryKey: ["ir-calculo"] });
      toast({ title: "Rendimento adicionado" });
      form.reset();
    },
    onError: (e: ApiError) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  const deletar = useMutation({
    mutationFn: (id: string) => api.deletarIrCapitalVariavel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ir-capital", declaracaoId] });
      queryClient.invalidateQueries({ queryKey: ["ir-calculo"] });
    },
  });

  const lista = rendimentos.data ?? [];
  const totalTributavel = lista.filter((r) => !r.isento).reduce((a, r) => a + Number(r.valor_bruto), 0);
  const totalIsento = lista.filter((r) => r.isento).reduce((a, r) => a + Number(r.valor_bruto), 0);
  const totalIRRF = lista.reduce((a, r) => a + Number(r.imposto_retido), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Kpi rotulo="Tributável" valor={moeda(totalTributavel)} icone={TrendingUp} tom="despesa" />
        <Kpi rotulo="Isento" valor={moeda(totalIsento)} icone={TrendingUp} tom="receita" />
        <Kpi rotulo="IRRF retido" valor={moeda(totalIRRF)} icone={PiggyBank} />
      </div>

      <div className="cartao overflow-hidden">
        <div className="border-b border-outline-variant bg-surface-container-low p-3">
          <h3 className="text-sm font-semibold">Rendimentos de capital variável</h3>
        </div>
        {lista.length === 0 ? (
          <p className="p-4 text-center text-sm text-on-surface-variant">Nenhum rendimento cadastrado.</p>
        ) : (
          <div className="divide-y divide-outline-variant">
            {lista.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-on-surface">{r.descricao}</p>
                  <p className="text-xs text-on-surface-variant">
                    {r.tipo_display} · {r.data}
                    {r.isento && " · isento"}
                    {Number(r.imposto_retido) > 0 && ` · IRRF ${moeda(r.imposto_retido)}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular text-sm">{moeda(r.valor_bruto)}</span>
                  <button
                    onClick={() => deletar.mutate(r.id)}
                    disabled={deletar.isPending}
                    className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-error"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <form
        className="cartao space-y-3 p-3"
        onSubmit={form.handleSubmit((d) => adicionar.mutate(d))}
      >
        <h4 className="text-sm font-semibold">Adicionar rendimento</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Ativo / empresa" erro={form.formState.errors.descricao?.message}>
            <Input placeholder="PETR4, FII XPML11, Bitcoin…" {...form.register("descricao")} />
          </Campo>
          <Campo rotulo="Tipo">
            <select
              className="h-10 w-full rounded-md border border-outline-variant bg-surface-container-low px-3 text-sm"
              {...form.register("tipo")}
            >
              <option value="DIVIDENDO">Dividendo (isento)</option>
              <option value="JCP">JCP — Juros sobre capital próprio</option>
              <option value="GANHO_CAPITAL">Ganho de capital (venda)</option>
              <option value="FII">FII — Fundo imobiliário</option>
              <option value="CRIPTOATIVO">Criptoativo</option>
              <option value="RENDA_FIXA">Renda fixa (CDB, LCI, LCA)</option>
              <option value="OUTRO">Outro</option>
            </select>
          </Campo>
          <Campo rotulo="Data" erro={form.formState.errors.data?.message}>
            <Input type="date" {...form.register("data")} />
          </Campo>
          <Campo rotulo="Valor bruto" erro={form.formState.errors.valor_bruto?.message}>
            <Input type="number" step="0.01" min="0.01" {...form.register("valor_bruto")} />
          </Campo>
          <Campo rotulo="IRRF retido na fonte">
            <Input type="number" step="0.01" min="0" {...form.register("imposto_retido")} />
          </Campo>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...form.register("isento")} />
          Rendimento isento de IR (dividendos, LCI, LCA)
        </label>
        <Button type="submit" size="sm" disabled={adicionar.isPending}>
          {adicionar.isPending ? "Adicionando…" : "Adicionar"}
        </Button>
      </form>
    </div>
  );
}

// -- Outras deduções

const esquemaOutraDedução = z.object({
  tipo: z.enum(["EDUCACAO", "PREVIDENCIA_PRIVADA", "PENSAO_ALIMENTICIA", "LIVRO_CAIXA", "DOACAO", "OUTRO"]),
  beneficiario: z.string().min(2, "Informe quem se beneficia."),
  instituicao: z.string().optional(),
  valor: z.coerce.number().positive(),
});

function AbaOutrasDeducoes({ declaracaoId }: { declaracaoId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const deducoes = useQuery({
    queryKey: ["ir-outras-deducoes", declaracaoId],
    queryFn: () => api.irOutrasDeducoes(declaracaoId),
  });

  const form = useForm({
    resolver: zodResolver(esquemaOutraDedução),
    defaultValues: { tipo: "EDUCACAO" as const, beneficiario: "", instituicao: "", valor: 0 },
  });

  const adicionar = useMutation({
    mutationFn: (d: z.infer<typeof esquemaOutraDedução>) =>
      api.salvarIrOutraDedução({
        ...d,
        valor: String(d.valor),
        instituicao: d.instituicao ?? "",
        declaracao: declaracaoId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ir-outras-deducoes", declaracaoId] });
      queryClient.invalidateQueries({ queryKey: ["ir-calculo"] });
      toast({ title: "Dedução adicionada" });
      form.reset();
    },
    onError: (e: ApiError) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  const deletar = useMutation({
    mutationFn: (id: string) => api.deletarIrOutraDedução(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ir-outras-deducoes", declaracaoId] });
      queryClient.invalidateQueries({ queryKey: ["ir-calculo"] });
    },
  });

  const lista = deducoes.data ?? [];
  const total = lista.reduce((a, d) => a + Number(d.valor), 0);

  return (
    <div className="space-y-4">
      <div className="cartao overflow-hidden">
        <div className="border-b border-outline-variant bg-surface-container-low p-3">
          <h3 className="text-sm font-semibold">Outras deduções</h3>
          <p className="text-xs text-on-surface-variant">
            Educação (limite R$ 3.561,50/pessoa) · PGBL (até 12% da renda) · Pensão integral
            · Total declarado: {moeda(total)}
          </p>
        </div>
        {lista.length === 0 ? (
          <p className="p-4 text-center text-sm text-on-surface-variant">Nenhuma dedução cadastrada.</p>
        ) : (
          <div className="divide-y divide-outline-variant">
            {lista.map((d) => (
              <ItemLista
                key={d.id}
                titulo={d.tipo_display}
                subtitulo={`${d.beneficiario}${d.instituicao ? ` · ${d.instituicao}` : ""}`}
                valor={d.valor}
                onDeletar={() => deletar.mutate(d.id)}
                deletando={deletar.isPending}
              />
            ))}
          </div>
        )}
      </div>

      <form
        className="cartao space-y-3 p-3"
        onSubmit={form.handleSubmit((d) => adicionar.mutate(d))}
      >
        <h4 className="text-sm font-semibold">Adicionar dedução</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Tipo">
            <select
              className="h-10 w-full rounded-md border border-outline-variant bg-surface-container-low px-3 text-sm"
              {...form.register("tipo")}
            >
              <option value="EDUCACAO">Educação (limite R$ 3.561,50/pessoa)</option>
              <option value="PREVIDENCIA_PRIVADA">Previdência privada — PGBL (até 12%)</option>
              <option value="PENSAO_ALIMENTICIA">Pensão alimentícia judicial</option>
              <option value="LIVRO_CAIXA">Livro-caixa (autônomo)</option>
              <option value="DOACAO">Doação a fundo aprovado</option>
              <option value="OUTRO">Outro</option>
            </select>
          </Campo>
          <Campo rotulo="Beneficiário" erro={form.formState.errors.beneficiario?.message}>
            <Input placeholder="Titular, nome do filho…" {...form.register("beneficiario")} />
          </Campo>
          <Campo rotulo="Instituição (opcional)">
            <Input placeholder="Escola, banco, fundo…" {...form.register("instituicao")} />
          </Campo>
          <Campo rotulo="Valor pago" erro={form.formState.errors.valor?.message}>
            <Input type="number" step="0.01" min="0.01" {...form.register("valor")} />
          </Campo>
        </div>
        <Button type="submit" size="sm" disabled={adicionar.isPending}>
          {adicionar.isPending ? "Adicionando…" : "Adicionar"}
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal de criação de declaração
// ---------------------------------------------------------------------------

const esquemaCriar = z.object({
  ano: z.coerce.number().int().min(2020).max(anoAtual),
  modalidade: z.enum(["INDIVIDUAL", "CONJUNTA"]),
  nome_titular: z.string().optional(),
  nome_conjuge: z.string().optional(),
});

function ModalCriarDeclaracao({
  aberto,
  onFechar,
}: {
  aberto: boolean;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm({
    resolver: zodResolver(esquemaCriar),
    defaultValues: { ano: anoAtual - 1, modalidade: "INDIVIDUAL" as "INDIVIDUAL" | "CONJUNTA", nome_titular: "", nome_conjuge: "" },
  });

  const modalidade = form.watch("modalidade");

  const criar = useMutation({
    mutationFn: (d: z.infer<typeof esquemaCriar>) => api.salvarDeclaracaoIR(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["declaracoes-ir"] });
      toast({ title: "Declaração criada" });
      onFechar();
      form.reset();
    },
    onError: (e: ApiError) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova declaração de IR</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((d) => criar.mutate(d))}
        >
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Ano-base">
              <select
                className="h-10 w-full rounded-md border border-outline-variant bg-surface-container-low px-3 text-sm"
                {...form.register("ano")}
              >
                {[anoAtual - 1, anoAtual - 2, anoAtual - 3].map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Modalidade">
              <select
                className="h-10 w-full rounded-md border border-outline-variant bg-surface-container-low px-3 text-sm"
                {...form.register("modalidade")}
              >
                <option value="INDIVIDUAL">Individual</option>
                <option value="CONJUNTA">Conjunta (casal)</option>
              </select>
            </Campo>
          </div>
          <Campo rotulo="Nome do titular (opcional)">
            <Input placeholder="Seu nome" {...form.register("nome_titular")} />
          </Campo>
          {modalidade === "CONJUNTA" && (
            <Campo rotulo="Nome do cônjuge">
              <Input placeholder="Nome do cônjuge / companheiro(a)" {...form.register("nome_conjuge")} />
            </Campo>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={criar.isPending}>
              {criar.isPending ? "Criando…" : "Criar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tela principal
// ---------------------------------------------------------------------------

type Aba = "resultado" | "dependentes" | "saude" | "capital" | "outras" | "comparar";

export default function IR() {
  const [ano, setAno] = useState(anoAtual - 1);
  const [modalidade, setModalidade] = useState<"INDIVIDUAL" | "CONJUNTA">("INDIVIDUAL");
  const [aba, setAba] = useState<Aba>("resultado");
  const [criando, setCriando] = useState(false);

  const declaracoes = useQuery({
    queryKey: ["declaracoes-ir"],
    queryFn: () => api.declaracoesIR(),
  });

  const declaracao = (declaracoes.data ?? []).find(
    (d) => d.ano === ano && d.modalidade === modalidade,
  );

  const calculo = useQuery({
    queryKey: ["ir-calculo", declaracao?.id],
    queryFn: () => api.calcularIR(declaracao!.id),
    enabled: Boolean(declaracao?.id) && aba === "resultado",
  });

  const ABAS: { id: Aba; rotulo: string; icone: React.ElementType }[] = [
    { id: "resultado", rotulo: "Resultado", icone: Calculator },
    { id: "dependentes", rotulo: "Dependentes", icone: Users },
    { id: "saude", rotulo: "Saúde", icone: Heart },
    { id: "capital", rotulo: "Capital variável", icone: TrendingUp },
    { id: "outras", rotulo: "Outras deduções", icone: PiggyBank },
    { id: "comparar", rotulo: "Comparar", icone: AlertCircle },
  ];

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Imposto de Renda"
        descricao="Estime seu IR, gerencie deduções e compare declaração individual com conjunta."
        acoes={
          <Button size="sm" onClick={() => setCriando(true)}>
            <FilePlus className="mr-1.5 h-4 w-4" />
            Nova declaração
          </Button>
        }
      />

      <Seletor
        ano={ano}
        modalidade={modalidade}
        onAno={setAno}
        onModalidade={setModalidade}
      />

      {declaracoes.isLoading ? (
        <p className="text-center text-sm text-on-surface-variant">Carregando…</p>
      ) : !declaracao ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-stack-lg text-center">
            <Calculator className="h-8 w-8 text-on-surface-variant" />
            <p className="text-body-md">
              Nenhuma declaração {modalidade === "INDIVIDUAL" ? "individual" : "conjunta"} para {ano}.
            </p>
            <p className="max-w-sm text-body-sm text-on-surface-variant">
              Crie uma para começar a registrar rendimentos, dependentes e deduções.
            </p>
            <Button size="sm" onClick={() => setCriando(true)}>
              <FilePlus className="mr-1.5 h-4 w-4" />
              Criar declaração {ano} — {modalidade === "INDIVIDUAL" ? "Individual" : "Conjunta"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Abas */}
          <div className="mb-container-padding flex flex-wrap gap-1 border-b border-outline-variant">
            {ABAS.map(({ id, rotulo, icone: Icone }) => (
              <button
                key={id}
                onClick={() => setAba(id)}
                className={
                  "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors " +
                  (aba === id
                    ? "border-primary font-medium text-primary"
                    : "border-transparent text-on-surface-variant hover:text-on-surface")
                }
              >
                <Icone className="h-3.5 w-3.5" />
                {rotulo}
              </button>
            ))}
          </div>

          {/* Conteúdo de cada aba */}
          {aba === "resultado" && (
            calculo.isError ? (
              <p className="text-sm text-error">Erro ao calcular o imposto. Tente novamente.</p>
            ) : calculo.isLoading ? (
              <p className="text-sm text-on-surface-variant">Calculando…</p>
            ) : calculo.data ? (
              <PainelResultado resultado={calculo.data} />
            ) : null
          )}
          {aba === "dependentes" && <AbaDependentes declaracaoId={declaracao.id} />}
          {aba === "saude" && <AbaSaude declaracaoId={declaracao.id} />}
          {aba === "capital" && <AbaCapitalVariavel declaracaoId={declaracao.id} />}
          {aba === "outras" && <AbaOutrasDeducoes declaracaoId={declaracao.id} />}
          {aba === "comparar" && <PainelComparativo ano={ano} />}
        </>
      )}

      <ModalCriarDeclaracao aberto={criando} onFechar={() => setCriando(false)} />
    </div>
  );
}
